import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, aeds, sources, observations, importJobs, importErrors, auditLogs } from "@workspace/db";
import { connectSource } from "./connectors";
import { digest, legacyStableId, normalizeRow, preserveOriginal, type Issue } from "./normalize";
import { registerDatasetSource, sourceFamilyIds } from "./source-registry";
import { supportedGovernmentConditions } from "./license-evidence";
import { requiresLocationReview } from "./sync-diagnostics";
import type { reserveSync } from "./engine";

type Reservation = NonNullable<Awaited<ReturnType<typeof reserveSync>>>;
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value) : null;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

/** Insert-only path. Never invokes synchronization, quarantine, matching or aggregation. */
export async function executeAppendImport(reservation: Reservation, options: {
  connector?: typeof connectSource; datasetId?: string; allowEmpty?: boolean;
} = {}) {
  const { source, job, token } = reservation;
  const counts = { processed: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
  let resourceErrors = 0, validationMessages = 0, unsupportedResources = 0;
  let lostLease = false;
  const heartbeat = setInterval(() => {
    void db.update(sources).set({ lockedUntil: new Date(Date.now() + 30 * 60000) })
      .where(and(eq(sources.id, source.id), eq(sources.lockToken, token))).returning({ id: sources.id })
      .then(rows => { if (!rows.length) lostLease = true; }).catch(() => { lostLease = true; });
  }, 60000);
  heartbeat.unref();
  let status = "running", lastResource: string | null = null;
  const issues = new Map<string, Issue & { count: number }>();
  const owners = new Map<string, { processed: number; imported: number; skipped: number; errors: number; unsupported: number }>();
  const summary = () => ({ mode: "append", resourceErrors, validationMessages, unsupportedResources, lastResource,
    errorSummary: [...issues.values()] });
  const note = async (issue: Issue, sourceId: string, sourceRecordId?: string) => {
    const key = `${issue.severity}:${issue.rule}`;
    issues.set(key, { ...issue, count: (issues.get(key)?.count ?? 0) + 1 });
    await db.insert(importErrors).values({ ...issue, sourceId, sourceRecordId, jobId: job.id });
  };
  const progress = () => db.update(importJobs).set({ ...counts, summary: summary() }).where(eq(importJobs.id, job.id));
  try {
    await progress();
    const previous = await db.select({ id: observations.sourceRecordId, original: observations.originalRecord })
      .from(observations).where(inArray(observations.sourceId, await sourceFamilyIds(source)));
    const existing = new Set(previous.flatMap(r => [r.id, legacyStableId(r.original)].filter((v): v is string => !!v)));
    for await (const packet of (options.connector ?? connectSource)(reservation.key, { datasetId: options.datasetId })) {
      // Renew and fence the shared sync/import lease before each resource.
      const renewed = await db.update(sources).set({ lockedUntil: new Date(Date.now() + 30 * 60000) })
        .where(and(eq(sources.id, source.id), eq(sources.lockToken, token))).returning({ id: sources.id });
      if (!renewed.length) throw new Error("Utracono blokadę importu.");
      if (lostLease) throw new Error("Utracono blokadę importu.");
      const owner = reservation.key==="dane-gov" && /^\d+$/.test(packet.context.datasetId) && packet.context.datasetTitle
        ? await registerDatasetSource(packet, source) : source;
      const c = packet.context;
      const ownerCounts = owners.get(owner.id) ?? { processed: 0, imported: 0, skipped: 0, errors: 0, unsupported: 0 };
      owners.set(owner.id, ownerCounts);
      const before = { ...counts };
      lastResource = c.resourceId;
      if (packet.issue) {
        await note(packet.issue, owner.id, c.resourceId);
        if (packet.issue.severity === "error") { resourceErrors++; ownerCounts.errors++; }
        if (packet.issue.rule === "unsupported_format") { unsupportedResources++; ownerCounts.unsupported++; }
        if (packet.issue.rule === "resource_copy") {
          const n = Number(packet.metadata?.duplicateRows ?? 0);
          if (Number.isInteger(n) && n > 0 && n <= 100000) { counts.processed += n; counts.skipped += n; }
        }
      }
      for (const original of packet.rows) {
        if (lostLease) throw new Error("Utracono blokadę importu.");
        counts.processed++;
        let identity = `${c.datasetId}/${c.resourceId}/unparsed`;
        try {
          identity += `:${digest(original)}`;
          const row = normalizeRow({ original, context: c });
          identity = row.data ? row.id : identity;
          if (existing.has(identity) || (!row.data && existing.has(row.id))) { counts.skipped++; continue; }
          const rightsResolved = ["CC0-1.0", "CC-BY-4.0", "ODbL-1.0"].includes(c.license)
            && supportedGovernmentConditions(c.reuseConditions ?? {});
          if (!rightsResolved && !row.issues.some(i => i.rule === "missing_license")) row.issues.push({
            severity: "error", rule: "rights_review", message: "Niestandardowe lub nierozstrzygnięte warunki; zapisano oryginał bez publikacji.",
          });
          const inserted = await db.transaction(async tx => {
            // A replacement worker cannot acquire the coordinator until this row commits.
            const [lease] = await tx.select({ token: sources.lockToken }).from(sources)
              .where(eq(sources.id, source.id)).for("update");
            if (lease?.token !== token) { lostLease = true; throw new Error("Utracono blokadę importu."); }
            const [ref] = await tx.insert(observations).values({
              sourceId: owner.id, sourceRecordId: identity,
              originalRecord: preserveOriginal({ record: original, metadata: packet.metadata ?? {}, context: c }),
              sourceUrl: c.url, license: c.license, publisher: c.publisher || null,
              datasetUrl: c.datasetUrl, datasetId: c.datasetId, datasetTitle: c.datasetTitle,
              resourceId: c.resourceId, resourceFormat: c.resourceFormat, publisherId: c.publisherId,
              contentHash: digest({ original, context: c }), normalizedRecord: row.data ? json(row.data) : null,
              officialProvenance: c.sourceCategory ?? "UNKNOWN", provenanceEvidence: c.provenanceEvidence ?? {},
              publishedAt: date(c.published), sourceModifiedAt: date(c.modified),
              geographicScope: c.coverage, referenceScope: c.referenceScope, reuseConditions: c.reuseConditions ?? {},
            }).onConflictDoNothing().returning({ id: observations.id });
            if (!ref) return false;
            if (row.data) {
              const id = randomUUID();
              await tx.insert(aeds).values({
                ...row.data, id, imported: true, isDemo: false, verificationStatus: "NOT_VERIFIED",
                publicImport: rightsResolved && row.data.latitude !== null && row.data.longitude !== null
                  && !row.issues.some(i => i.severity === "error"),
                publicationCount: 1, independentSourceCount: 1,
                locationEvidence: { method: "source_import", issues: row.issues,
                  requiresLocationReview: requiresLocationReview(row.issues), autoGeocodeEligible: false },
              });
              await tx.update(observations).set({ aedId: id }).where(eq(observations.id, ref.id));
            }
            if (row.issues.length) await tx.insert(importErrors).values(row.issues.map(issue => ({
              ...issue, sourceId: owner.id, jobId: job.id, sourceRecordId: identity,
            })));
            return true;
          });
          existing.add(identity);
          if (!inserted) { counts.skipped++; continue; }
          if (row.data) counts.imported++;
          else counts.skipped++;
          if (row.issues.some(i => i.severity === "error")) counts.errors++;
          validationMessages += row.issues.length;
          for (const issue of row.issues) {
            const key = `${issue.severity}:${issue.rule}`;
            issues.set(key, { ...issue, count: (issues.get(key)?.count ?? 0) + 1 });
          }
        } catch (error) {
          if (lostLease) throw error;
          counts.errors++;
          // One rejected row must not roll back the remaining resource.
          await note({ severity: "error", rule: "record_failed",
            message: `Nie zapisano wiersza: ${error instanceof Error ? error.message.slice(0, 500) : "błąd zapisu"}` },
          owner.id, identity);
        }
        if (counts.processed % 50 === 0) await progress();
      }
      ownerCounts.processed += counts.processed - before.processed;
      ownerCounts.imported += counts.imported - before.imported;
      ownerCounts.skipped += counts.skipped - before.skipped;
      ownerCounts.errors += counts.errors - before.errors;
      await progress();
    }
    status = resourceErrors || counts.errors || unsupportedResources ? "partial" : "succeeded";
    if (!counts.processed && !options.allowEmpty) status = "failed";
  } catch (error) {
    status = "failed";
    resourceErrors++;
    await note({ severity: "error", rule: "append_failed",
      message: error instanceof Error ? error.message : "Import przerwany; zapisane dane zachowano." }, source.id);
  } finally {
    clearInterval(heartbeat);
    await db.transaction(async tx => {
      await tx.update(importJobs).set({ ...counts, status, finishedAt: new Date(), summary: summary() }).where(eq(importJobs.id, job.id));
      const released = await tx.update(sources).set({ status, lockedUntil: null, lockToken: null,
        statusMessage: `Import dopisujący: dodano ${counts.imported}, pominięto ${counts.skipped}, błędne rekordy ${counts.errors}, błędy zasobów ${resourceErrors}, nieobsługiwane zasoby ${unsupportedResources}.`,
        ...(status === "succeeded" ? { lastSuccessAt: new Date() } : {}) })
        .where(and(eq(sources.id, source.id), eq(sources.lockToken, token))).returning({ id: sources.id });
      for (const [id, n] of owners) if (released.length && id !== source.id) await tx.update(sources).set({
        status: status === "failed" ? "partial" : n.errors || n.unsupported ? "partial" : n.processed ? "succeeded" : "ready",
        lastCheckedAt: new Date(),
        ...(n.processed ? { lastSyncedAt: new Date() } : {}),
        statusMessage: `Import dopisujący: dodano ${n.imported}, pominięto ${n.skipped}; problemy ${n.errors}, nieobsługiwane zasoby ${n.unsupported}. Istniejące AED i publikacje bez zmian.`,
      }).where(eq(sources.id, id));
      await tx.insert(auditLogs).values({ userId: job.userId, entityId: job.id,
        action: `Import dopisujący dane.gov.pl: ${status}`, details: { ...counts, ...summary() } });
    });
  }
  return { jobId: job.id, status, ...counts, resourceErrors, validationMessages, unsupportedResources };
}
