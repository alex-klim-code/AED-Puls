import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and,eq,inArray,sql } from "drizzle-orm";
import { db,pool,users,organizations,aeds,aedProposals,proposalEvents,auditLogs,reports,submissionComments,type AedProposalRow } from "@workspace/db";
import { buildApp } from "../src/app";
import { proposalTemplate,readProposalFile } from "../src/modules/proposal-files";
import ExcelJS from "exceljs";
import { signLocationReceipt } from "../src/modules/submission-location";
test("organizations stage manual/files, admins complete and approve atomically; reports are separately moderated",async()=>{
  const ids=[randomUUID(),randomUUID(),randomUUID()],orgs=[randomUUID(),randomUUID()],tag=randomUUID();
  const originalTransaction=db.transaction.bind(db);let app:Awaited<ReturnType<typeof buildApp>>|undefined;
  let actor:typeof users.$inferSelect;const staged:string[]=[];
  try{
    await db.insert(organizations).values(orgs.map((id,i)=>({id,name:`TEST NIEPUBLICZNY ${tag} ${i}`})));
    const accounts=await db.insert(users).values([
      {id:ids[0]!,name:"TEST",role:"PROVIDER",organizationId:orgs[0]!},
      {id:ids[1]!,name:"TEST",role:"PROVIDER",organizationId:orgs[1]!},
      {id:ids[2]!,name:"TEST",role:"ADMIN"},
    ]).returning();actor=accounts.find(a=>a.id===ids[0])!;
    app=await buildApp();app.addHook("preHandler",async req=>{req.account=actor;});
    const session=await app.inject({url:"/api/auth/session"}),cookie=session.headers["set-cookie"];
    const headers={cookie:(Array.isArray(cookie)?cookie:[cookie]).filter(Boolean).map(v=>String(v).split(";")[0]).join("; "),"x-csrf-token":session.json().csrfToken};
    const post=(url:string,payload:unknown)=>app!.inject({method:"POST",url,headers,payload});
    const payload={name:`TEST NIEPUBLICZNY ${tag}`,address:"TEST 1",city:"TEST",latitude:52.23,longitude:21.01,
      accessibility:"unknown",sourceName:"FORGED",sourceUrl:"",license:"UNKNOWN",submissionMethod:"MANUAL",publicationConsent:false};
    const response=await post("/api/aeds",payload);assert.equal(response.statusCode,201,response.body);
    const proposal=response.json();staged.push(proposal.id);
    assert.equal(proposal.sourceName,`TEST NIEPUBLICZNY ${tag} 0`);assert.equal(proposal.aedId,null);
    assert.equal((await db.select().from(aeds).where(eq(aeds.submittedBy,ids[0]!))).length,0);
    const gpsReceipt={userId:ids[0]!,expiresAt:Date.now()+60000,capturedAt:Date.now(),latitude:52.23,longitude:21.01,accuracy:10,
      address:"TEST 1",city:"TEST",postalCode:"",voivodeship:"",addressStatus:"RESOLVED" as const};
    const gps=await post("/api/aeds",{...payload,submissionMethod:"GPS",locationToken:signLocationReceipt(gpsReceipt)});
    assert.equal(gps.statusCode,201,gps.body);assert.equal(gps.json().payload.license,"UNKNOWN");assert.equal(gps.json().status,"NEW");
    actor=accounts.find(a=>a.id===ids[1])!;
    assert.equal((await app.inject({url:`/api/aed-proposals/${proposal.id}`,headers})).statusCode,404);
    assert.equal((await app.inject({url:"/api/aed-proposals",headers})).json().items.length,0);
    assert.equal((await post(`/api/admin/aed-proposals/${proposal.id}/review`,{decision:"APPROVE",revision:1,note:"test"})).statusCode,403);
    actor=accounts.find(a=>a.id===ids[2])!;
    assert.equal((await post("/api/aeds",payload)).statusCode,403);
    assert.equal((await post("/api/reports",{aedId:proposal.id,message:"TEST ADMIN"})).statusCode,403);
    const review=(data:unknown)=>post(`/api/admin/aed-proposals/${proposal.id}/review`,data);
    assert.equal((await review({decision:"APPROVE",revision:1,note:"Sprawdzono szczegółowo prawa do publikacji."})).statusCode,400,"unknown license not publishable");
    const save=await review({decision:"SAVE",revision:1,note:"TEST uzupełnienie",payload:{...proposal.payload,license:"CC-BY-4.0"}});
    assert.equal(save.statusCode,200,save.body);assert.equal(save.json().revision,2);
    assert.equal((await review({decision:"SAVE",revision:1,note:"stale"})).statusCode,409);
    // A genuine approval route runs inside a transaction that ALWAYS rolls back.
    // No fictional published AED ever becomes visible to another connection.
    const sentinel=new Error("test-only rollback");let inside:any;
    (db as any).transaction=async(callback:any)=>{
      let result:unknown;
      try{await originalTransaction(async tx=>{
        result=await callback(tx);
        const [approved]=await tx.select().from(aeds).where(eq(aeds.submittedBy,ids[0]!));
        inside=approved;
        const outerTransaction=(db as any).transaction;
        try{
          (db as any).transaction=(nested:any)=>nested(tx);
          const replay=await review({decision:"APPROVE",revision:3,note:"TEST ponowne zatwierdzenie tego samego zgłoszenia."});
          assert.equal(replay.statusCode,409,replay.body);
          assert.equal((await tx.select().from(aeds).where(eq(aeds.submittedBy,ids[0]!))).length,1);
        }finally{(db as any).transaction=outerTransaction;}
        throw sentinel;
      });}catch(error){if(error!==sentinel)throw error;}
      return result;
    };
    const approved=await review({decision:"APPROVE",revision:2,note:"TEST: potwierdzono prawo organizacji do udostępnienia na CC BY 4.0."});
    (db as any).transaction=originalTransaction;
    assert.equal(approved.statusCode,200,approved.body);assert.equal(approved.json().status,"DONE");
    assert.equal(inside.sourceName,proposal.sourceName);assert.equal(inside.deviceOperationalStatus,"UNKNOWN");
    assert.equal(inside.recordVerificationStatus,"UNVERIFIED");assert.equal(inside.sourceCategory,"ORGANIZATION_SUBMISSION");
    assert.equal((await db.select().from(aeds).where(eq(aeds.submittedBy,ids[0]!))).length,0,"approval fixture rolled back, never public");
    assert.equal((await app.inject({url:`/api/aed-proposals/${proposal.id}`,headers})).json().status,"NEW");
    const info=await review({decision:"REQUEST_INFO",revision:2,note:"TEST: prosimy o potwierdzenie źródła."});assert.equal(info.json().status,"UNCOMPLETED");
    actor=accounts.find(a=>a.id===ids[0])!;
    const comment=await post(`/api/submission-threads/AED/${proposal.id}`,{body:"TEST odpowiedź właściciela"});
    assert.equal(comment.statusCode,201,comment.body);
    const resubmit=await app.inject({method:"PUT",url:`/api/aed-proposals/${proposal.id}`,headers,payload:{revision:3,payload:{...proposal.payload,license:"CC-BY-4.0"},note:"TEST Uzupełniono dane"}});
    assert.equal(resubmit.statusCode,200,resubmit.body);assert.equal(resubmit.json().status,"NEW");
    actor=accounts.find(a=>a.id===ids[1])!;
    assert.equal((await app.inject({url:`/api/submission-threads/AED/${proposal.id}`,headers})).statusCode,404);
    assert.equal((await post(`/api/submission-threads/AED/${proposal.id}`,{body:"Nieuprawniony komentarz"})).statusCode,404);
    actor=accounts.find(a=>a.id===ids[2])!;
    const thread=(await app.inject({url:`/api/submission-threads/AED/${proposal.id}`,headers})).json();
    assert.ok(thread.comments.some((c:any)=>c.body==="TEST odpowiedź właściciela"));
    const reject=await review({decision:"REJECT",revision:4,note:"TEST zakończono bez publikacji."});assert.equal(reject.json().status,"REJECTED");
    assert.equal((await review({decision:"APPROVE",revision:5,note:"TEST: ponowne zatwierdzenie jest zabronione."})).statusCode,409);
    const detail=(await app.inject({url:`/api/aed-proposals/${proposal.id}`,headers})).json();
    assert.ok(detail.history.length>=4);assert.equal(detail.originalData.name,payload.name);
    actor=accounts.find(a=>a.id===ids[0])!;
    assert.equal((await app.inject({url:`/api/aed-proposals/${proposal.id}`,headers})).json().originalData,undefined);
    const template=await app.inject({url:"/api/aed-proposals/template.xlsx",headers});
    assert.equal(template.statusCode,200);assert.ok(template.headers["content-type"]!.startsWith("application/vnd.openxmlformats"));
    const book=new ExcelJS.Workbook();await book.xlsx.load(template.rawPayload as any);
    const sheet=book.getWorksheet("AED")!;assert.equal(sheet.rowCount,1);
    sheet.addRow([`TEST NIEPUBLICZNY ${tag} FILE`,"TEST 1","TEST","","",52.23,21.01,"","unknown","unknown","","","CC0-1.0"]);
    sheet.addRow(["","",`TEST ${tag}`,"","","not-a-coordinate","","","unknown","unknown","","",""]);
    const file=Buffer.from(await book.xlsx.writeBuffer());
    const imported=await post("/api/aed-proposals/import",{filename:"test.xlsx",contentBase64:file.toString("base64"),license:"UNKNOWN",publicationConsent:true});
    assert.equal(imported.statusCode,201,imported.body);assert.equal(imported.json().created,2);assert.equal(imported.json().skipped,0);
    const fileRows=await db.select().from(aedProposals).where(and(eq(aedProposals.submittedBy,ids[0]!),eq(aedProposals.submissionMethod,"FILE")));
    staged.push(...fileRows.map(r=>r.id));assert.equal(fileRows.length,2);
    assert.ok(fileRows.every(r=>r.status==="NEW"&&r.aedId===null));
    assert.ok(fileRows.every(r=>(r.evidence.publicationConsent as {accepted:boolean}).accepted===false));
    const partial=fileRows.find(r=>r.payload.name==="")!;assert.equal(partial.payload.latitude,null);
    assert.equal(partial.originalData["Szerokość geograficzna"],"not-a-coordinate");
    assert.ok(partial.issues.some(s=>s.includes("latitude")));
    assert.equal((await db.select().from(aeds).where(eq(aeds.submittedBy,ids[0]!))).length,0);
    const csv=await readProposalFile("test.csv",Buffer.from("Nazwa;Adres;Miejscowość;Licencja\nTEST;TEST;TEST;CC0-1.0").toString("base64"),"UNKNOWN");
    assert.equal(csv[0]!.input.license,"CC0-1.0");
    assert.equal((await post("/api/aed-proposals/import",{filename:"bad.exe",contentBase64:"dGVzdA==",publicationConsent:false})).statusCode,400);
    // Error report refers to an existing real public AED but does not alter it.
    const [target]=await db.select().from(aeds).where(and(eq(aeds.isDemo,false),eq(aeds.publicImport,true))).limit(1);
    assert.ok(target);
    const message=`TEST NIEPUBLICZNY ${tag} raport techniczny, nie dotyczy urządzenia.`;
    const reported=await post("/api/reports",{aedId:target.id,message});assert.equal(reported.statusCode,201,reported.body);
    const mine=(await app.inject({url:"/api/conflict-reports",headers})).json();
    const report=mine.items.find((r:any)=>r.message===message);assert.ok(report);assert.equal(report.sourceName,proposal.sourceName);
    assert.equal((await post(`/api/admin/conflict-reports/${report.id}/review`,{status:"DONE",revision:1,note:"TEST"})).statusCode,403);
    actor=accounts.find(a=>a.id===ids[2])!;
    assert.equal((await post(`/api/admin/conflict-reports/${report.id}/review`,{status:"DONE",revision:1,note:"TEST"})).statusCode,400);
    const [revision]=await db.select({value:sql<string>`${aeds.updatedAt}::text`}).from(aeds).where(eq(aeds.id,target.id));
    let correctedInside:any;
    (db as any).transaction=async(callback:any)=>{
      let result:unknown;
      try{await originalTransaction(async tx=>{
        result=await callback(tx);
        [correctedInside]=await tx.select().from(aeds).where(eq(aeds.id,target.id));
        const [insideReport]=await tx.select().from(reports).where(eq(reports.id,report.id));
        assert.equal(insideReport!.status,"DONE");
        throw sentinel;
      });}catch(error){if(error!==sentinel)throw error;}
      return result;
    };
    const corrected=await post(`/api/admin/conflict-reports/${report.id}/review`,{status:"DONE",revision:1,note:"TEST korekta i decyzja w wycofywanej transakcji",
      correction:{expectedUpdatedAt:revision!.value,description:`TEST NIEPUBLICZNY ${tag}`}});
    (db as any).transaction=originalTransaction;
    assert.equal(corrected.statusCode,200,corrected.body);assert.equal(corrected.json().status,"DONE");
    assert.equal(correctedInside.id,target.id);assert.equal(correctedInside.description,`TEST NIEPUBLICZNY ${tag}`);
    const resolved=await post(`/api/admin/conflict-reports/${report.id}/review`,{status:"REJECTED",revision:1,note:"TEST: próba techniczna, bez zmiany AED."});
    assert.equal(resolved.statusCode,200,resolved.body);assert.equal(resolved.json().status,"REJECTED");
    const [untouched]=await db.select().from(aeds).where(eq(aeds.id,target.id));
    assert.equal(untouched!.updatedAt.toISOString(),target.updatedAt.toISOString());
  }finally{
    (db as any).transaction=originalTransaction;
    if(app)await app.close();
    await db.delete(submissionComments).where(inArray(submissionComments.authorId,ids));
    const all=await db.select({id:aedProposals.id}).from(aedProposals).where(inArray(aedProposals.submittedBy,ids));
    if(all.length){const pids=all.map(r=>r.id);await db.delete(proposalEvents).where(inArray(proposalEvents.proposalId,pids));await db.delete(aedProposals).where(inArray(aedProposals.id,pids));}
    await db.delete(reports).where(inArray(reports.submittedBy,ids));
    await db.delete(auditLogs).where(inArray(auditLogs.userId,ids));
    await db.delete(users).where(inArray(users.id,ids));await db.delete(organizations).where(inArray(organizations.id,orgs));await pool.end();
  }
});
