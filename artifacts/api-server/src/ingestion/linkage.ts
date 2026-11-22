import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, aeds, observations, sources, dataConflicts, duplicateCandidates, mergeDecisions, auditLogs } from "@workspace/db";
import { fail } from "../modules/auth";
import { matchRecords, operationalClaim } from "./matching";

const json = (x: unknown) => JSON.parse(JSON.stringify(x ?? null));
const fields = ["name","address","city","postalCode","description","latitude","longitude","placement","accessibility","openingHours","license","responsibleOrganization"] as const;
export async function refreshAggregation() {
  // A newly supported serial-number field may be derived from existing originals, never from an OSM object ID.
  await db.execute(sql`with serials as (
    select aed_id,min(serial) serial from (select aed_id,coalesce(normalized_record->>'deviceIdentifier',
      original_record#>>'{record,properties,defibrillator:serial_number}',original_record#>>'{record,properties,serial_number}',
      original_record#>>'{record,serial_number}') serial from source_observations where removed_at is null) x
    where serial is not null and length(trim(serial))>=5 group by aed_id having count(distinct serial)=1)
    update aed_records a set device_identifier=s.serial from serials s where a.id=s.aed_id and a.device_identifier is null`);
  // Cross-reference evidence establishes publisher identity even when a municipal unit has no own ID.
  await db.execute(sql`update source_observations o set primary_source_key=x.origin from
    (select o.id,case when s.key in ('openaedmap','openaed-eu') then 'osm'
      when o.provenance_evidence->>'method' in ('official_api_dataset_resource_institution','municipal_metadata_official_catalogue_cross_reference')
        and o.provenance_evidence->>'publisherId' is not null then 'gov-publisher:'||(o.provenance_evidence->>'publisherId')
      else null end as origin from source_observations o left join data_sources s on s.id=o.source_id) x
    where o.id=x.id and o.primary_source_key is distinct from x.origin`);
  // All merge links are flattened at write time. Publication identity ignores alternative formats.
  await db.execute(sql`with counts as
    (select coalesce(f.merged_into_id,f.id) root,
      count(distinct coalesce(o.source_id::text,'submission')||'/'||coalesce(o.dataset_id,o.resource_id,o.source_record_id))::int publications,
      count(distinct o.primary_source_key)::int origins
      from source_observations o join aed_records f on f.id=o.aed_id where o.removed_at is null group by 1),
    results as (select r.id,coalesce(c.publications,0) publications,coalesce(c.origins,0) origins,
      exists(select 1 from data_conflicts d where d.aed_id=r.id and d.status='pending') conflict
      from aed_records r left join counts c on c.root=r.id where r.is_demo=false and r.merged_into_id is null)
    update aed_records a set publication_count=r.publications,independent_source_count=r.origins,source_conflict=r.conflict
    from results r where r.id=a.id`);
}

