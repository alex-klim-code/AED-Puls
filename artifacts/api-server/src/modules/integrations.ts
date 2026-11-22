import type { FastifyInstance, FastifyRequest } from "fastify";
import { verificationState } from "./record-state";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, aeds, sources, observations, importJobs, importErrors, dataConflicts, duplicateCandidates, auditLogs, mergeDecisions } from "@workspace/db";
import { GetIntegrationPanelResponse, StartSourceSyncBody, TestSourceConnectionBody, ResolveDuplicateBody, ResolveDataConflictBody } from "@workspace/api-zod";
import { requireUser, fail } from "./auth";
import { serializeAed } from "./aeds";
import { ensureSources, reserveSync, executeSync, changedFields } from "../ingestion/engine";
import { SOURCE_DEFINITIONS, type SourceKey } from "../ingestion/connectors";
import { provenanceMap } from "../ingestion/provenance";
import { logger } from "../lib/logger";
import { mergeCandidate,undoMerge,refreshAggregation } from "../ingestion/linkage";
import { testConnection } from "../ingestion/source-probe";
import { sourceFamilyIds } from "../ingestion/source-registry";
import { executeAppendImport } from "../ingestion/append-import";

function realAdmin(req: FastifyRequest) {
  const user = requireUser(req, ["ADMIN"]);
  return user;
}
const original = (r: typeof observations.$inferSelect) => ({
  ...r, originalRecord: r.originalRecord as Record<string, unknown>,
  importedAt: r.importedAt.toISOString(), lastSyncedAt: r.lastSyncedAt.toISOString(),
});
async function panel(sourceId: string | undefined, page: number, demo: boolean) {
  const size = 20, offset = (page - 1) * size;
  const allSources = await db.select().from(sources).where(isNotNull(sources.key));
  const summaries = [];
  for (const s of allSources) {
    const family=await sourceFamilyIds(s);
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(observations).where(and(inArray(observations.sourceId, family), isNotNull(observations.aedId),isNull(observations.removedAt)));
    const [errorCount] = await db.select({ n: sql<number>`count(*)::int` }).from(importErrors).where(and(inArray(importErrors.sourceId, family), eq(importErrors.severity, "error")));
    const extra=await db.execute(sql`select
      (select coalesce(sum(imported),0)::int from import_jobs where source_id=${s.id}) as added,
      (select count(*)::int from source_observations o join aed_records a on a.id=o.aed_id where o.source_id=${s.id} and a.merged_into_id is not null) as matched,
      (select count(*)::int from data_conflicts c join source_observations o on o.id=c.observation_id where o.source_id=${s.id} and c.status='pending') as conflicts,
      (select max(created_at) from import_errors where source_id=${s.id} and severity='error') as last_error`);
    const metrics=extra.rows[0] as {added:number;matched:number;conflicts:number;last_error:Date|string|null};
    const [latest]=await db.select().from(importJobs).where(eq(importJobs.sourceId,s.id)).orderBy(desc(importJobs.createdAt)).limit(1);
    const summary=(latest?.summary??{}) as Record<string,unknown>,connection=(s.provenanceEvidence.connectionTest??{}) as Record<string,unknown>;
    const stored=summary.errorSummary;
    const errorSummary=Array.isArray(stored)?stored:latest?await db.select({
      rule:importErrors.rule,severity:importErrors.severity,count:sql<number>`count(*)::int`,message:sql<string>`min(${importErrors.message})`,
    }).from(importErrors).where(eq(importErrors.jobId,latest.id)).groupBy(importErrors.rule,importErrors.severity):[];
    summaries.push({ id: s.id, key: s.key!, name: s.name, publisher: s.institution, coverage: s.coverage, license: s.license, status: s.status,
      syncKey:s.key?.startsWith("dane-gov:")?"dane-gov":SOURCE_DEFINITIONS.some(d=>d.key===s.key)?s.key:null,
      connectionStatus:String(connection.status??"untested"),connectionMessage:String(connection.message??"Nie wykonano jeszcze testu połączenia."),
      connectionCheckedAt:typeof connection.checkedAt==="string"?connection.checkedAt:null,
      latestImport:{processed:latest?.processed??0,validRecords:Number.isInteger(summary.validRecords)?summary.validRecords:null,
        imported:latest?.imported??0,updated:latest?.updated??0,duplicates:Number(summary.duplicates??errorSummary.find(r=>r.rule==="duplicate_source_id")?.count??0),errors:latest?.errors??0},
      errorSummary,
      sourceType:s.sourceType,newAeds:metrics.added,matchedRecords:metrics.matched,conflictCount:metrics.conflicts,
      lastErrorAt:metrics.last_error?new Date(metrics.last_error).toISOString():null,
      sourceCategory: s.officialProvenance, datasetUrl: s.datasetUrl ?? s.url,
      lastUpdatedAt: s.lastUpdatedAt?.toISOString() ?? null, lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
      provenanceEvidence: s.provenanceEvidence,
      message: s.statusMessage, recordCount: count!.n, errorCount: errorCount!.n, lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null, lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null });
  }
  const statsResult = await db.execute(sql`select
    (select count(*)::int from source_observations where source_id in (select id from data_sources where key is not null)) as imported,
    (select count(*)::int from aed_records where is_demo=false and merged_into_id is null) as canonical,
    (select count(*)::int from aed_records where is_demo=false and merged_into_id is null and verification_status in ('pending','unverified','NOT_VERIFIED')) as requiring,
    (select count(*)::int from duplicate_candidates d join aed_records a on a.id=d.first_id where a.is_demo=false and d.status='pending') as duplicates,
    (select count(*)::int from data_conflicts where status='pending') as conflicts,
    (select count(*)::int from aed_records where merged_into_id is null and independent_source_count>1 and is_demo=false) as multi,
    (select count(*)::int from data_sources where key in ('dane-gov','openaedmap','przemysl','warszawa','openaed-eu')) as active`);
  const s = statsResult.rows[0] as Record<string, number>;
  const stats = { importedRecords: s.imported!, canonicalRecords: s.canonical!, duplicateCandidates: s.duplicates!, conflicts: s.conflicts!, requiringVerification: s.requiring!,
    multiSourceAeds:s.multi!,activeIntegrations:s.active!,
    lastSuccessAt: summaries.map(r => r.lastSuccessAt).filter((x): x is string => !!x).sort().at(-1) ?? null };
  const empty = { sources: summaries, stats, jobs: [], errors: [], records: [], duplicates: [], conflicts: [], page, pageSize: size, jobTotal: 0, errorTotal: 0, recordTotal: 0, duplicateTotal: 0, conflictTotal: 0, demoReadOnly: demo };
  if (demo) return GetIntegrationPanelResponse.parse(empty);
  const jobFilter = and(isNotNull(importJobs.sourceId), sourceId ? eq(importJobs.sourceId, sourceId) : undefined);
  const errorFilter = sourceId ? eq(importErrors.sourceId, sourceId) : undefined;
  const obsFilter = and(isNotNull(observations.sourceId), sourceId ? eq(observations.sourceId, sourceId) : undefined);
  const pairFilter = and(eq(aeds.isDemo, false), eq(duplicateCandidates.status, "pending"), isNull(aeds.mergedIntoId));
  const jobs = await db.select().from(importJobs).where(jobFilter).orderBy(desc(importJobs.createdAt)).limit(size).offset(offset);
  const errors = await db.select().from(importErrors).where(errorFilter).orderBy(desc(importErrors.createdAt), importErrors.id).limit(size).offset(offset);
  const records = await db.select().from(observations).where(obsFilter).orderBy(desc(observations.importedAt), observations.id).limit(size).offset(offset);
  const pairs = await db.select({ pair: duplicateCandidates }).from(duplicateCandidates).innerJoin(aeds, eq(aeds.id, duplicateCandidates.firstId)).where(pairFilter).orderBy(duplicateCandidates.id).limit(size).offset(offset);
  const duplicateReviews = [];
  for (const { pair } of pairs) {
    const rows = await db.select().from(aeds).where(inArray(aeds.id, [pair.firstId, pair.secondId]));
    const first = rows.find(r => r.id === pair.firstId), second = rows.find(r => r.id === pair.secondId);
    if (!first || !second || second.mergedIntoId) continue;
    const originals = await db.select().from(observations).where(inArray(observations.aedId, [first.id, second.id]));
    duplicateReviews.push({ ...pair, first: serializeAed(first), second: serializeAed(second), originals: originals.map(original) });
  }
  const conflicts = await db.select().from(dataConflicts).where(eq(dataConflicts.status, "pending")).orderBy(dataConflicts.id).limit(size).offset(offset);
  const history=await db.select().from(mergeDecisions).orderBy(desc(mergeDecisions.createdAt)).limit(size).offset(offset);
  const decisions=await db.select().from(auditLogs).where(sql`${auditLogs.action} ilike '%duplikat%' or ${auditLogs.action} ilike '%scalen%' or ${auditLogs.action} ilike '%wspólne urządzenie%'`).orderBy(desc(auditLogs.createdAt)).limit(size).offset(offset);
  const [[jc], [ec], [rc], [dc], [cc]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(importJobs).where(jobFilter),
    db.select({ n: sql<number>`count(*)::int` }).from(importErrors).where(errorFilter),
    db.select({ n: sql<number>`count(*)::int` }).from(observations).where(obsFilter),
    db.select({ n: sql<number>`count(*)::int` }).from(duplicateCandidates).innerJoin(aeds, eq(aeds.id, duplicateCandidates.firstId)).where(pairFilter),
    db.select({ n: sql<number>`count(*)::int` }).from(dataConflicts).where(eq(dataConflicts.status, "pending")),
  ]);
  return GetIntegrationPanelResponse.parse({ ...empty, jobs: jobs.map(j => ({ ...j, createdAt: j.createdAt.toISOString(), finishedAt: j.finishedAt?.toISOString() ?? null })),
    errors: errors.map(e => ({ ...e, createdAt: e.createdAt.toISOString() })), records: records.map(original), duplicates: duplicateReviews, conflicts,
    mergeHistory:history.map(h=>({...h,createdAt:h.createdAt.toISOString(),undoneAt:h.undoneAt?.toISOString()??null})),
    decisionHistory:decisions.map(d=>({id:d.id,action:d.action,createdAt:d.createdAt.toISOString()})),
    jobTotal: jc!.n, errorTotal: ec!.n, recordTotal: rc!.n, duplicateTotal: dc!.n, conflictTotal: cc!.n });
}

