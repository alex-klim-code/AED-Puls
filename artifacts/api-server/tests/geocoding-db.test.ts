import{test}from"node:test";
import assert from"node:assert/strict";
import{randomUUID,createHash}from"node:crypto";
import{eq,inArray}from"drizzle-orm";
import{db,pool,aeds,auditLogs,geocodingAttempts}from"@workspace/db";
import{geocodePendingRecords}from"../src/geocoding/worker";

test("cached geocoding enriches only eligible nonpublic records, preserves verification and audits the dependency",async()=>{
  const ids=Array.from({length:5},()=>randomUUID()),hashes:string[]=[];
  try{
    for(const[index,id]of ids.entries()){
      const street=`TEST ${id} 1`,address=index===3?`${street}, 00-001 Warszawa`:street;
      const queryHash=createHash("sha256").update(`${street}, ${index===3?"00-001, ":""}Warszawa, Polska`.toLocaleLowerCase("pl")).digest("hex");
      hashes.push(queryHash);
      await db.insert(aeds).values({id,name:"TEST — niepubliczny",address,city:index===3?"":"Warszawa",latitude:null,longitude:null,
        sourceName:"TEST — niepubliczny",sourceUrl:"https://example.org/test",license:"UNKNOWN",imported:true,publicImport:false,
        verificationStatus:index===2?"REJECTED":"NOT_VERIFIED",locationEvidence:index===3?{method:"source_recovery",autoGeocodeEligible:false,
          issues:[{rule:"outside_poland",severity:"error"}]}:index===4?{method:"administrator_edit",autoGeocodeEligible:false}:{autoGeocodeEligible:true}});
      const status=index===1?"AMBIGUOUS":"RESOLVED";
      await db.insert(geocodingAttempts).values({queryHash,status,expiresAt:new Date(Date.now()+86400000),result:{
        status,queryHash,retryAt:new Date(Date.now()+86400000).toISOString(),
        ...(status==="RESOLVED"?{candidate:{lat:52.23,lon:21.01,country_code:"pl",city:"Warszawa",street:`TEST ${id}`,
          housenumber:"1",result_type:"building",rank:{confidence:1},datasource:{sourcename:"TEST"}}}:{}),
      }});
    }
    const result=await geocodePendingRecords(5,ids);
    assert.equal(result.processed,3);assert.equal(result.resolved,2);
    const rows=await db.select().from(aeds).where(inArray(aeds.id,ids)),resolved=rows.find(r=>r.id===ids[0])!;
    assert.equal(resolved.latitude,52.23);assert.equal(resolved.longitude,21.01);
    assert.equal(resolved.verificationStatus,"NOT_VERIFIED");assert.equal(resolved.recordVerificationStatus,"UNVERIFIED");
    assert.equal(resolved.publicImport,false);assert.equal(resolved.license,"UNKNOWN");assert.ok(resolved.locationEvidence.geocodingDependency);
    assert.equal(rows.find(r=>r.id===ids[1])!.latitude,null);assert.equal(rows.find(r=>r.id===ids[2])!.latitude,null);
    const recovered=rows.find(r=>r.id===ids[3])!;
    assert.equal(recovered.latitude,52.23);assert.equal(recovered.city,"Warszawa");assert.equal(recovered.postalCode,"00-001");
    assert.equal(recovered.publicImport,false);assert.equal(recovered.verificationStatus,"NOT_VERIFIED");
    assert.equal(rows.find(r=>r.id===ids[4])!.latitude,null);
    const history=await db.select().from(auditLogs).where(eq(auditLogs.entityId,ids[0]!));assert.equal(history.length,1);
    assert.equal((history[0]!.details as any).originalSourceDataPreserved,true);
  }finally{
    await db.delete(auditLogs).where(inArray(auditLogs.entityId,ids));await db.delete(aeds).where(inArray(aeds.id,ids));
    if(hashes.length)await db.delete(geocodingAttempts).where(inArray(geocodingAttempts.queryHash,hashes));
    await pool.end();
  }
});
