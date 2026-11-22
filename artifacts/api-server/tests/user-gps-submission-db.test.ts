import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq,inArray } from "drizzle-orm";
import { db,pool,users,aeds,aedProposals,proposalEvents,auditLogs,submissionComments } from "@workspace/db";
import { buildApp } from "../src/app";
import { signLocationReceipt,type LocationReceipt } from "../src/modules/submission-location";
test("USER GPS creates only a private proposal, never an AED before approval",async()=>{
  const userId=randomUUID(),adminId=randomUUID();let app:Awaited<ReturnType<typeof buildApp>>|undefined;
  try{
    const [account]=await db.insert(users).values({id:userId,name:"TEST NIEPUBLICZNY",role:"USER",isDemo:false}).returning();
    const [admin]=await db.insert(users).values({id:adminId,name:"TEST ADMIN",role:"ADMIN",isDemo:false}).returning();
    let actor=account!;
    app=await buildApp();app.addHook("preHandler",async req=>{req.account=actor;});
    const session=await app.inject({url:"/api/auth/session"}),cookies=session.headers["set-cookie"];
    const headers={cookie:(Array.isArray(cookies)?cookies:[cookies]).filter(Boolean).map(v=>String(v).split(";")[0]).join("; "),"x-csrf-token":session.json().csrfToken};
    const receipt:LocationReceipt={userId,expiresAt:Date.now()+60000,capturedAt:Date.now(),latitude:52.23,longitude:21.01,
      accuracy:10,address:"TEST 1",city:"TEST",postalCode:"00-001",voivodeship:"TEST",addressStatus:"RESOLVED"};
    const payload={name:`TEST NIEPUBLICZNY ${userId}`,address:receipt.address,city:receipt.city,postalCode:receipt.postalCode,
      voivodeship:receipt.voivodeship,latitude:receipt.latitude,longitude:receipt.longitude,accessibility:"unknown",
      sourceName:"FORGED",sourceUrl:"https://example.org/private",license:"CC0-1.0",submissionMethod:"GPS",
      publicationConsent:true,locationToken:signLocationReceipt(receipt)};
    const post=(data:unknown)=>app!.inject({method:"POST",url:"/api/aeds",headers,payload:data});
    assert.equal((await post({...payload,locationToken:undefined})).statusCode,400);
    assert.equal((await post({...payload,submissionMethod:"MANUAL"})).statusCode,403);
    assert.equal((await post({...payload,publicationConsent:false})).statusCode,400);
    assert.equal((await post({...payload,latitude:52.24})).statusCode,400);
    const response=await post(payload);assert.equal(response.statusCode,201,response.body);
    assert.equal(response.json().status,"NEW");assert.equal(response.json().aedId,null);
    assert.equal(response.json().payload.license,"CC-BY-4.0");assert.equal(response.json().sourceName,"Użytkownik AED Puls");
    const [record]=await db.select().from(aedProposals).where(eq(aedProposals.id,response.json().id));
    assert.equal(record!.evidence.locationEvidence&&((record!.evidence.locationEvidence as any).method),"browser_geolocation");
    assert.equal(record!.payload.locationToken,undefined);assert.equal(record!.originalData.locationToken,undefined);
    actor=admin!;
    assert.equal((await app.inject({method:"POST",url:`/api/admin/aed-proposals/${record!.id}/review`,headers,
      payload:{decision:"REQUEST_INFO",revision:1,note:"TEST: uzupełnij opis miejsca."}})).statusCode,200);
    actor=account!;
    const {locationToken,...withoutToken}=payload;
    const completed=await app.inject({method:"PUT",url:`/api/aed-proposals/${record!.id}`,headers,payload:{
      revision:2,payload:{...withoutToken,description:"TEST uzupełnienie bez zmiany GPS"},note:"TEST opis został uzupełniony"}});
    assert.equal(completed.statusCode,200,completed.body);assert.equal(completed.json().status,"NEW");
    const [after]=await db.select().from(aedProposals).where(eq(aedProposals.id,record!.id));
    assert.deepEqual(after!.evidence.locationEvidence,record!.evidence.locationEvidence,"unchanged GPS evidence must retain original capture time, not manufacture a new fix");
    actor=admin!;
    await app.inject({method:"POST",url:`/api/admin/aed-proposals/${record!.id}/review`,headers,payload:{decision:"REQUEST_INFO",revision:3,note:"TEST jeszcze raz"}});
    actor=account!;
    assert.equal((await app.inject({method:"PUT",url:`/api/aed-proposals/${record!.id}`,headers,payload:{
      revision:4,payload:{...withoutToken,latitude:52.24},note:"TEST podmieniono GPS bez sygnału"}})).statusCode,400);
    const partial={...receipt,address:"",city:"",postalCode:"",voivodeship:"",addressStatus:"UNRESOLVED" as const};
    const incomplete=await post({...payload,address:"",city:"",postalCode:"",voivodeship:"",locationToken:signLocationReceipt(partial)});
    assert.equal(incomplete.statusCode,201,incomplete.body);assert.equal(incomplete.json().status,"NEW");
    assert.ok(incomplete.json().issues.length>0);
    assert.equal((await db.select().from(aeds).where(eq(aeds.submittedBy,userId))).length,0);
    assert.equal((await app.inject({method:"POST",url:"/api/submission-location",headers,
      payload:{latitude:52.23,longitude:21.01,accuracy:101,capturedAt:Date.now()}})).statusCode,400);
  }finally{
    if(app)await app.close();
    await db.delete(submissionComments).where(inArray(submissionComments.authorId,[userId,adminId]));
    const rows=await db.select({id:aedProposals.id}).from(aedProposals).where(eq(aedProposals.submittedBy,userId));
    if(rows.length){const ids=rows.map(r=>r.id);await db.delete(proposalEvents).where(inArray(proposalEvents.proposalId,ids));await db.delete(aedProposals).where(inArray(aedProposals.id,ids));}
    await db.delete(auditLogs).where(inArray(auditLogs.userId,[userId,adminId]));await db.delete(users).where(inArray(users.id,[userId,adminId]));await pool.end();
  }
});
