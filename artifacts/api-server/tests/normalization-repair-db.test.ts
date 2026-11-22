import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db,pool,aeds,sources,observations,observationVersions,auditLogs } from "@workspace/db";
import { repairNormalizedPublications } from "../src/ingestion/repair-normalized";

test("legacy snapshot repair preserves originals, canonical AED, rights and history, and is idempotent",async()=>{
  const sourceId=randomUUID(),aedId=randomUUID(),observationId=randomUUID();
  const url="https://example.org/private-test";
  const original={record:{id:"fixture",name:"TEST NIEPUBLICZNY",address:"Testowa 1",city:"TEST"},
    context:{name:"TEST",publisher:"TEST",license:"CC0-1.0",url,datasetUrl:url,datasetId:"test",resourceId:"1",coverage:"Polska",modified:null}};
  try{
    await db.insert(sources).values({id:sourceId,name:"TEST NIEPUBLICZNY",url,license:"CC0-1.0",coverage:"TEST",
      institution:"TEST",datasetId:"test",updateFrequency:"TEST",authoritativeScope:"TEST",statusMessage:"TEST"});
    await db.insert(aeds).values({id:aedId,name:"TEST NIEPUBLICZNY",address:"",city:"",latitude:52.23,longitude:21.01,
      imported:true,publicImport:false,isDemo:false,sourceName:"TEST",sourceUrl:url,license:"CC0-1.0"});
    await db.insert(observations).values({id:observationId,sourceId,aedId,sourceRecordId:"fixture",sourceUrl:url,
      license:"CC0-1.0",originalRecord:original,normalizedRecord:null});
    const [before]=await db.select().from(aeds).where(eq(aeds.id,aedId));
    assert.equal((await repairNormalizedPublications([sourceId])).repaired,1);
    const [after]=await db.select().from(aeds).where(eq(aeds.id,aedId));
    assert.deepEqual(after,before);
    const [ref]=await db.select().from(observations).where(eq(observations.id,observationId));
    assert.deepEqual(ref!.originalRecord,original);assert.equal(ref!.license,"CC0-1.0");assert.equal(ref!.sourceId,sourceId);
    assert.equal(ref!.normalizedRecord!.latitude,null);assert.equal(ref!.normalizedRecord!.longitude,null);
    assert.equal((await db.select().from(observationVersions).where(eq(observationVersions.observationId,observationId))).length,1);
    assert.equal((await repairNormalizedPublications([sourceId])).repaired,0);
    assert.equal((await db.select().from(observationVersions).where(eq(observationVersions.observationId,observationId))).length,1);
  }finally{
    await db.delete(auditLogs).where(eq(auditLogs.entityId,aedId));
    await db.delete(observationVersions).where(eq(observationVersions.observationId,observationId));
    await db.delete(observations).where(eq(observations.id,observationId));
    await db.delete(aeds).where(eq(aeds.id,aedId));await db.delete(sources).where(eq(sources.id,sourceId));
    await pool.end();
  }
});
