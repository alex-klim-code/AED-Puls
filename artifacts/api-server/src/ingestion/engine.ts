import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, aeds, sources, observations, observationVersions, importJobs, importErrors, dataConflicts, duplicateCandidates, auditLogs } from "@workspace/db";
import { connectSource,SOURCE_DEFINITIONS,type SourceKey } from "./connectors";
import { digest, normalizeRow, keyOf, preserveOriginal,legacyStableId } from "./normalize";
import { logger } from "../lib/logger";
import { matchRecords,operationalClaim } from "./matching";
import { mergeCandidate, refreshAggregation } from "./linkage";
import { ensureSources,sourceFamilyIds,registerDatasetSource,attachCopyEvidence,copiedAedIds,scheduledSource } from "./source-registry";
import { diagnostics,addIssue,diagnosticSummary,requiresLocationReview,recordCompleteness } from "./sync-diagnostics";
import { childCompletionStatus,sourceCompletionMessage } from "./completion-status";
import { resourceFingerprint } from "./resource-identity";
import { quarantineSourcePoints } from "./quarantine";
export { ensureSources } from "./source-registry";

export async function reserveSync(key: SourceKey, userId?: string) {
  if(!SOURCE_DEFINITIONS.some(s=>s.key===key))throw Object.assign(new Error("Nieznana integracja AED."),{statusCode:400});
  return db.transaction(async tx => {
    const token = randomUUID();
    const [source] = await tx.update(sources).set({
      lockedUntil: new Date(Date.now() + 30 * 60000), lockToken: token,
      status: "running", lastCheckedAt: new Date(), statusMessage: "Pobieranie i walidacja rzeczywistych danych.",
    }).where(and(eq(sources.key, key), or(isNull(sources.lockedUntil), sql`${sources.lockedUntil} < now()`))).returning();
    if (!source) return null;
    const family=await sourceFamilyIds(source);
    await tx.update(importJobs).set({ status: "interrupted", finishedAt: new Date() })
      .where(and(inArray(importJobs.sourceId, family), isNull(importJobs.finishedAt)));
    const [job] = await tx.insert(importJobs).values({ sourceId: source.id, userId, status: "running" }).returning();
    return { source, job: job!, token, key };
  });
}
type Reservation = NonNullable<Awaited<ReturnType<typeof reserveSync>>>;
const asJson = (input: unknown) => JSON.parse(JSON.stringify(input));
function declaredFunctionality(input:unknown){
  if(!input||typeof input!=="object")return null;
  const doc=input as Record<string,unknown>,raw=(doc.record??doc) as Record<string,unknown>;
  const props=(raw.properties??raw) as Record<string,unknown>;
  return operationalClaim(props["defibrillator:status"]??props.operational_status);
}
export const changedFields = ["name", "address", "city", "postalCode", "description", "latitude", "longitude", "placement", "accessibility", "openingHours", "operationalStatus", "license", "responsibleOrganization", "lastVerifiedAt", "deviceIdentifier"] as const;

