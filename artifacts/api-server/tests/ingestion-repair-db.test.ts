import{test}from"node:test";
import assert from"node:assert/strict";
import{randomUUID}from"node:crypto";
import{eq,inArray}from"drizzle-orm";
import{db,pool,sources,observations,observationVersions,importJobs,importErrors,aeds,users,auditLogs,dataConflicts}from"@workspace/db";
import{reserveSync,executeSync}from"../src/ingestion/engine";
import{sourceFamilyIds}from"../src/ingestion/source-registry";
import{digest,type SourceContext}from"../src/ingestion/normalize";
import{buildApp}from"../src/app";

// Explicit development-only fixture run. Unknown licenses make every fixture nonpublic.
test("integration repairs preserve AED identity, original publishers, history and authorization",async t=>{
  const sourceId=randomUUID(),userId=randomUUID(),key=`repair-test-${sourceId}`;
  const datasetId=String(9e12+Math.floor(Math.random()*1e9));
  let source:typeof sources.$inferSelect,account:typeof users.$inferSelect,app:Awaited<ReturnType<typeof buildApp>>|undefined;
  const context:SourceContext={name:"Niepubliczny test napraw",publisher:"TEST",license:"UNKNOWN",
    url:"https://example.org/test",datasetUrl:"https://example.org/test",datasetId,resourceId:"test",
    datasetTitle:"TEST — nie publikować",coverage:"TEST",modified:null};
  const row={name:"Niepubliczny rekord testowy",latitude:52.23,longitude:21.01};
  const ids=new Set<string>();
  const run=async(child:boolean,down=false)=>{
    const reservation=await reserveSync(key as never,userId);assert.ok(reservation);
    const result=await executeSync({...reservation,key:child?"dane-gov":reservation.key},{
      connector:async function*(){if(down)throw new Error("TEST: przerwane pobieranie");yield{context,rows:[row]};},
      afterSync:async()=>{},
    });
    for(const id of await sourceFamilyIds(source))ids.add(id);
    return result;
  };
  try{
    [account]=await db.insert(users).values({id:userId,name:"Niepubliczny test napraw",role:"ADMIN",isDemo:false}).returning() as [typeof users.$inferSelect];
    [source]=await db.insert(sources).values({id:sourceId,key,name:"Niepubliczny test napraw",url:"https://example.org/test",
      license:"UNKNOWN",coverage:"TEST",institution:"TEST",datasetId:"test",updateFrequency:"TEST",
      authoritativeScope:"TEST — nie publikować",statusMessage:"TEST"}).returning() as [typeof sources.$inferSelect];
    ids.add(sourceId);
    let observationId="",aedId="";
    await t.test("legacy hash IDs migrate without a second AED or replacing observation IDs",async()=>{
      assert.equal((await run(false)).imported,1);
      const[first]=await db.select().from(observations).where(eq(observations.sourceId,sourceId));
      assert.ok(first?.aedId);observationId=first.id;aedId=first.aedId;
      const legacyId=`${datasetId}/${digest(row).slice(0,32)}`;
      await db.update(observations).set({sourceRecordId:legacyId}).where(eq(observations.id,first.id));
      assert.equal((await run(false)).imported,0);
      const after=await db.select().from(observations).where(eq(observations.sourceId,sourceId));
      assert.equal(after.length,1);assert.equal(after[0]!.id,observationId);assert.equal(after[0]!.aedId,aedId);
    });
    await t.test("discovered publishers own existing observations without discarding history or clinical status",async()=>{
      assert.equal((await run(true)).imported,0);
      const[child]=await db.select().from(sources).where(eq(sources.key,`dane-gov:${datasetId}`));
      assert.ok(child);ids.add(child.id);
      assert.equal(child.institution,"TEST");
      const[observation]=await db.select().from(observations).where(eq(observations.id,observationId));
      assert.equal(observation!.sourceId,child.id);assert.equal(observation!.aedId,aedId);
      const[record]=await db.select().from(aeds).where(eq(aeds.id,aedId));
      assert.equal(record!.publicImport,false);assert.equal(record!.verificationStatus,"NOT_VERIFIED");
      assert.equal(record!.operationalStatus,"unknown");
      assert.ok((await db.select().from(observationVersions).where(eq(observationVersions.observationId,observationId))).length>0);
      assert.equal((await run(true)).imported,0);
      const originals=await db.select().from(observations).where(inArray(observations.sourceId,[sourceId,child.id]));
      assert.equal(originals.length,1);assert.equal(originals[0]!.id,observationId);
      const[job]=await db.select().from(importJobs).where(eq(importJobs.sourceId,child.id));
      assert.ok(job?.finishedAt);assert.ok(job?.summary);
    });
    await t.test("failed downloads retain records and report the actual reason",async()=>{
      const result=await run(true,true);assert.equal(result.status,"failed");
      const[original]=await db.select().from(observations).where(eq(observations.id,observationId));
      assert.equal(original!.removedAt,null);assert.equal(original!.aedId,aedId);
      const[owner]=await db.select().from(sources).where(eq(sources.id,sourceId));
      assert.match(owner!.statusMessage,/przerwane pobieranie/);
    });
    await t.test("connection tests require ADMIN, do not import records and persist diagnostics",async()=>{
      app=await buildApp();let role="ADMIN";
      app.addHook("preHandler",async req=>{req.account={...account,role};});
      const session=await app.inject({url:"/api/auth/session"}),cookies=session.headers["set-cookie"];
      const headers={cookie:(Array.isArray(cookies)?cookies:[cookies]).filter(Boolean).map(v=>String(v).split(";")[0]).join("; "),
        "x-csrf-token":session.json().csrfToken};
      role="USER";
      assert.equal((await app.inject({method:"POST",url:"/api/admin/source-test",headers,payload:{sourceId}})).statusCode,403);
      role="PROVIDER";
      assert.equal((await app.inject({method:"POST",url:"/api/admin/source-test",headers,payload:{sourceId}})).statusCode,403);
      role="ADMIN";
      const response=await app.inject({method:"POST",url:"/api/admin/source-test",headers,payload:{sourceId}});
      assert.equal(response.statusCode,200,response.body);assert.equal(response.json().recordCount,0);
      const[owner]=await db.select().from(sources).where(eq(sources.id,sourceId));
      assert.equal((owner!.provenanceEvidence.connectionTest as any).status,"unavailable");
      assert.equal((await db.select().from(observations).where(eq(observations.id,observationId))).length,1);
      const panel=await app.inject({url:"/api/admin/integrations"});assert.equal(panel.statusCode,200,panel.body);
      const child=panel.json().sources.find((s:any)=>s.key===`dane-gov:${datasetId}`);
      assert.equal(child.syncKey,"dane-gov");assert.equal(child.latestImport.imported,0);
    });
  }finally{
    if(app)await app.close();
    if(source!)for(const id of await sourceFamilyIds(source))ids.add(id);
    const all=[...ids],obs=await db.select().from(observations).where(inArray(observations.sourceId,all));
    const obsIds=obs.map(o=>o.id),aedIds=obs.flatMap(o=>o.aedId?[o.aedId]:[]);
    if(obsIds.length){await db.delete(dataConflicts).where(inArray(dataConflicts.observationId,obsIds));await db.delete(observationVersions).where(inArray(observationVersions.observationId,obsIds));}
    await db.delete(importErrors).where(inArray(importErrors.sourceId,all));
    await db.delete(importJobs).where(inArray(importJobs.sourceId,all));
    await db.delete(observations).where(inArray(observations.sourceId,all));
    if(aedIds.length)await db.delete(aeds).where(inArray(aeds.id,aedIds));
    await db.delete(auditLogs).where(eq(auditLogs.userId,userId));
    await db.delete(sources).where(inArray(sources.id,all));await db.delete(users).where(eq(users.id,userId));
    await pool.end();
  }
});
