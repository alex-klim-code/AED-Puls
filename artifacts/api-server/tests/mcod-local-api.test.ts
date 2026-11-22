import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash,randomBytes } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { db,users,organizations,memberships,sessions,aeds,aedProposals,mcodInstitutionRequests } from "@workspace/db";

/** All fixtures and even approved synthetic AEDs exist ONLY inside a transaction
 * rolled back at the end. They cannot appear in the running app or public DB.
 * The test application's MCOD transport is replaced BEFORE importing the app.
 */
test("local MCOD journey: authority, moderation, snapshots, correction and authorization; no HTTP",async()=>{
  const oldFetch=globalThis.fetch,oldDemo=process.env.DEMO_AUTH_ENABLED;
  const flagKeys=["MCOD_API_ENABLED","MCOD_WRITE_ENABLED","MCOD_SYNC_ENABLED"] as const;
  const oldFlags=Object.fromEntries(flagKeys.map(key=>[key,process.env[key]]));
  let networkCalls=0;
  globalThis.fetch=async()=>{networkCalls++;throw new Error("External HTTP forbidden by local test");};
  process.env.DEMO_AUTH_ENABLED="false";for(const key of flagKeys)process.env[key]="false";
  const {buildApp}=await import("../src/app");
  const app=await buildApp();await app.ready();
  const original=Object.fromEntries(["select","insert","update","delete","execute","transaction"].map(key=>[key,(db as any)[key].bind(db)]));
  const rollback=new Error("ROLLBACK_TEST_FIXTURES");
  try{
    await original.transaction(async(tx:any)=>{
      // Reuse the transaction for every service and Fastify handler in this process.
      for(const key of Object.keys(original))(db as any)[key]=tx[key].bind(tx);
      try{
        const org=async(name:string)=>(await db.insert(organizations).values({name,isDemo:false}).returning())[0]!;
        const orgA=await org("__MCOD_UNIT_ORG_A__"),orgB=await org("__MCOD_UNIT_ORG_B__");
        const person=async(role:string,organizationId:string|null=null)=>{
          const [user]=await db.insert(users).values({name:`__MCOD_UNIT_${role}__`,role,organizationId,isDemo:false}).returning();
          if(organizationId)await db.insert(memberships).values({userId:user!.id,organizationId});
          const raw=randomBytes(32).toString("hex"),csrf=randomBytes(24).toString("hex");
          await db.insert(sessions).values({id:createHash("sha256").update(raw).digest("hex"),userId:user!.id,csrfToken:csrf,expiresAt:new Date(Date.now()+600000)});
          return {user:user!,csrf,cookie:`aed_session=${encodeURIComponent(app.signCookie(raw))}`};
        };
        const provider=await person("PROVIDER",orgA.id),other=await person("PROVIDER",orgB.id),
          admin=await person("ADMIN"),applicant=await person("USER"),ordinary=await person("USER");
        const call=(who:typeof provider,method:"GET"|"POST"|"PUT",url:string,payload?:unknown,csrf=true)=>
          app.inject({method,url,headers:{cookie:who.cookie,...(csrf?{"x-csrf-token":who.csrf}:{})},payload:payload as any});
        const ok=(response:{statusCode:number;body:string},status=200)=>{
          assert.equal(response.statusCode,status,response.body);return JSON.parse(response.body);
        };
        const ws=ok(await call(provider,"GET","/api/mcod/workspace"));
        assert.equal(ws.status.enabled,false);assert.match(ws.message,/oczekuje na aktywację/);
        assert.equal((await app.inject("/api/mcod/workspace")).statusCode,401);
        assert.equal((await call(provider,"POST","/api/mcod/aed-drafts",{payload:{}},false)).statusCode,403);
        assert.equal((await call(ordinary,"POST","/api/mcod/aed-drafts",{payload:{}})).statusCode,403);
        assert.equal(ok(await call(provider,"GET","/api/mcod/institutions?page=1")).items.length>=0,true);
        const missing=await call(provider,"POST","/api/mcod/institution-requests",{
          kind:"EXISTING",institutionId:"nonexistent-unit-fixture",representativeName:"Unit Person",representativeRole:"Unit Role",representativeEmail:"unit@example.invalid"});
        assert.equal(missing.statusCode,409);
        const application={kind:"NEW",representativeName:"Unit Person",representativeRole:"Unit Role",representativeEmail:"unit@example.invalid",
          details:{fullName:orgA.name,shortName:"UNIT",institutionType:"Firma",address:"Unit address",email:"unit@example.invalid",phone:"+48000000000",website:""}};
        const request=ok(await call(provider,"POST","/api/mcod/institution-requests",application),201);
        assert.equal(request.status,"PENDING_VERIFICATION");assert.equal(request.institutionId,null);
        assert.equal((await call(other,"GET","/api/mcod/workspace")).json().institutionRequests.length,0);
        assert.equal((await call(provider,"POST","/api/mcod/institution-requests",application)).statusCode,409);
        assert.equal((await call(provider,"POST",`/admin/mcod/institution-requests/${request.id}/review`,{})).statusCode,404);
        assert.equal((await call(provider,"POST",`/api/admin/mcod/institution-requests/${request.id}/review`,{
          decision:"APPROVE",expectedRevision:1,note:"Unit proof",representativeVerified:true})).statusCode,403);
        assert.equal((await call(admin,"POST",`/api/admin/mcod/institution-requests/${request.id}/review`,{
          decision:"APPROVE",expectedRevision:1,note:"Unit proof",representativeVerified:false})).statusCode,400);
        const approved=ok(await call(admin,"POST",`/api/admin/mcod/institution-requests/${request.id}/review`,{
          decision:"APPROVE",expectedRevision:1,note:"Synthetic authority proof for isolated unit test",representativeVerified:true}));
        assert.equal(approved.status,"APPROVED");assert.equal(approved.institutionId,null);
        assert.equal((await call(admin,"POST",`/api/admin/mcod/institution-requests/${request.id}/review`,{
          decision:"REJECT",expectedRevision:1,note:"Stale unit decision",representativeVerified:false})).statusCode,409);
        assert.equal(ok(await call(admin,"POST",`/api/admin/mcod/institution-requests/${request.id}/execute`),503).code,"MCOD_DISABLED");
        const dataset=ok(await call(provider,"POST","/api/mcod/datasets",{institutionRequestId:request.id,title:"Unit AED dataset",description:"Unit only"}),201);
        assert.equal(dataset.datasetId,null);
        const sameDataset=ok(await call(provider,"POST","/api/mcod/datasets",{institutionRequestId:request.id,title:"Unit AED dataset",description:"Unit only"}),201);
        assert.equal(dataset.id,sameDataset.id);
        assert.equal((await call(other,"POST","/api/mcod/datasets",{institutionRequestId:request.id,title:"Unauthorized"})).statusCode,403);
        const emptyPlan=ok(await call(provider,"POST","/api/mcod/publications",{datasetId:dataset.id,format:"csv"}),201);
        assert.equal(emptyPlan.status,"VALIDATION_FAILED");assert.equal(emptyPlan.recordCount,0);
        assert.equal((await call(provider,"GET",`/api/mcod/publications/${emptyPlan.id}/download`)).statusCode,409);
        const [baseline]=await db.select({n:sql<number>`count(*)::int`}).from(aeds);
        const payload={name:"__MCOD_UNIT_AED__",address:"Unit Warsaw address",city:"Warszawa",latitude:52.2297,longitude:21.0122,
          license:"CC-BY-4.0",publicAccess:null,lastVerifiedAt:null,deviceStatus:"UNKNOWN"};
        const draft=ok(await call(provider,"POST","/api/mcod/aed-drafts",{payload}),201);
        assert.equal(draft.status,"DRAFT");assert.equal(draft.payload.publicAccess,null);
        assert.equal((await call(other,"PUT",`/api/mcod/aed-drafts/${draft.id}`,{payload,expectedRevision:1})).statusCode,404);
        const sent=ok(await call(provider,"POST",`/api/mcod/aed-drafts/${draft.id}/submit`,{expectedRevision:1,publicationConsent:true}));
        assert.equal(sent.status,"PENDING_APPROVAL");
        assert.equal(ok(await call(provider,"POST",`/api/mcod/aed-drafts/${draft.id}/submit`,{expectedRevision:1,publicationConsent:true})).proposalId,sent.proposalId);
        assert.equal((await db.select({n:sql<number>`count(*)::int`}).from(aeds))[0]!.n,baseline!.n);
        const [proposal]=await db.select().from(aedProposals).where(eq(aedProposals.id,sent.proposalId));
        ok(await call(admin,"POST",`/api/admin/aed-proposals/${proposal!.id}/review`,{decision:"APPROVE",revision:proposal!.revision,note:"Unit approval only; transaction will roll back"}));
        const [done]=await db.select().from(aedProposals).where(eq(aedProposals.id,proposal!.id));
        const [record]=await db.select().from(aeds).where(eq(aeds.id,done!.aedId!));
        assert.equal(record!.deviceOperationalStatus,"UNKNOWN");assert.equal(record!.recordVerificationStatus,"UNVERIFIED");
        const prepared=ok(await call(provider,"POST","/api/mcod/publications",{datasetId:dataset.id,format:"csv"}),201);
        assert.equal(prepared.status,"PREPARED");assert.equal(prepared.recordCount,1);assert.equal(prepared.validation.issues.length,0);
        assert.equal(ok(await call(provider,"POST","/api/mcod/publications",{datasetId:dataset.id,format:"csv"}),201).id,prepared.id);
        const csv=await call(provider,"GET",`/api/mcod/publications/${prepared.id}/download`);
        assert.equal(csv.statusCode,200);assert.ok(String(csv.headers["content-type"]).includes("text/csv"));
        assert.ok(csv.body.includes("CC-BY-4.0"));assert.ok(csv.body.includes(orgA.name));
        assert.equal((await call(other,"GET",`/api/mcod/publications/${prepared.id}/download`)).statusCode,403);
        assert.equal((await call(other,"POST","/api/mcod/publications",{datasetId:dataset.id,format:"csv"})).statusCode,403);
        assert.equal(ok(await call(provider,"POST",`/api/mcod/publications/${prepared.id}/execute`),503).code,"MCOD_DISABLED");
        assert.equal(ok(await call(admin,"POST","/api/admin/mcod/sync"),503).code,"MCOD_DISABLED");
        const edit=ok(await call(provider,"POST","/api/mcod/aed-drafts",{targetAedId:record!.id,payload:{...payload,name:"__MCOD_UNIT_CORRECTION__"}}),201);
        const editSent=ok(await call(provider,"POST",`/api/mcod/aed-drafts/${edit.id}/submit`,{expectedRevision:1,publicationConsent:true}));
        const [correction]=await db.select().from(aedProposals).where(eq(aedProposals.id,editSent.proposalId));
        assert.equal(correction!.targetAedId,record!.id);
        ok(await call(admin,"POST",`/api/admin/aed-proposals/${correction!.id}/review`,{decision:"APPROVE",revision:1,note:"Unit correction"}));
        assert.equal((await db.select({n:sql<number>`count(*)::int`}).from(aeds))[0]!.n,baseline!.n+1);
        assert.equal((await db.select().from(aeds).where(eq(aeds.id,record!.id)))[0]!.name,"__MCOD_UNIT_CORRECTION__");
        const workspace=ok(await call(provider,"GET","/api/mcod/workspace"));
        assert.equal(workspace.drafts.find((d:any)=>d.id===edit.id).status,"APPROVED");
        const stale=ok(await call(provider,"POST","/api/mcod/aed-drafts",{targetAedId:record!.id,payload}),201);
        await db.update(aeds).set({updatedAt:sql`clock_timestamp()`}).where(eq(aeds.id,record!.id));
        const staleSent=ok(await call(provider,"POST",`/api/mcod/aed-drafts/${stale.id}/submit`,{expectedRevision:1,publicationConsent:true}));
        assert.equal((await call(admin,"POST",`/api/admin/aed-proposals/${staleSent.proposalId}/review`,{decision:"APPROVE",revision:1,note:"Unit stale correction"})).statusCode,409);
        const registration=ok(await call(applicant,"POST","/api/mcod/institution-requests",{
          ...application,details:{...application.details,fullName:"__MCOD_UNIT_NEW_ORGANIZATION__"}}),201);
        assert.equal(registration.institutionId,null);
        const [upgraded]=await db.select().from(users).where(eq(users.id,applicant.user.id));
        assert.equal(upgraded!.role,"PROVIDER");assert.ok(upgraded!.organizationId);
        assert.equal((await db.select().from(mcodInstitutionRequests).where(eq(mcodInstitutionRequests.id,registration.id)))[0]!.status,"PENDING_VERIFICATION");
        assert.equal(networkCalls,0);
      }finally{for(const key of Object.keys(original))(db as any)[key]=original[key];}
      throw rollback;
    });
  }catch(error){if(error!==rollback)throw error;}
  finally{
    for(const key of Object.keys(original))(db as any)[key]=original[key];
    await app.close();await db.$client.end();globalThis.fetch=oldFetch;
    if(oldDemo===undefined)delete process.env.DEMO_AUTH_ENABLED;else process.env.DEMO_AUTH_ENABLED=oldDemo;
    for(const key of flagKeys){if(oldFlags[key]===undefined)delete process.env[key];else process.env[key]=oldFlags[key];}
  }
});
