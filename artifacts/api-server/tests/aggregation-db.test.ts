import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {and,eq,inArray} from "drizzle-orm";
import {db,pool,aeds,sources,users,observations,observationVersions,duplicateCandidates,dataConflicts,mergeDecisions,auditLogs,importJobs,importErrors} from "@workspace/db";
import {matchRecords,primarySource,type MatchRecord} from "../src/ingestion/matching";
import {mergeCandidate,undoMerge,refreshAggregation} from "../src/ingestion/linkage";
import {executeSync,reserveSync} from "../src/ingestion/engine";
import {normalizeRow,type SourceContext} from "../src/ingestion/normalize";

// No network, public test records or replacement of actual source connectors.
// All temporary observations and decisions are deleted in finally.
test("multi-source identity, import history and reversible decisions",async t=>{
  const actor=randomUUID(),ids=[randomUUID(),randomUUID(),randomUUID()],sourceIds=ids.map(()=>randomUUID());
  const syncSource=randomUUID(),syncKey=`test-${randomUUID()}`;
  const pairs=[randomUUID(),randomUUID()],observed=ids.map(()=>randomUUID());
  const base:MatchRecord={latitude:52.23,longitude:21.01,address:"Testowa 1",name:"Test urządzenia",
    description:"Hol główny",license:"ODbL-1.0",deviceIdentifier:"TEST-SERIAL-123",deviceOperationalStatus:"UNKNOWN"};
  const context:SourceContext={name:"Niepubliczny test",publisher:"TEST",license:"UNKNOWN",url:"https://example.org/test",
    datasetUrl:"https://example.org/test",datasetId:"test",resourceId:"test",coverage:"TEST",modified:null,sourceCategory:"UNKNOWN"};
  let generatedIds:string[]=[];
  const row=(id:number,name="Test")=>({type:"Feature",geometry:{type:"Point",coordinates:[21.01,52.23]},
    properties:{id,name,emergency:"defibrillator"}});
  const run=async(records:unknown[],down=false)=>{
    const reservation=await reserveSync(syncKey as never,actor);
    assert.ok(reservation);
    await executeSync(reservation,{connector:async function*(){
      if(down)throw new Error("Test: niedostępne API");
      yield {context,rows:records,metadata:{test:true}};
    },afterSync:async()=>{}});
    generatedIds=(await db.select({id:observations.aedId}).from(observations).where(eq(observations.sourceId,syncSource)))
      .flatMap(r=>r.id?[r.id]:[]);
    return (await db.select().from(importJobs).where(eq(importJobs.id,reservation.job.id)))[0]!;
  };
  try{
    await db.insert(users).values({id:actor,name:"Niepubliczny test agregacji",role:"ADMIN",isDemo:false});
    await db.insert(sources).values([...sourceIds,syncSource].map((id,i)=>({id,key:id===syncSource?syncKey:null,
      name:`Niepubliczny test agregacji ${i}`,url:"https://example.org/test",license:"UNKNOWN",coverage:"TEST",
      institution:"TEST",datasetId:"TEST",updateFrequency:"TEST",authoritativeScope:"TEST — nie publikować",statusMessage:"TEST"})));
    await db.insert(aeds).values(ids.map(id=>({...base,id,city:"TEST",sourceName:"TEST",sourceUrl:"https://example.org/test",
      isDemo:false,imported:true,publicImport:false,verificationStatus:"unverified"})));
    await db.insert(observations).values(ids.map((aedId,i)=>({id:observed[i],aedId,sourceId:sourceIds[i]!,sourceRecordId:`test-${i}`,
      datasetId:`test-${i}`,license:"ODbL-1.0",sourceUrl:"https://example.org/test",originalRecord:{test:true},
      provenanceEvidence:{method:"official_api_dataset_resource_institution",publisherId:i===0?"TEST-A":"TEST-B"},
      normalizedRecord:{name:base.name,address:base.address,city:"TEST"}})));
    await db.insert(duplicateCandidates).values([{id:pairs[0],firstId:ids[0]!,secondId:ids[1]!,reason:"TEST"},
      {id:pairs[1],firstId:ids[0]!,secondId:ids[2]!,reason:"TEST"}]);
    await t.test("three publications can identify one AED without deleting originals",async()=>{
      await mergeCandidate(pairs[0]!,ids[0]!,actor);
      await mergeCandidate(pairs[1]!,ids[0]!,actor);
      await refreshAggregation();
      const roots=await db.select().from(aeds).where(inArray(aeds.id,ids));
      assert.equal(roots.filter(r=>!r.mergedIntoId).length,1);
      assert.equal((await db.select().from(observations).where(inArray(observations.id,observed))).length,3);
      assert.equal(roots.find(r=>r.id===ids[0])!.publicationCount,3);
    });
    await t.test("two different devices in the same building never auto-merge by proximity",()=>{
      const result=matchRecords(base,{...base,deviceIdentifier:"TEST-SERIAL-456"});
      assert.equal(result.autoMerge,false);
      assert.equal(result.blockingConflict,true);
      assert.equal(matchRecords({...base,deviceIdentifier:null},{...base,deviceIdentifier:null}).autoMerge,false);
    });
    await t.test("repeated import is idempotent; changed observations retain original versions",async()=>{
      const first=await run([row(1),row(2)]);
      assert.equal(first.imported,2);
      const again=await run([row(1),row(2)]);
      assert.equal(again.imported,0);
      assert.equal(generatedIds.length,2);
      await run([row(1,"Zmieniony opis"),row(2)]);
      const obs=await db.select().from(observations).where(eq(observations.sourceId,syncSource));
      assert.ok((await db.select().from(observationVersions).where(inArray(observationVersions.observationId,obs.map(o=>o.id)))).length>=1);
      assert.equal((await db.select().from(aeds).where(inArray(aeds.id,generatedIds))).some(r=>r.publicImport),false);
    });
    await t.test("same meaningful physical ID tolerates a coordinate discrepancy",()=>{
      const result=matchRecords(base,{...base,latitude:52.25});
      assert.ok(result.distance>100);
      assert.equal(result.autoMerge,true);
    });
    await t.test("conflicting opening hours block automatic merge",()=>{
      const result=matchRecords({...base,openingHours:"24/7"},{...base,openingHours:"Mo-Fr 09:00-17:00"});
      assert.equal(result.autoMerge,false);assert.equal(result.blockingConflict,true);
    });
    await t.test("conflicting source functionality claims never become clinical verification",()=>{
      const result=matchRecords({...base,sourceOperationalClaims:["working"]},{...base,sourceOperationalClaims:["broken"]});
      assert.equal(result.autoMerge,false);assert.equal(result.blockingConflict,true);
      const normalized=normalizeRow({original:{...row(3),properties:{id:3,"defibrillator:status":"working"}},context});
      assert.equal(normalized.data!.operationalStatus,"unknown");
    });
    await t.test("records without coordinates are retained as incomplete AEDs, not fabricated points",()=>{
      const result=normalizeRow({original:{id:9,name:"Brak współrzędnych"},context});
      assert.equal(result.data!.latitude,null);assert.equal(result.data!.longitude,null);
      assert.ok(result.issues.some(i=>i.rule==="missing_coordinates"));
    });
    await t.test("an unavailable API never marks existing observations as disappeared",async()=>{
      const job=await run([],true);assert.equal(job.status,"failed");
      assert.equal((await db.select().from(observations).where(eq(observations.sourceId,syncSource))).some(o=>o.removedAt),false);
    });
    await t.test("catalogue republications do not inflate independent publisher count",async()=>{
      const [root]=await db.select().from(aeds).where(eq(aeds.id,ids[0]!));
      assert.equal(root!.independentSourceCount,2);assert.equal(root!.publicationCount,3);
      const evidence={method:"official_api_dataset_resource_institution",publisherId:"145"};
      assert.equal(primarySource({provenanceEvidence:evidence}),primarySource({provenanceEvidence:{...evidence,method:"municipal_metadata_official_catalogue_cross_reference"}}));
      assert.equal(primarySource({sourceName:"Nieznany wydawca",publisher:"Niepotwierdzona instytucja"}),null);
    });
    await t.test("undo preserves originals and later source changes, and prevents automatic re-merge",async()=>{
      const decisions=await db.select().from(mergeDecisions).where(eq(mergeDecisions.actorId,actor));
      const second=decisions.find(d=>d.candidateId===pairs[1])!,first=decisions.find(d=>d.candidateId===pairs[0])!;
      await assert.rejects(()=>undoMerge(first.id,actor));
      await db.insert(dataConflicts).values({aedId:ids[0]!,observationId:observed[2]!,field:"name",currentValue:base.name,incomingValue:"Nowsza nazwa źródła"});
      await undoMerge(second.id,actor);
      const [late]=await db.select().from(dataConflicts).where(eq(dataConflicts.observationId,observed[2]!));
      assert.equal(late!.aedId,ids[2]);assert.equal(late!.incomingValue,"Nowsza nazwa źródła");
      await undoMerge(first.id,actor);
      const restored=await db.select().from(aeds).where(inArray(aeds.id,ids));
      assert.equal(restored.filter(r=>!r.mergedIntoId).length,3);
      const [pair]=await db.select().from(duplicateCandidates).where(eq(duplicateCandidates.id,pairs[0]!));
      assert.equal(pair!.status,"rejected_after_unmerge");
      assert.equal((await db.select().from(observations).where(inArray(observations.id,observed))).length,3);
      await assert.rejects(()=>mergeCandidate(pairs[0]!,ids[0]!,null,true));
    });
    await t.test("only a complete nonempty snapshot marks a missing source observation",async()=>{
      await run([row(1,"Zmieniony opis")]);
      const obs=await db.select().from(observations).where(eq(observations.sourceId,syncSource));
      assert.equal(obs.filter(o=>o.removedAt).length,1);
      assert.equal((await db.select().from(aeds).where(inArray(aeds.id,generatedIds))).length,2);
    });
    await t.test("a later source functionality change creates a conflict without promoting the device status",async()=>{
      const working={...row(1,"Zmieniony opis"),properties:{id:1,name:"Zmieniony opis","defibrillator:status":"working"}};
      await run([working]);
      await run([{...working,properties:{...working.properties,"defibrillator:status":"broken"}}]);
      const [obs]=await db.select().from(observations).where(and(eq(observations.sourceId,syncSource),eq(observations.sourceRecordId,normalizeRow({original:working,context}).id)));
      assert.ok(obs?.aedId);
      const [conflict]=await db.select().from(dataConflicts).where(and(eq(dataConflicts.observationId,obs.id),eq(dataConflicts.field,"source:operationalStatus")));
      assert.equal(conflict!.incomingValue,"OUT_OF_SERVICE");
      const [record]=await db.select().from(aeds).where(eq(aeds.id,obs.aedId));
      assert.equal(record!.deviceOperationalStatus,"UNKNOWN");
      assert.equal(record!.recordVerificationStatus,"UNVERIFIED");
    });
    await t.test("placeholder identifiers cannot justify automatic merge",()=>{
      assert.equal(matchRecords({...base,deviceIdentifier:"UNKNOWN"},{...base,deviceIdentifier:"UNKNOWN"}).autoMerge,false);
    });
  }finally{
    const allSources=[...sourceIds,syncSource];
    const obs=await db.select({id:observations.id,aedId:observations.aedId}).from(observations).where(inArray(observations.sourceId,allSources));
    const allAeds=[...new Set([...ids,...generatedIds,...obs.flatMap(o=>o.aedId?[o.aedId]:[])])];
    const jobs=await db.select({id:importJobs.id}).from(importJobs).where(inArray(importJobs.sourceId,allSources));
    await db.delete(dataConflicts).where(inArray(dataConflicts.aedId,allAeds));
    await db.delete(mergeDecisions).where(eq(mergeDecisions.actorId,actor));
    await db.delete(duplicateCandidates).where(inArray(duplicateCandidates.id,pairs));
    await db.delete(auditLogs).where(eq(auditLogs.userId,actor));
    if(obs.length)await db.delete(observationVersions).where(inArray(observationVersions.observationId,obs.map(o=>o.id)));
    await db.delete(observations).where(inArray(observations.sourceId,allSources));
    if(jobs.length)await db.delete(importErrors).where(inArray(importErrors.jobId,jobs.map(j=>j.id)));
    await db.delete(importJobs).where(inArray(importJobs.sourceId,allSources));
    await db.delete(aeds).where(inArray(aeds.id,allAeds));
    await db.delete(sources).where(inArray(sources.id,allSources));
    await db.delete(users).where(eq(users.id,actor));
    await pool.end();
  }
});