export async function executeSync(reservation: Reservation, options: {
  connector?: typeof connectSource; afterSync?:()=>Promise<void>;
} = {}) {
  const { source, job, token, key } = reservation;
  if(!SOURCE_DEFINITIONS.some(s=>s.key===key))throw Object.assign(new Error("Nieznana integracja AED."),{statusCode:400});
  const counts = { processed: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
  const main=diagnostics(source,job.id,counts),runs=new Map([[source.id,main]]);
  let transportFailures = 0, lostLease = false, status = "succeeded";
  const lease = setInterval(() => {
    void db.update(sources).set({ lockedUntil: new Date(Date.now() + 30 * 60000) })
      .where(and(eq(sources.id, source.id), eq(sources.lockToken, token))).returning({ id: sources.id })
      .then(rows => { if (!rows.length) lostLease = true; })
      .catch(() => { lostLease = true; });
  }, 60000);
  lease.unref();
  const seen = new Set<string>();
  try {
    const family=await sourceFamilyIds(source);
    const previous = await db.select({ observation: observations, record: aeds }).from(observations)
      .leftJoin(aeds, eq(observations.aedId, aeds.id)).where(inArray(observations.sourceId, family));
    const existing = new Map(previous.map(p => [p.observation.sourceRecordId, p]));
    // Keep old observations and foreign keys when upgrading hash-based IDs to canonical key order.
    for(const p of previous)if(/\/[a-f0-9]{32}$/.test(p.observation.sourceRecordId)){
      const stable=legacyStableId(p.observation.originalRecord);
      if(stable&&!existing.has(stable))existing.set(stable,p);
    }
    const parents = [...new Set(previous.map(p=>p.record?.mergedIntoId).filter((x):x is string=>!!x))];
    const parentRows = parents.length ? await db.select().from(aeds).where(inArray(aeds.id,parents)) : [];
    const roots = new Map([...parentRows,...previous.flatMap(p=>p.record?[p.record]:[])].map(r=>[r.id,r]));
    for await (const packet of (options.connector??connectSource)(key)) {
      if (lostLease) throw new Error("Utracono blokadę synchronizacji.");
      let run=main;
      if(key==="dane-gov"&&/^\d+$/.test(packet.context.datasetId)&&packet.context.datasetTitle){
        const owner=await registerDatasetSource(packet,source);
        const found=runs.get(owner.id);
        if(found)run=found;
        else{
          const [childJob]=await db.insert(importJobs).values({sourceId:owner.id,userId:job.userId,status:"running",
            summary:{coordinatorJobId:job.id}}).returning();
          run=diagnostics(owner,childJob!.id);runs.set(owner.id,run);
        }
      }
      const owner=run.source;
      const bump=(field:keyof typeof counts,n=1)=>{counts[field]+=n;if(run!==main)run.counts[field]+=n;};
      const note=(issue:Parameters<typeof addIssue>[1])=>{addIssue(main,issue);if(run!==main)addIssue(run,issue);};
      await attachCopyEvidence(packet,owner.id);
      const copyPoints=await copiedAedIds(packet);
      if (packet.issue) {
        note(packet.issue);
        await db.insert(importErrors).values({ sourceId: owner.id, jobId: run.jobId, ...packet.issue, sourceRecordId: packet.context.resourceId });
        if (packet.issue.severity === "error") { bump("errors");transportFailures++;run.transportFailures++;if(run!==main)main.transportFailures++; }
        if(packet.issue.rule==="resource_copy"){
          const duplicates=Number(packet.metadata?.duplicateRows??0);
          if(Number.isInteger(duplicates)&&duplicates>0&&duplicates<=100000){
            bump("processed",duplicates);bump("skipped",duplicates);main.duplicates+=duplicates;if(run!==main)run.duplicates+=duplicates;
          }
        }
      }
      const date = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value) : null;
      if (packet.rows.length) await db.update(sources).set({
        officialProvenance: packet.context.sourceCategory ?? "UNKNOWN",
        sourceType: owner.key?.startsWith("dane-gov:") ? "catalogue_dataset" : packet.context.resourceFormat??"geojson",
        publisherId: packet.context.publisherId ?? null,
        datasetUrl: packet.context.datasetUrl,resourceId: packet.context.resourceId,
        provenanceEvidence: sql`${sources.provenanceEvidence} || ${JSON.stringify(packet.context.provenanceEvidence??{})}::jsonb`,
        lastUpdatedAt: date(packet.context.modified), lastSyncedAt: new Date(),
      }).where(eq(sources.id, owner.id));
      for (let offset = 0; offset < packet.rows.length; offset += 200) {
        if (lostLease) throw new Error("Utracono blokadę synchronizacji.");
        const before = { ...counts },beforeRun={...run.counts},beforeValid=run.validRecords,beforeDuplicates=run.duplicates,
          mainValid=main.validRecords,mainDuplicates=main.duplicates,
          mainStatuses={...main.recordStatuses},runStatuses={...run.recordStatuses};
        const newAeds: (typeof aeds.$inferInsert)[] = [];
        const originals: (typeof observations.$inferInsert)[] = [];
        const errors: (typeof importErrors.$inferInsert)[] = [];
        const conflicts: { aedId: string; observationId: string; field: string; currentValue: unknown; incomingValue: unknown }[] = [];
        const classifications: { id: string; category: string }[] = [];
        const quarantineIds:string[]=[];
        for (const original of packet.rows.slice(offset, offset + 200)) {
          bump("processed");
          const row = normalizeRow({ original, context: packet.context });
          const hash = digest({ original, context: packet.context });
          if (seen.has(row.id)) {
            bump("skipped");main.duplicates++;if(run!==main)run.duplicates++;
            const issue={severity:"warning" as const,rule:"duplicate_source_id",message:"Powtórzony identyfikator w tym imporcie; nie utworzono kolejnego AED (możliwy alternatywny format)."};
            note(issue);errors.push({ sourceId: owner.id, jobId: run.jobId, sourceRecordId: row.id,...issue });
            continue;
          }
          seen.add(row.id);
          for(const diagnostic of run===main?[main]:[main,run]){
            if(!row.data)diagnostic.recordStatuses.unparseable++;
            else diagnostic.recordStatuses[recordCompleteness(row.data)==="COMPLETE"?"complete":"incomplete"]++;
            if(requiresLocationReview(row.issues))diagnostic.recordStatuses.locationReview++;
          }
          if(row.data&&!row.issues.some(i=>i.severity==="error")){main.validRecords++;if(run!==main)run.validRecords++;}
          for (const issue of row.issues) {
            note(issue);errors.push({ sourceId: owner.id, jobId: run.jobId, sourceRecordId: row.id, ...issue });
            if (issue.severity === "error") bump("errors");
          }
          const old = existing.get(row.id);
          const head = old?.record?.mergedIntoId ? roots.get(old.record.mergedIntoId) : old?.record;
          if(requiresLocationReview(row.issues)&&head)quarantineIds.push(head.id);
          if (row.data && old?.record && !old.record.mergedIntoId && old.record.sourceCategory !== row.data.sourceCategory) {
            classifications.push({ id: old.record.id, category: row.data.sourceCategory });
          }
          let aedId = old?.observation.aedId ?? copyPoints.get(resourceFingerprint([original])) ?? null;
          if (row.data && !aedId) {
            aedId = randomUUID();
            newAeds.push({
              ...row.data, id: aedId, imported: true, publicImport: !row.issues.some(i => i.severity === "error"),
              verificationStatus: "NOT_VERIFIED", isDemo: false,
              locationEvidence:{method:"source_import",issues:row.issues,requiresLocationReview:requiresLocationReview(row.issues),
                autoGeocodeEligible:row.issues.some(i=>i.rule==="missing_coordinates")&&!row.issues.some(i=>["outside_poland","border_review","inconsistent_coordinate_axes"].includes(i.rule))},
            });
            bump("imported");
          } else if (old && old.observation.contentHash !== hash) {
            bump("updated");
            if (row.data && head) {
              const previousClaim=operationalClaim(old.observation.normalizedRecord?.sourceOperationalClaim)??declaredFunctionality(old.observation.originalRecord);
              const incomingClaim=declaredFunctionality(original);
              if(previousClaim!==incomingClaim)conflicts.push({aedId:head.id,observationId:old.observation.id,field:"source:operationalStatus",
                currentValue:previousClaim??"UNKNOWN",incomingValue:incomingClaim??"UNKNOWN"});
              for (const field of changedFields) {
                const incoming = asJson(row.data[field]);
                const prior = old.observation.normalizedRecord?.[field];
                if (JSON.stringify(incoming) !== JSON.stringify(prior) && JSON.stringify(incoming) !== JSON.stringify(asJson(head[field]))) {
                  conflicts.push({ aedId: head.id, observationId: old.observation.id, field, currentValue: asJson(head[field]), incomingValue: incoming });
                }
              }
            }
          } else if (!old&&aedId){bump("skipped");main.duplicates++;if(run!==main)run.duplicates++;}
          else if (old) bump("skipped");
          else if (!row.data) bump("skipped");
          originals.push({
            id: old?.observation.id ?? randomUUID(), sourceId: owner.id, sourceRecordId: row.id, aedId,
            originalRecord: preserveOriginal({ record: original, metadata: packet.metadata ?? {}, context: packet.context }),
            sourceUrl: row.data?.sourceUrl ?? packet.context.url, license: packet.context.license,
            publisher: packet.context.publisher || null, datasetUrl: packet.context.datasetUrl,
            resourceId: packet.context.resourceId, contentHash: hash,
            normalizedRecord: row.data ? asJson({...row.data,locationReviewRequired:requiresLocationReview(row.issues),sourceOperationalClaim:declaredFunctionality(original)}) : null,
            removedAt: null,
            officialProvenance: packet.context.sourceCategory ?? "UNKNOWN", provenanceEvidence: packet.context.provenanceEvidence ?? {},
            publisherId: packet.context.publisherId ?? null, datasetId: packet.context.datasetId,
            datasetTitle: packet.context.datasetTitle ?? null, resourceFormat: packet.context.resourceFormat ?? null,
            publishedAt: date(packet.context.published), geographicScope: packet.context.coverage,
            referenceScope: packet.context.referenceScope ?? null, reuseConditions: packet.context.reuseConditions ?? {},
            sourceModifiedAt: packet.context.modified && Number.isFinite(Date.parse(packet.context.modified)) ? new Date(packet.context.modified) : null,
            lastSyncedAt: new Date(),
          });
        }
        await db.transaction(async tx => {
          if (newAeds.length) await tx.insert(aeds).values(newAeds);
          // Immutable versions precede an update; original source documents are never discarded.
          const versions = originals.flatMap(r=>{
            const before=existing.get(r.sourceRecordId)?.observation;
            return [
              ...(before?.contentHash && (before.contentHash!==r.contentHash||before.sourceId!==r.sourceId||before.sourceRecordId!==r.sourceRecordId) ? [{observationId:before.id,contentHash:before.contentHash,document:asJson(before)}] : []),
            ];
          });
          if(versions.length) await tx.insert(observationVersions).values(versions).onConflictDoNothing();
          // Move publication ownership without replacing IDs, clinical records, conflicts or history.
          for(const r of originals){
            const old=existing.get(r.sourceRecordId)?.observation;
            if(old&&(old.sourceId!==r.sourceId||old.sourceRecordId!==r.sourceRecordId))
              await tx.update(observations).set({sourceId:r.sourceId,sourceRecordId:r.sourceRecordId}).where(eq(observations.id,old.id));
          }
          if (originals.length) await tx.insert(observations).values(originals).onConflictDoUpdate({
            target: [observations.sourceId, observations.sourceRecordId],
            set: {
              aedId: sql`excluded.aed_id`, originalRecord: sql`excluded.original_record`, sourceUrl: sql`excluded.source_url`,
              license: sql`excluded.license`, publisher: sql`excluded.publisher`, datasetUrl: sql`excluded.dataset_url`,
              resourceId: sql`excluded.resource_id`, contentHash: sql`excluded.content_hash`, normalizedRecord: sql`excluded.normalized_record`,
              sourceModifiedAt: sql`excluded.source_modified_at`, lastSyncedAt: sql`excluded.last_synced_at`,
              officialProvenance: sql`excluded.official_provenance`, provenanceEvidence: sql`excluded.provenance_evidence`,
              publisherId: sql`excluded.publisher_id`, datasetId: sql`excluded.dataset_id`, datasetTitle: sql`excluded.dataset_title`,
              resourceFormat: sql`excluded.resource_format`, publishedAt: sql`excluded.published_at`,
              removedAt: null,
              geographicScope: sql`excluded.geographic_scope`, referenceScope: sql`excluded.reference_scope`, reuseConditions: sql`excluded.reuse_conditions`,
            },
          });
          if (errors.length) await tx.insert(importErrors).values(errors);
          await quarantineSourcePoints(tx,[...new Set(quarantineIds)],owner.id,job.userId);
          for (const category of new Set(classifications.map(c => c.category))) {
            await tx.update(aeds).set({ sourceCategory: category }).where(inArray(aeds.id, classifications.filter(c => c.category === category).map(c => c.id)));
          }
          for (const conflict of conflicts) {
            // A changed distribution license must be reviewed before any further publication.
            if (conflict.field === "license") await tx.update(aeds).set({ publicImport: false, verificationStatus: "unverified" }).where(eq(aeds.id, conflict.aedId));
            const [pending] = await tx.select({ id: dataConflicts.id }).from(dataConflicts).where(and(
              eq(dataConflicts.observationId, conflict.observationId), eq(dataConflicts.field, conflict.field), eq(dataConflicts.status, "pending"),
            ));
            if (pending) await tx.update(dataConflicts).set({ incomingValue: conflict.incomingValue }).where(eq(dataConflicts.id, pending.id));
            else await tx.insert(dataConflicts).values(conflict);
          }
          await tx.update(importJobs).set({ ...counts, summary: { lastResource: packet.context.resourceId,...diagnosticSummary(main) } }).where(eq(importJobs.id, job.id));
          if(run!==main)await tx.update(importJobs).set({...run.counts,summary:{coordinatorJobId:job.id,...diagnosticSummary(run)}}).where(eq(importJobs.id,run.jobId));
        }).catch(error => {
          Object.assign(counts, before);
          Object.assign(run.counts,beforeRun);run.validRecords=beforeValid;run.duplicates=beforeDuplicates;
          main.validRecords=mainValid;main.duplicates=mainDuplicates;
          main.recordStatuses=mainStatuses;run.recordStatuses=runStatuses;
          const cause = error?.cause;
          throw new Error(cause?.message ? `Błąd zapisu danych (${cause.code ?? "DB"}): ${cause.message}. ${String(cause.detail ?? "").slice(0, 300)}` : "Nie udało się atomowo zapisać partii importu.");
        });
      }
    }
    if (!counts.processed) throw new Error("Źródło nie dostarczyło żadnego rekordu. Zachowano dotychczasowe dane.");
    status = transportFailures ? "partial" : "succeeded";
    // Absence is meaningful only after a complete, nonempty snapshot; never after an API failure.
    if(status==="succeeded") await db.update(observations).set({removedAt:new Date()}).where(and(
      inArray(observations.sourceId,await sourceFamilyIds(source)),isNull(observations.removedAt),
      sql`${observations.lastSyncedAt}<(select created_at from import_jobs where id=${job.id})`));
    if(options.afterSync)await options.afterSync();
    else { await detectDuplicates(); await refreshAggregation(); }
  } catch (e) {
    status = "failed";
    counts.errors++;
    addIssue(main,{severity:"error",rule:"sync_failed",message:e instanceof Error?e.message:"Błąd synchronizacji."});
    await db.insert(importErrors).values({ sourceId: source.id, jobId: job.id, severity: "error", rule: "sync_failed", message: (e instanceof Error ? e.message : "Błąd synchronizacji.").slice(0, 1500) });
    logger.warn({ sourceKey: key, jobId: job.id }, "Synchronizacja źródła nie została ukończona; zachowano istniejące dane.");
  } finally {
    clearInterval(lease);
    await db.transaction(async tx => {
      await tx.update(importJobs).set({ ...counts, status, finishedAt: new Date(),summary:diagnosticSummary(main) }).where(eq(importJobs.id, job.id));
      await tx.update(sources).set({
        status, statusMessage: sourceCompletionMessage(main,status),
        ...(status === "succeeded" ? { lastSuccessAt: new Date() } : {}),
        lockedUntil: null, lockToken: null,
      }).where(and(eq(sources.id, source.id), eq(sources.lockToken, token)));
      for(const run of runs.values()){
        if(run===main)continue;
        const childStatus=childCompletionStatus(run.counts.processed,run.transportFailures,status==="failed");
        const message=sourceCompletionMessage(run,childStatus);
        await tx.update(importJobs).set({...run.counts,status:childStatus,finishedAt:new Date(),
          summary:{coordinatorJobId:job.id,...diagnosticSummary(run)}}).where(eq(importJobs.id,run.jobId));
        await tx.update(sources).set({status:childStatus,statusMessage:message,lastCheckedAt:new Date(),
          ...(childStatus==="succeeded"?{lastSuccessAt:new Date()}:{})}).where(eq(sources.id,run.source.id));
        // One failed city endpoint must not prevent completeness tracking of another successful dataset.
        if(childStatus==="succeeded")await tx.update(observations).set({removedAt:new Date()}).where(and(
          eq(observations.sourceId,run.source.id),isNull(observations.removedAt),
          sql`${observations.lastSyncedAt}<(select created_at from import_jobs where id=${job.id})`));
      }
      await tx.insert(auditLogs).values({ userId: job.userId, action: `Synchronizacja ${source.name}: ${status}`, entityId: job.id, details: counts });
    });
  }
  return { jobId: job.id, status, ...counts };
}

