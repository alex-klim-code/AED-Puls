import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull, or, ilike, sql } from "drizzle-orm";
import { db,aeds,auditLogs } from "@workspace/db";
import { z } from "zod/v4";
import { UpdateAdminRecordBody,ListAdminRecordsResponse } from "@workspace/api-zod";
import { requireUser,fail } from "./auth";
import { serializeAed } from "./aeds";
import { locatedClause,verificationState } from "./record-state";
import type { Actor,Tx } from "./proposal-service";

export async function applyAdminRecordCorrection(tx:Tx,user:Actor,id:string,input:ReturnType<typeof UpdateAdminRecordBody.parse>,approved=false){
    const{expectedUpdatedAt,...changes}=input;
    if(!Object.keys(changes).length)fail(400,"Nie wskazano pól do uzupełnienia.");
    if(!expectedUpdatedAt||!Number.isFinite(Date.parse(expectedUpdatedAt)))fail(400,"Odśwież rekord przed zapisaniem zmian.");
    const[before]=await tx.select().from(aeds).where(eq(aeds.id,id)).for("update");
    if(!before||before.mergedIntoId||before.isDemo)fail(404,"Nie znaleziono samodzielnego rekordu AED.");
    const trimmed=Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,typeof v==="string"?v.trim():v]));
    const changedFields=Object.keys(trimmed).filter(k=>JSON.stringify(trimmed[k])!==JSON.stringify(before[k as keyof typeof before]));
    if(!changedFields.length)fail(400,"Poprawka nie zmienia danych. Zgłoszenie niezasadne można odrzucić z uzasadnieniem.");
    const latitude=changes.latitude===undefined?before.latitude:changes.latitude,longitude=changes.longitude===undefined?before.longitude:changes.longitude;
    if((latitude==null)!==(longitude==null))fail(400,"Podaj obie współrzędne lub usuń obie.");
    const locationChanged=["latitude","longitude","address","city","postalCode"].some(key=>changedFields.includes(key));
    const [updated]=await tx.update(aeds).set({...trimmed,
      verificationStatus:approved?"VERIFIED":verificationState(before.verificationStatus)==="REJECTED"?"REJECTED":"NOT_VERIFIED",
      ...(locationChanged?{locationEvidence:{method:"administrator_edit",actorId:user.id,changedAt:new Date().toISOString(),notDeviceVerification:true,
        autoGeocodeEligible:before.imported&&latitude==null&&longitude==null&&["address","city","postalCode"].some(k=>k in trimmed),
        ...(before.locationEvidence.geocodingDependency?{geocodingDependency:before.locationEvidence.geocodingDependency}:{})},
        recordVerificationStatus:"UNVERIFIED",deviceOperationalStatus:"UNKNOWN",verifiedAt:null,verificationEvidence:{}}:{}),
      updatedAt:sql`clock_timestamp()`}).where(and(eq(aeds.id,id),sql`${aeds.updatedAt}=${expectedUpdatedAt}::timestamptz`))
      .returning({record:aeds,revision:sql<string>`${aeds.updatedAt}::text`});
    if(!updated)fail(409,"Rekord zmienił się od otwarcia formularza. Odśwież go, aby nie nadpisać cudzych zmian.");
    await tx.insert(auditLogs).values({userId:user.id,entityId:id,action:"Uzupełniono rekord AED",
      details:JSON.parse(JSON.stringify({before,after:updated.record,changedFields,originalSourceDataPreserved:true,notDeviceVerification:true}))});
    return {after:updated.record,revision:updated.revision};
}
export function registerAdminRecords(app:FastifyInstance){
  app.get("/api/admin/records",async req=>{
    requireUser(req,["ADMIN"]);
    const q=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),
      missingLocation:z.enum(["true","false"]).default("false"),needsLocationReview:z.enum(["true","false"]).default("false"),search:z.string().max(200).optional()}).parse(req.query);
    const base=and(eq(aeds.isDemo,false),isNull(aeds.mergedIntoId));
    const missing=sql`not (${locatedClause()})`;
    // Review imported claims without overriding a human-approved location. Legacy
    // snapshots predate structured flags, so consult their retained quality diagnostics.
    const review=sql`${aeds.verificationStatus} not in ('VERIFIED','verified','REJECTED','rejected')
      and coalesce(${aeds.locationEvidence}->>'method','')<>'administrator_edit' and (
        ${aeds.locationEvidence}->>'requiresLocationReview'='true' or ${aeds.id} in (
          select coalesce(f.merged_into_id,f.id) from source_observations o join aed_records f on f.id=o.aed_id
          where o.removed_at is null and (
            o.normalized_record->>'locationReviewRequired'='true'
            or nullif(o.original_record#>>'{context,coordinateHoldReason}','') is not null
            or exists(select 1 from jsonb_array_elements_text(
              case when jsonb_typeof(o.normalized_record->'qualityIssues')='array' then o.normalized_record->'qualityIssues' else '[]'::jsonb end
            ) issue where issue like 'Współrzędne poza zakresem Polski%' or issue like 'Punkt poza obrysem Polski%')
          )
        ))`;
    const [counts]=await db.select({total:sql<number>`count(*)::int`,
      missingLocationCount:sql<number>`count(*) filter(where ${missing})::int`,
      incompleteCount:sql<number>`count(*) filter(where ${aeds.completenessStatus}='INCOMPLETE')::int`,
      locationReviewCount:sql<number>`count(*) filter(where ${review})::int`}).from(aeds).where(base);
    const term=q.search?`%${q.search.replace(/[%_\\]/g,"\\$&")}%`:undefined;
    const where=and(base,q.missingLocation==="true"?missing:undefined,q.needsLocationReview==="true"?review:undefined,term?or(ilike(aeds.name,term),ilike(aeds.address,term),ilike(aeds.city,term),sql`${aeds.id}::text ilike ${term}`):undefined);
    const [filtered]=await db.select({total:sql<number>`count(*)::int`}).from(aeds).where(where);
    const rows=await db.select({record:aeds,revision:sql<string>`${aeds.updatedAt}::text`}).from(aeds).where(where)
      .orderBy(desc(aeds.updatedAt),aeds.id).limit(50).offset((q.page-1)*50);
    return ListAdminRecordsResponse.parse({records:rows.map(r=>({...serializeAed(r.record),revision:r.revision})),
      total:filtered!.total,missingLocationCount:counts!.missingLocationCount,incompleteCount:counts!.incompleteCount,locationReviewCount:counts!.locationReviewCount,page:q.page});
  });
  app.patch("/api/admin/aeds/:id",async req=>{
    const user=requireUser(req,["ADMIN"]),id=z.uuid().parse((req.params as{id:string}).id),input=UpdateAdminRecordBody.parse(req.body);
    const{expectedUpdatedAt,...changes}=input;
    if(!Object.keys(changes).length)fail(400,"Nie wskazano pól do uzupełnienia.");
    if(!expectedUpdatedAt||!Number.isFinite(Date.parse(expectedUpdatedAt)))fail(400,"Odśwież rekord przed zapisaniem zmian.");
    const result=await db.transaction(async tx=>{
      const[before]=await tx.select().from(aeds).where(eq(aeds.id,id)).for("update");
      if(!before||before.mergedIntoId||before.isDemo)fail(404,"Nie znaleziono samodzielnego rekordu AED.");
      const latitude=changes.latitude===undefined?before.latitude:changes.latitude,longitude=changes.longitude===undefined?before.longitude:changes.longitude;
      if((latitude==null)!==(longitude==null))fail(400,"Podaj obie współrzędne lub usuń obie. Nie uzupełniamy brakujących wartości zerami.");
      const trimmed=Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,typeof v==="string"?v.trim():v]));
      const locationChanged=["latitude","longitude","address","city","postalCode"].some(key=>key in trimmed&&JSON.stringify(trimmed[key])!==JSON.stringify(before[key as keyof typeof before]));
      const [updated]=await tx.update(aeds).set({...trimmed,
        verificationStatus:verificationState(before.verificationStatus)==="REJECTED"?"REJECTED":"NOT_VERIFIED",
        ...(locationChanged?{locationEvidence:{method:"administrator_edit",actorId:user.id,changedAt:new Date().toISOString(),notDeviceVerification:true,
          autoGeocodeEligible:before.imported&&latitude==null&&longitude==null&&["address","city","postalCode"].some(k=>k in trimmed),
          ...(before.locationEvidence.geocodingDependency?{geocodingDependency:before.locationEvidence.geocodingDependency}:{})},
          recordVerificationStatus:"UNVERIFIED",deviceOperationalStatus:"UNKNOWN",verifiedAt:null,verificationEvidence:{}}:{}),
        updatedAt:sql`clock_timestamp()`}).where(and(eq(aeds.id,id),sql`${aeds.updatedAt}=${expectedUpdatedAt}::timestamptz`))
        .returning({record:aeds,revision:sql<string>`${aeds.updatedAt}::text`});
      if(!updated)fail(409,"Rekord zmienił się od otwarcia formularza. Odśwież go, aby nie nadpisać cudzych zmian.");
      const after=updated.record;
      await tx.insert(auditLogs).values({userId:user.id,entityId:id,action:"Uzupełniono rekord AED",
        details:JSON.parse(JSON.stringify({before,after,changedFields:Object.keys(trimmed),originalSourceDataPreserved:true}))});
      return{after,revision:updated.revision};
    });
    return{...serializeAed(result.after),revision:result.revision};
  });
  app.get("/api/admin/aeds/:id/history",async req=>{
    requireUser(req,["ADMIN"]);const id=z.uuid().parse((req.params as{id:string}).id);
    const events=await db.select().from(auditLogs).where(eq(auditLogs.entityId,id)).orderBy(desc(auditLogs.createdAt)).limit(200);
    return events.map(e=>({id:e.id,action:e.action,createdAt:e.createdAt.toISOString(),details:e.details}));
  });
}
