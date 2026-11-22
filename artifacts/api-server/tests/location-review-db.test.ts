import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq,inArray } from "drizzle-orm";
import { db,pool,sources,aeds,observations,observationVersions,importJobs,importErrors,auditLogs,users,dataConflicts } from "@workspace/db";
import { reserveSync,executeSync } from "../src/ingestion/engine";
import { sourceFamilyIds } from "../src/ingestion/source-registry";
import { reconcileSourceStatuses } from "../src/ingestion/reconcile-source-status";
import { buildApp } from "../src/app";
import type { SourceContext } from "../src/ingestion/normalize";

// Never publish fixtures: unknown rights, and an outside-country source location.
test("full invalid-coordinate imports are saved and reviewable; actual download failures remain partial",async()=>{
  const sourceId=randomUUID(),userId=randomUUID(),key=`location-review-test-${sourceId}`;
  const context:SourceContext={name:"TEST NIEPUBLICZNY",publisher:"TEST",license:"UNKNOWN",
    url:"https://example.org/private-test",datasetUrl:"https://example.org/private-test",datasetId:String(9e12+Math.floor(Math.random()*1e9)),
    datasetTitle:"TEST NIEPUBLICZNY",resourceId:"fixture",coverage:"TEST",modified:null};
  const original={id:"outside",name:"TEST NIEPUBLICZNY",latitude:48.85,longitude:2.35,address:"TEST",city:"TEST"};
  let app:Awaited<ReturnType<typeof buildApp>>|undefined;
  const family=new Set([sourceId]);let recordId="";
  const sync=async(fail=false)=>{
    const reservation=await reserveSync(key as never,userId);assert.ok(reservation);
    const result=await executeSync({...reservation,key:"dane-gov"},{connector:async function*(){
      yield {context,rows:[original],...(fail?{issue:{rule:"resource_failed",severity:"error" as const,message:"TEST: przekroczono czas pobierania"}}:{})};
    },afterSync:async()=>{}});
    for(const id of await sourceFamilyIds(reservation.source))family.add(id);
    return result;
  };
  try{
    const [account]=await db.insert(users).values({id:userId,name:"TEST NIEPUBLICZNY",role:"ADMIN",isDemo:false}).returning();
    await db.insert(sources).values({id:sourceId,key,name:"TEST NIEPUBLICZNY",url:context.url,license:"UNKNOWN",
      coverage:"TEST",institution:"TEST",datasetId:"test",updateFrequency:"TEST",authoritativeScope:"TEST",statusMessage:"TEST"});
    const result=await sync();assert.equal(result.status,"succeeded");assert.equal(result.imported,1);
    const [observation]=await db.select().from(observations).where(inArray(observations.sourceId,[...family]));
    assert.ok(observation?.aedId);recordId=observation.aedId;
    const [record]=await db.select().from(aeds).where(eq(aeds.id,recordId));
    assert.equal(record!.latitude,null);assert.equal(record!.longitude,null);assert.equal(record!.publicImport,false);
    assert.equal(record!.verificationStatus,"NOT_VERIFIED");assert.equal(record!.completenessStatus,"INCOMPLETE");
    assert.deepEqual((observation.originalRecord as any).record,original);
    const [child]=await db.select().from(sources).where(eq(sources.id,observation.sourceId!));
    assert.equal(child!.status,"succeeded");assert.match(child!.statusMessage,/do oceny lokalizacji przez administratora: 1/);
    const [job]=await db.select().from(importJobs).where(eq(importJobs.sourceId,child!.id));
    const summary=job!.summary as any;
    assert.equal(summary.validRecords,0);assert.equal(summary.recordStatuses.incomplete,1);assert.equal(summary.recordStatuses.locationReview,1);
    // Emulate the old persisted classification without altering any real history.
    const legacy={...summary};delete legacy.transportFailures;delete legacy.recordStatuses;
    await db.update(importJobs).set({status:"partial",summary:legacy}).where(eq(importJobs.id,job!.id));
    await db.update(sources).set({status:"partial"}).where(eq(sources.id,child!.id));
    assert.equal((await reconcileSourceStatuses([child!.id])).updated,1);
    assert.equal((await reconcileSourceStatuses([child!.id])).updated,0);
    assert.equal((await db.select().from(sources).where(eq(sources.id,child!.id)))[0]!.status,"succeeded");
    assert.equal((await db.select().from(importJobs).where(eq(importJobs.id,job!.id)))[0]!.status,"partial");

    app=await buildApp();let role="ADMIN";app.addHook("preHandler",async req=>{req.account={...account!,role};});
    const url=`/api/admin/records?needsLocationReview=true&search=${recordId}`;
    const response=await app.inject({url});assert.equal(response.statusCode,200,response.body);
    assert.equal(response.json().total,1);assert.ok(response.json().locationReviewCount>=1);
    role="USER";assert.equal((await app.inject({url})).statusCode,403);role="ADMIN";
    await db.update(aeds).set({locationEvidence:{method:"administrator_edit",notDeviceVerification:true}}).where(eq(aeds.id,recordId));
    assert.equal((await app.inject({url})).json().total,0);

    assert.equal((await sync(true)).status,"partial");
    const [partial]=await db.select().from(sources).where(eq(sources.id,child!.id));
    assert.equal(partial!.status,"partial");assert.match(partial!.statusMessage,/Problem pobierania: TEST/);
    const [parent]=await db.select().from(sources).where(eq(sources.id,sourceId));
    assert.match(parent!.statusMessage,/błędy pobierania lub zapisu: 1/);
    assert.equal((await db.select().from(observations).where(eq(observations.sourceId,child!.id))).length,1);
    await reconcileSourceStatuses([child!.id]);
    assert.equal((await db.select().from(sources).where(eq(sources.id,child!.id)))[0]!.status,"partial");
  }finally{
    if(app)await app.close();
    const ids=[...family],refs=await db.select({id:observations.id}).from(observations).where(inArray(observations.sourceId,ids));
    if(refs.length){await db.delete(dataConflicts).where(inArray(dataConflicts.observationId,refs.map(r=>r.id)));
      await db.delete(observationVersions).where(inArray(observationVersions.observationId,refs.map(r=>r.id)));}
    await db.delete(importErrors).where(inArray(importErrors.sourceId,ids));
    await db.delete(observations).where(inArray(observations.sourceId,ids));
    if(recordId){await db.delete(auditLogs).where(eq(auditLogs.entityId,recordId));await db.delete(aeds).where(eq(aeds.id,recordId));}
    await db.delete(auditLogs).where(eq(auditLogs.userId,userId));await db.delete(auditLogs).where(inArray(auditLogs.entityId,ids));
    await db.delete(importJobs).where(inArray(importJobs.sourceId,ids));await db.delete(sources).where(inArray(sources.id,ids));
    await db.delete(users).where(eq(users.id,userId));await pool.end();
  }
});