function distance(a: { latitude: number|null; longitude: number|null }, b: { latitude: number|null; longitude: number|null }) {
  if(a.latitude==null||a.longitude==null||b.latitude==null||b.longitude==null)return Infinity;
  const r = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * r / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin((b.longitude - a.longitude) * r / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export async function detectDuplicates() {
  const rows = await db.select().from(aeds).where(and(eq(aeds.isDemo,false),isNull(aeds.mergedIntoId)));
  const claimRows=await db.select({root:sql<string>`coalesce(${aeds.mergedIntoId},${aeds.id})`,
    claim:sql<string|null>`coalesce(${observations.normalizedRecord}->>'sourceOperationalClaim',
      ${observations.originalRecord}#>>'{record,properties,defibrillator:status}',
      ${observations.originalRecord}#>>'{record,operational_status}')`}).from(observations)
    .innerJoin(aeds,eq(observations.aedId,aeds.id)).where(isNull(observations.removedAt));
  const claims=new Map<string,string[]>();
  for(const r of claimRows)if(r.claim){const group=claims.get(r.root)??[];group.push(r.claim);claims.set(r.root,group);}
  const known = await db.select().from(duplicateCandidates);
  const handled=new Map(known.map(p=>[[p.firstId,p.secondId].sort().join("/"),p]));
  const buckets=new Map<string,typeof rows>(), serials=new Map<string,typeof rows>();
  const seen=new Set<string>(), evaluated:{firstId:string;secondId:string;reason:string;score:number;evidence:ReturnType<typeof matchRecords>;blockingConflict:boolean;status:string}[]=[];
  const latSize=100/111000,lonSize=100/(111000*Math.cos(55*Math.PI/180));
  const compare=(a:typeof rows[number],b:typeof rows[number])=>{
    const [firstId,secondId]=[a.id,b.id].sort() as [string,string],pair=`${firstId}/${secondId}`;
    if(seen.has(pair))return;seen.add(pair);
    const old=handled.get(pair);if(old && old.status!=="pending")return;
    const result=matchRecords({...a,sourceOperationalClaims:claims.get(a.id)},{...b,sourceOperationalClaims:claims.get(b.id)});
    if(!result.candidate && !old)return;
    evaluated.push({firstId,secondId,score:result.score,evidence:result,blockingConflict:result.blockingConflict,
      reason:[...result.reasons,...result.conflicts].join(". "),status:result.candidate?"pending":"below_threshold"});
  };
  for(const a of rows) {
    const x=a.latitude==null?null:Math.floor(a.latitude/latSize),y=a.longitude==null?null:Math.floor(a.longitude/lonSize);
    if(x!==null&&y!==null)for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for(const b of buckets.get(`${x+dx}/${y+dy}`)??[])compare(a,b);
    }
    if(a.deviceIdentifier) {
      const key=a.deviceIdentifier.trim().toUpperCase(),group=serials.get(key)??[];
      for(const b of group)compare(a,b);group.push(a);serials.set(key,group);
    }
    if(x!==null&&y!==null){const bucket=buckets.get(`${x}/${y}`)??[];bucket.push(a);buckets.set(`${x}/${y}`,bucket);}
  }
  await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(7349251)`);
    for(const item of evaluated) {
      const [old]=await tx.select().from(duplicateCandidates).where(and(eq(duplicateCandidates.firstId,item.firstId),eq(duplicateCandidates.secondId,item.secondId)));
      if(old?.status==="pending")await tx.update(duplicateCandidates).set(item).where(eq(duplicateCandidates.id,old.id));
      else if(!old)await tx.insert(duplicateCandidates).values(item);
    }
  });
  const automatic=await db.select().from(duplicateCandidates).where(and(eq(duplicateCandidates.status,"pending"),eq(duplicateCandidates.blockingConflict,false),sql`${duplicateCandidates.evidence}->>'autoMerge'='true'`));
  for(const p of automatic)try{await mergeCandidate(p.id,p.firstId,null,true);}catch(e){if((e as {statusCode?:number}).statusCode!==409)throw e;}
}

export function startScheduler() {
  let stopped = false, checking = false;
  const check = async () => {
    if (stopped || checking) return;
    checking = true;
    try {
      await ensureSources();
      const all = await db.select().from(sources).where(isNotNull(sources.key));
      for (const source of all) {
        if(!scheduledSource(source))continue;
        if (stopped) return;
        const due = !source.lastSuccessAt || Date.now() - source.lastSuccessAt.getTime() >= 86400000;
        const cooldown = source.lastCheckedAt && Date.now() - source.lastCheckedAt.getTime() < 3600000;
        if (!due || cooldown) continue;
        const reserved = await reserveSync(source.key as SourceKey);
        if (reserved) await executeSync(reserved);
      }
    } catch { logger.error("Nie udało się sprawdzić harmonogramu importów."); }
    finally { checking = false; }
  };
  const initial = setTimeout(() => void check(), 3000); initial.unref();
  const timer = setInterval(() => void check(), 60000); timer.unref();
  return () => { stopped = true; clearTimeout(initial); clearInterval(timer); };
}