export function registerIntegrations(app: FastifyInstance) {
  app.get("/api/admin/integrations", async req => {
    const user = requireUser(req, ["ADMIN"]);
    const q = z.object({ sourceId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(req.query);
    return panel(q.sourceId, q.page, false);
  });
  app.post("/api/admin/sync", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = realAdmin(req);
    const { sourceKey, mode } = StartSourceSyncBody.parse(req.body);
    await ensureSources();
    const keys = sourceKey === "all" ? SOURCE_DEFINITIONS.map(s => s.key) : [sourceKey];
    const reservations = [];
    for (const key of keys) {
      const reservation = await reserveSync(key as SourceKey, user.id);
      if (reservation) reservations.push(reservation);
    }
    if (!reservations.length) fail(409, "Wybrane źródła są już synchronizowane.");
    for (const reservation of reservations) void (mode === "append" ? executeAppendImport(reservation) : executeSync(reservation))
      .catch(() => logger.error({ jobId: reservation.job.id }, "Błąd kończenia importu."));
    return reply.code(202).send({ jobIds: reservations.map(r => r.job.id), message: mode === "append"
      ? "Uruchomiono import wyłącznie nowych AED. Istniejące dane pozostaną bez zmian."
      : "Uruchomiono synchronizację. Postęp jest widoczny w historii importów." });
  });
  app.post("/api/admin/source-test",{config:{rateLimit:{max:12,timeWindow:"1 minute"}}},async req=>{
    const user=realAdmin(req),{sourceId}=TestSourceConnectionBody.parse(req.body);
    const [source]=await db.select().from(sources).where(eq(sources.id,sourceId));
    if(!source)fail(404,"Nie znaleziono źródła.");
    return testConnection(source,user.id);
  });
  app.get("/api/provenance", async req => {
    const { aedId } = z.object({ aedId: z.string().uuid() }).parse(req.query);
    const [row] = await db.select().from(aeds).where(eq(aeds.id, aedId));
    if (!row || row.isDemo || row.mergedIntoId || !(req.account?.role==="ADMIN" || verificationState(row.verificationStatus) === "VERIFIED" || (verificationState(row.verificationStatus) === "NOT_VERIFIED" && row.imported && row.publicImport))) fail(404, "Brak publicznego rekordu.");
    return (await provenanceMap([aedId])).get(aedId) ?? [];
  });
  app.post("/api/admin/resolve-duplicate", async req => {
    const user = realAdmin(req);
    const input = ResolveDuplicateBody.parse(req.body);
    if(input.action==="undo"){
      const [d]=await db.select().from(mergeDecisions).where(and(eq(mergeDecisions.candidateId,input.candidateId),isNull(mergeDecisions.undoneAt))).orderBy(desc(mergeDecisions.createdAt)).limit(1);
      if(!d)fail(409,"Brak aktywnego scalenia do cofnięcia.");
      await undoMerge(d.id,user.id);
    } else if(input.action==="merge"){
      if(!input.keepId)fail(400,"Wybierz zachowywany rekord.");
      await mergeCandidate(input.candidateId,input.keepId,user.id);
      await refreshAggregation();
    } else await db.transaction(async tx=>{
      const [c]=await tx.update(duplicateCandidates).set({status:"rejected"}).where(and(eq(duplicateCandidates.id,input.candidateId),eq(duplicateCandidates.status,"pending"))).returning();
      if(!c)fail(409,"Kandydat został już rozpatrzony.");
      await tx.insert(auditLogs).values({userId:user.id,entityId:c.id,action:"Odrzucono duplikat",details:input});
    });
    return { status: "Zapisano decyzję i zachowano oryginalne źródła." };
  });
  app.post("/api/admin/resolve-conflict", async req => {
    const user = realAdmin(req);
    const input = ResolveDataConflictBody.parse(req.body);
    await db.transaction(async tx => {
      const [conflict] = await tx.select().from(dataConflicts).where(eq(dataConflicts.id, input.conflictId)).for("update");
      if (!conflict || conflict.status !== "pending") fail(409, "Konflikt został już rozpatrzony.");
      const [record] = await tx.select().from(aeds).where(eq(aeds.id, conflict.aedId)).for("update");
      if (!record || record.isDemo || record.mergedIntoId) fail(409, "Rekord nie jest dostępny do edycji.");
      const allowed = ["name", "address", "city", "postalCode", "description", "latitude", "longitude", "placement", "accessibility", "openingHours", "operationalStatus", "responsibleOrganization", "lastVerifiedAt","deviceIdentifier"];
      if (input.choice === "incoming") {
        if(conflict.field.startsWith("source:"))fail(400,"Deklaracja źródła nie jest oceną urządzenia. Użyj udokumentowanej oceny fizycznego AED; nie podnosimy statusu sprawności przez import.");
        if (!allowed.includes(conflict.field)) fail(400, "Zmiana licencji wymaga osobnej weryfikacji prawnej; zachowaj obecną wartość i wyjaśnij warunki źródła.");
        const [ref] = await tx.select().from(observations).where(eq(observations.id, conflict.observationId));
        if (!ref || ref.license !== record.license) fail(400, "Nie kopiujemy atrybutów pomiędzy różnymi licencjami. Zachowaj obecny opis i niezależne pochodzenie.");
        const value = conflict.field === "lastVerifiedAt" && conflict.incomingValue ? new Date(String(conflict.incomingValue)) : conflict.incomingValue;
        const coordinateChange=["latitude","longitude"].includes(conflict.field);
        const incoming=ref.normalizedRecord;
        const pair=coordinateChange?{latitude:typeof incoming?.latitude==="number"&&typeof incoming?.longitude==="number"?incoming.latitude:null,
          longitude:typeof incoming?.latitude==="number"&&typeof incoming?.longitude==="number"?incoming.longitude:null}:{};
        await tx.update(aeds).set({ [conflict.field]: value,...pair, verificationStatus: "NOT_VERIFIED", updatedAt: new Date(),
          recordVerificationStatus: "UNVERIFIED", deviceOperationalStatus: "UNKNOWN", verifiedAt: null,
          verificationEvidence: { ...record.verificationEvidence, invalidatedAt: new Date().toISOString(), reason: "Ręcznie zmieniono atrybut rekordu. Wymagana ponowna ocena urządzenia." },
        }).where(eq(aeds.id, record.id));
      }
      await tx.update(dataConflicts).set({ status: input.choice === "incoming" ? "accepted" : "kept" }).where(eq(dataConflicts.id, conflict.id));
      await tx.insert(auditLogs).values({ userId: user.id, entityId: conflict.id, action: "Rozstrzygnięto konflikt danych", details: input });
    });
    await refreshAggregation();
    return { status: "Zapisano rozstrzygnięcie." };
  });
}
