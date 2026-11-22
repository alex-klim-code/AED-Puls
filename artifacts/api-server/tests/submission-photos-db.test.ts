import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq,inArray } from "drizzle-orm";
import sharp from "sharp";
import { db,pool,users,aeds,aedProposals,proposalEvents,auditLogs,submissionPhotos,submissionComments } from "@workspace/db";
import { buildApp } from "../src/app";
import { signLocationReceipt } from "../src/modules/submission-location";
import { privatePhotoFile } from "../src/modules/submission-photo-storage";
test("private real-cloud photos: content validation, immutable normalization, proposal/comment ownership",async()=>{
  const ids=[randomUUID(),randomUUID(),randomUUID()];let app:Awaited<ReturnType<typeof buildApp>>|undefined;
  let actor:typeof users.$inferSelect|undefined;
  try{
    const accounts=await db.insert(users).values(ids.map((id,i)=>({id,name:"TEST PRYWATNY",role:i===2?"ADMIN":"USER"}))).returning();
    actor=accounts.find(a=>a.id===ids[0]);
    app=await buildApp();app.addHook("preHandler",async req=>{req.account=actor;});
    const session=await app.inject({url:"/api/auth/session"}),cookies=session.headers["set-cookie"];
    const headers={cookie:(Array.isArray(cookies)?cookies:[cookies]).filter(Boolean).map(c=>String(c).split(";")[0]).join("; "),"x-csrf-token":session.json().csrfToken};
    const post=(url:string,payload?:unknown)=>app!.inject({method:"POST",url,headers,payload});
    assert.equal((await post("/api/submission-photos/uploads",{name:"bad.svg",size:10,contentType:"image/svg+xml"})).statusCode,400);
    assert.equal((await post("/api/submission-photos/uploads",{name:"large.png",size:5242881,contentType:"image/png"})).statusCode,400);
    const spoof=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>');
    const spoofRequest=await post("/api/submission-photos/uploads",{name:"spoof.png",size:spoof.length,contentType:"image/png"});
    assert.equal(spoofRequest.statusCode,201);
    assert.ok((await fetch(spoofRequest.json().uploadURL,{method:"PUT",headers:{"Content-Type":"image/png"},body:spoof})).ok);
    assert.equal((await post(`/api/submission-photos/${spoofRequest.json().id}/complete`)).statusCode,400);
    const png=await sharp({create:{width:4,height:4,channels:3,background:"red"}}).png().toBuffer();
    async function upload(){
      const r=await post("/api/submission-photos/uploads",{name:"test-private.png",size:png.length,contentType:"image/png"});
      assert.equal(r.statusCode,201,"private storage signing failed");
      const data=r.json();
      const put=await fetch(data.uploadURL,{method:"PUT",headers:{"Content-Type":"image/png"},body:png});
      assert.ok(put.ok,"cloud upload failed");
      const complete=await post(`/api/submission-photos/${data.id}/complete`);
      assert.equal(complete.statusCode,200,"image validation failed");
      return data.id as string;
    }
    const photo=await upload();
    const image=await app.inject({url:`/api/submission-photos/${photo}`,headers});
    assert.equal(image.statusCode,200);assert.equal(image.headers["content-type"],"image/webp");
    assert.equal((await sharp(image.rawPayload).metadata()).exif,undefined);
    actor=accounts.find(a=>a.id===ids[1]);
    assert.equal((await app.inject({url:`/api/submission-photos/${photo}`,headers})).statusCode,404);
    actor=accounts.find(a=>a.id===ids[0]);
    const receipt={userId:ids[0]!,expiresAt:Date.now()+60000,capturedAt:Date.now(),latitude:52.23,longitude:21.01,accuracy:10,
      address:"TEST 1",city:"TEST",postalCode:"",voivodeship:"",addressStatus:"RESOLVED" as const};
    const response=await post("/api/aeds",{name:`TEST PRYWATNY ${randomUUID()}`,address:"TEST 1",city:"TEST",latitude:52.23,longitude:21.01,
      accessibility:"unknown",sourceName:"",sourceUrl:"",license:"CC-BY-4.0",submissionMethod:"GPS",
      locationToken:signLocationReceipt(receipt),publicationConsent:true,photoId:photo});
    assert.equal(response.statusCode,201,response.body);const proposal=response.json();assert.equal(proposal.photoId,photo);
    actor=accounts.find(a=>a.id===ids[2]);
    assert.equal((await app.inject({url:`/api/submission-photos/${photo}`,headers})).statusCode,200);
    const commentPhoto=await upload();
    const comment=await post(`/api/submission-threads/AED/${proposal.id}`,{body:"TEST odpowiedź administratora",photoId:commentPhoto});
    assert.equal(comment.statusCode,201,comment.body);
    assert.equal((await post(`/api/submission-threads/AED/${proposal.id}`,{body:"Ponowne użycie",photoId:commentPhoto})).statusCode,400);
    actor=accounts.find(a=>a.id===ids[0]);
    assert.equal((await app.inject({url:`/api/submission-photos/${commentPhoto}`,headers})).statusCode,200);
    const thread=(await app.inject({url:`/api/submission-threads/AED/${proposal.id}`,headers})).json();
    assert.equal(thread.comments[0].authorRole,"ADMIN");assert.equal(thread.comments[0].photoId,commentPhoto);
    actor=accounts.find(a=>a.id===ids[1]);
    assert.equal((await app.inject({url:`/api/submission-photos/${commentPhoto}`,headers})).statusCode,404);
    assert.equal((await app.inject({url:`/api/submission-threads/AED/${proposal.id}`,headers})).statusCode,404);
    actor=undefined;
    assert.equal((await app.inject({url:`/api/submission-photos/${photo}`,headers})).statusCode,401);
    assert.equal((await db.select().from(aeds).where(inArray(aeds.submittedBy,ids))).length,0);
  }finally{
    if(app)await app.close();
    await db.delete(submissionComments).where(inArray(submissionComments.authorId,ids));
    const proposals=await db.select().from(aedProposals).where(inArray(aedProposals.submittedBy,ids));
    if(proposals.length){
      await db.delete(proposalEvents).where(inArray(proposalEvents.proposalId,proposals.map(p=>p.id)));
      await db.delete(aedProposals).where(inArray(aedProposals.id,proposals.map(p=>p.id)));
    }
    const photos=await db.select().from(submissionPhotos).where(inArray(submissionPhotos.ownerId,ids));
    for(const photo of photos)for(const path of [photo.rawPath,photo.objectPath])if(path)await privatePhotoFile(path).delete({ignoreNotFound:true});
    await db.delete(submissionPhotos).where(inArray(submissionPhotos.ownerId,ids));
    await db.delete(auditLogs).where(inArray(auditLogs.userId,ids));await db.delete(users).where(inArray(users.id,ids));await pool.end();
  }
});