export async function mergeCandidate(candidateId: string, keeperId: string, actorId: string | null, automatic = false) {
  const decision = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(78214124)`);
    const [c] = await tx.select().from(duplicateCandidates).where(eq(duplicateCandidates.id,candidateId)).for("update");
    if (!c || c.status !== "pending") fail(409,"Kandydat został już rozpatrzony.");
    const rows = await tx.select().from(aeds).where(inArray(aeds.id,[c.firstId,c.secondId])).orderBy(aeds.id).for("update");
    if (rows.length !== 2 || rows.some(r=>r.isDemo || r.mergedIntoId)) fail(409,"Urządzenia zmieniły się; odśwież porównanie.");
    if(automatic)keeperId=[...rows].sort((a,b)=>
      Number(!!b.verifiedAt)-Number(!!a.verifiedAt)
      || (b.verifiedAt?.getTime()??b.lastVerifiedAt?.getTime()??0)-(a.verifiedAt?.getTime()??a.lastVerifiedAt?.getTime()??0))[0]!.id;
    const keeper=rows.find(r=>r.id===keeperId), loser=rows.find(r=>r.id!==keeperId);
    if(!keeper || !loser) fail(400,"Wybierz zachowywany rekord.");
    const match=matchRecords(keeper,loser);
    if(automatic && !match.autoMerge) fail(409,"Dowody nie pozwalają na automatyczne scalenie.");
    const children=await tx.select().from(aeds).where(eq(aeds.mergedIntoId,loser.id)).for("update");
    const familyIds=[loser.id,...children.map(r=>r.id)];
    if(automatic){
      const keepChildren=await tx.select({id:aeds.id}).from(aeds).where(eq(aeds.mergedIntoId,keeper.id));
      const keepFamily=[keeper.id,...keepChildren.map(r=>r.id)];
      const [veto]=await tx.select().from(duplicateCandidates).where(and(
        inArray(duplicateCandidates.status,["rejected","rejected_after_unmerge"]),
        or(and(inArray(duplicateCandidates.firstId,familyIds),inArray(duplicateCandidates.secondId,keepFamily)),
          and(inArray(duplicateCandidates.secondId,familyIds),inArray(duplicateCandidates.firstId,keepFamily)))));
      if(veto)fail(409,"Administrator wcześniej rozdzielił te urządzenia. Automatyczne obejście decyzji jest zabronione.");
    }
    const refs=await tx.select().from(observations).where(inArray(observations.aedId,[keeper.id,...familyIds]));
    const sourceClaims=new Set(refs.map(r=>{
      const raw=r.originalRecord as {record?:{properties?:Record<string,unknown>;operational_status?:unknown}};
      return operationalClaim(r.normalizedRecord?.sourceOperationalClaim ?? raw?.record?.properties?.["defibrillator:status"] ?? raw?.record?.operational_status);
    }).filter(Boolean));
    const pending=await tx.select().from(dataConflicts).where(and(inArray(dataConflicts.aedId,familyIds),eq(dataConflicts.status,"pending")));
    if(automatic && (pending.length || sourceClaims.size>1 || refs.some(r=>r.license!==keeper.license))) fail(409,"Istnieje konflikt lub niezgodna licencja źródłowa.");
    const touched=await tx.select().from(duplicateCandidates).where(and(or(inArray(duplicateCandidates.firstId,familyIds),inArray(duplicateCandidates.secondId,familyIds)),eq(duplicateCandidates.status,"pending")));
    const added: string[]=[];
    for(const p of pending) await tx.update(dataConflicts).set({aedId:keeper.id}).where(eq(dataConflicts.id,p.id));
    const newConflict=async (observationId:string,field:string,incoming:unknown,current:unknown)=>{
      const [exists]=await tx.select().from(dataConflicts).where(and(eq(dataConflicts.aedId,keeper.id),eq(dataConflicts.observationId,observationId),eq(dataConflicts.field,field),eq(dataConflicts.status,"pending")));
      if(exists) return;
      const [row]=await tx.insert(dataConflicts).values({aedId:keeper.id,observationId,field,currentValue:json(current),incomingValue:json(incoming)}).returning();
      added.push(row!.id);
    };
    for(const ref of refs.filter(r=>familyIds.includes(r.aedId!))) {
      for(const field of fields) {
        if(ref.license!==keeper.license && field!=="license") continue;
        const incoming=ref.normalizedRecord && field in ref.normalizedRecord ? ref.normalizedRecord[field] : loser[field];
        if(JSON.stringify(json(incoming))!==JSON.stringify(json(keeper[field]))) await newConflict(ref.id,field,incoming,keeper[field]);
      }
      const claim=ref.normalizedRecord?.sourceOperationalClaim;
      const other=refs.find(r=>r.aedId===keeper.id)?.normalizedRecord?.sourceOperationalClaim;
      if(claim && other && claim!==other) await newConflict(ref.id,"source:operationalStatus",claim,other);
    }
    await tx.update(aeds).set({mergedIntoId:keeper.id,publicImport:false,updatedAt:new Date()}).where(inArray(aeds.id,familyIds));
    await tx.update(duplicateCandidates).set({status:"superseded"}).where(inArray(duplicateCandidates.id,touched.map(t=>t.id).length?touched.map(t=>t.id):[c.id]));
    await tx.update(duplicateCandidates).set({status:"merged"}).where(eq(duplicateCandidates.id,c.id));
    const [d]=await tx.insert(mergeDecisions).values({candidateId:c.id,keeperId:keeper.id,loserId:loser.id,actorId,
      mode:automatic?"automatic":"manual",createdAt:sql`clock_timestamp()`,before:json({rows:[loser,...children].map(r=>({id:r.id,mergedIntoId:r.mergedIntoId,publicImport:r.publicImport})),
        candidates:touched.map(r=>({id:r.id,status:r.status})),conflicts:pending,added,score:match})}).returning();
    await tx.insert(auditLogs).values({userId:actorId,entityId:d!.id,action:automatic?"Automatycznie powiązano tożsamość AED":"Potwierdzono wspólne urządzenie AED",details:{candidateId,keeperId,loserId:loser.id}});
    return d!;
  });
  return decision;
}

export async function undoMerge(id:string,actorId:string) {
  await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(78214124)`);
    const [d]=await tx.select().from(mergeDecisions).where(eq(mergeDecisions.id,id)).for("update");
    if(!d || d.undoneAt) fail(409,"To scalenie nie istnieje lub zostało już cofnięte.");
    const before=d.before as {rows:{id:string;mergedIntoId:string|null;publicImport:boolean}[];candidates:{id:string;status:string}[];conflicts:{id:string;aedId:string;currentValue:unknown}[];added:string[]};
    const later=await tx.select().from(mergeDecisions).where(and(isNull(mergeDecisions.undoneAt),
      sql`${mergeDecisions.createdAt}>(select created_at from ${mergeDecisions} where id=${d.id})`,
      sql`(${mergeDecisions.keeperId} in (${d.keeperId},${d.loserId}) or ${mergeDecisions.loserId} in (${d.keeperId},${d.loserId}))`));
    if(later.length) fail(409,"Najpierw cofnij późniejsze scalenia tych urządzeń.");
    for(const r of before.rows) {
      const [now]=await tx.select().from(aeds).where(eq(aeds.id,r.id)).for("update");
      if(!now || now.mergedIntoId!==d.keeperId) fail(409,"Powiązania urządzeń zmieniły się.");
      await tx.update(aeds).set({mergedIntoId:r.mergedIntoId,publicImport:r.publicImport,updatedAt:new Date()}).where(eq(aeds.id,r.id));
    }
    for(const c of before.conflicts) await tx.update(dataConflicts).set({aedId:c.aedId,currentValue:json(c.currentValue)}).where(and(eq(dataConflicts.id,c.id),eq(dataConflicts.status,"pending")));
    const restored=before.rows.map(r=>r.id);
    if(restored.length)await tx.execute(sql`update data_conflicts c set aed_id=root.id,current_value=case
      when c.field='source:operationalStatus' then coalesce(o.normalized_record->'sourceOperationalClaim',
        o.original_record#>'{record,properties,defibrillator:status}',o.original_record#>'{record,operational_status}',c.current_value)
      else coalesce(to_jsonb(root)->c.field,c.current_value) end
      from source_observations o join aed_records f on f.id=o.aed_id join aed_records root on root.id=coalesce(f.merged_into_id,f.id)
      where c.observation_id=o.id and c.status='pending' and ${inArray(sql`o.aed_id`,restored)}`);
    if(before.added.length)await tx.update(dataConflicts).set({status:"superseded_unmerge"}).where(and(inArray(dataConflicts.id,before.added),eq(dataConflicts.status,"pending"),sql`${dataConflicts.currentValue} is not distinct from ${dataConflicts.incomingValue}`));
    for(const c of before.candidates) await tx.update(duplicateCandidates).set({status:c.status}).where(eq(duplicateCandidates.id,c.id));
    await tx.update(duplicateCandidates).set({status:"rejected_after_unmerge"}).where(eq(duplicateCandidates.id,d.candidateId));
    await tx.update(mergeDecisions).set({undoneAt:new Date()}).where(eq(mergeDecisions.id,id));
    await tx.insert(auditLogs).values({userId:actorId,entityId:id,action:"Cofnięto scalenie AED",details:{keeperId:d.keeperId,loserId:d.loserId}});
  });
  await refreshAggregation();
}
