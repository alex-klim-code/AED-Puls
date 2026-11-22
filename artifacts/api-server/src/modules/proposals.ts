import type { FastifyInstance } from "fastify";
import { and,asc,desc,eq,sql,inArray,or,ilike } from "drizzle-orm";
import { z } from "zod/v4";
import { db,aedProposals,proposalEvents,reports,aeds,auditLogs,users,submissionComments } from "@workspace/db";
import {
  SubmitAedBody,ListAedProposalsResponse,GetAedProposalResponse,ReviewAedProposalBody,ReviewAedProposalResponse,
  ImportAedProposalsBody,ImportAedProposalsResponse,ListConflictReportsResponse,ReviewConflictReportBody,ReviewConflictReportResponse,
  ResubmitAedProposalBody,ResubmitAedProposalResponse,GetConflictReportResponse,FindProposalDuplicatesResponse,
} from "@workspace/api-zod";
import { fail,requireUser } from "./auth";
import { canReadProposal,prepareProposal,storeProposal,proposalAccess,proposalDto,publishProposal,normalizeProposalLicense } from "./proposal-service";
import { proposalTemplate,readProposalFile } from "./proposal-files";
import { assessQuality } from "./quality";
import { submissionStatus,statusAliases,submissionAccess } from "./submission-access";
import { serializeAed } from "./aeds";
import { applyAdminRecordCorrection } from "./admin-records";
const query=z.object({status:z.string().max(30).optional(),page:z.coerce.number().int().min(1).max(100000).default(1)});
const uuid=(params:unknown)=>z.object({id:z.string().uuid()}).parse(params).id;
export function registerProposals(app:FastifyInstance){
  app.get("/api/aed-proposals",async req=>{
    const user=requireUser(req),q=query.parse(req.query);
    if(q.status&&!["NEW","UNCOMPLETED","DONE","REJECTED"].includes(q.status))fail(400,"Nieprawidłowy status zgłoszenia.");
    const where=and(proposalAccess(user),q.status?inArray(aedProposals.status,statusAliases(q.status)):undefined);
    const [count]=await db.select({n:sql<number>`count(*)::int`}).from(aedProposals).where(where);
    const rows=await db.select().from(aedProposals).where(where).orderBy(desc(aedProposals.createdAt),aedProposals.id).limit(50).offset((q.page-1)*50);
    return ListAedProposalsResponse.parse({items:rows.map(r=>proposalDto(r)),total:count!.n,page:q.page});
  });
  app.get("/api/aed-proposals/:id",async req=>{
    const user=requireUser(req),id=uuid(req.params);
    const [row]=await db.select().from(aedProposals).where(eq(aedProposals.id,id));
    if(!row||!canReadProposal(row,user))fail(404,"Nie znaleziono zgłoszenia.");
    const history=await db.select().from(proposalEvents).where(eq(proposalEvents.proposalId,id)).orderBy(asc(proposalEvents.createdAt));
    const [submitter]=await db.select({name:users.name}).from(users).where(eq(users.id,row.submittedBy));
    return GetAedProposalResponse.parse({...proposalDto(row,history.map(e=>({...e,createdAt:e.createdAt.toISOString()}))),
      submitterName:submitter?.name??"Użytkownik",
      ...(user.role==="ADMIN"?{originalData:row.originalData}:{})});
  });
  app.put("/api/aed-proposals/:id",async req=>{
    const user=requireUser(req,["USER","PROVIDER"]),id=uuid(req.params),input=ResubmitAedProposalBody.parse(req.body);
    const row=await db.transaction(async tx=>{
      const [before]=await tx.select().from(aedProposals).where(eq(aedProposals.id,id)).for("update");
      if(!before||!canReadProposal(before,user))fail(404,"Nie znaleziono zgłoszenia.");
      if(submissionStatus(before.status)!=="UNCOMPLETED")fail(409,"Uzupełnić można wyłącznie zgłoszenie UNCOMPLETED.");
      if(before.revision!==input.revision)fail(409,"Zgłoszenie zmieniło się. Odśwież szczegóły.");
      if(input.payload.photoId&&input.payload.photoId!==before.photoId)fail(400,"Zdjęcie uzupełniające dodaj w komentarzu.");
      if(input.payload.submissionMethod==="FILE")input.payload.submissionMethod="MANUAL";
      const prepared=await prepareProposal(input.payload,user,undefined,before);
      const payload={...prepared.payload,sourceName:before.sourceName};
      const [after]=await tx.update(aedProposals).set({payload,evidence:{...before.evidence,...prepared.evidence},issues:prepared.issues,
        status:"NEW",reviewNote:input.note,revision:before.revision+1,updatedAt:new Date(),submissionMethod:prepared.submissionMethod})
        .where(eq(aedProposals.id,id)).returning();
      await tx.insert(proposalEvents).values({proposalId:id,actorId:user.id,action:"RESUBMITTED",
        changes:{before:before.payload,after:payload,beforeStatus:submissionStatus(before.status),status:"NEW",note:input.note}});
      await tx.insert(submissionComments).values({kind:"AED",entityId:id,authorId:user.id,body:input.note});
      await tx.insert(auditLogs).values({userId:user.id,entityId:id,action:"Uzupełniono zgłoszenie i przekazano ponownie do weryfikacji",details:{revision:after!.revision}});
      return after!;
    });
    return ResubmitAedProposalResponse.parse(proposalDto(row));
  });
  app.get("/api/admin/aed-proposals/:id/duplicates",async req=>{
    requireUser(req,["ADMIN"]);const id=uuid(req.params);
    const [row]=await db.select().from(aedProposals).where(eq(aedProposals.id,id));
    if(!row)fail(404,"Nie znaleziono zgłoszenia.");
    const p=row.payload,lat=typeof p.latitude==="number"?p.latitude:null,lon=typeof p.longitude==="number"?p.longitude:null;
    const name=typeof p.name==="string"?p.name.trim():"",address=typeof p.address==="string"?p.address.trim():"";
    const terms=[lat!==null&&lon!==null?sql`abs(${aeds.latitude}-${lat})<0.002 and abs(${aeds.longitude}-${lon})<0.003`:undefined,
      name.length>=3?eq(aeds.name,name):undefined,address.length>=3?and(eq(aeds.address,address),eq(aeds.city,String(p.city??""))):undefined].filter(Boolean);
    if(!terms.length)return [];
    const rows=await db.select().from(aeds).where(and(eq(aeds.isDemo,false),sql`${aeds.mergedIntoId} is null`,or(...terms as ReturnType<typeof sql>[]))).limit(20);
    return FindProposalDuplicatesResponse.parse(rows.map(serializeAed));
  });
  app.get("/api/aed-proposals/template.xlsx",async(req,reply)=>{
    requireUser(req,["PROVIDER"]);
    return reply.header("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition",'attachment; filename="aed_wzor_zgloszenia.xlsx"').send(await proposalTemplate());
  });
  app.post("/api/aed-proposals/import",{bodyLimit:8*1024*1024,config:{rateLimit:{max:5,timeWindow:"1 minute"}}},async(req,reply)=>{
    const user=requireUser(req,["PROVIDER"]),input=ImportAedProposalsBody.parse(req.body);
    const rows=await readProposalFile(input.filename,input.contentBase64,input.license);
    const prepared:Awaited<ReturnType<typeof prepareProposal>>[]=[],errors:{row:number;message:string}[]=[];
    for(const row of rows){
      try{
        const publicationConsent=input.publicationConsent&&input.license!=="UNKNOWN"&&normalizeProposalLicense(row.input.license)===input.license;
        const p=await prepareProposal({...row.input,publicationConsent},user,
          {filename:input.filename,row:row.row,original:row.raw,warnings:row.warnings});
        prepared.push(p);
        if(row.warnings.length)errors.push({row:row.row,message:`Zapisano do oceny: ${row.warnings.join(" ")}`});
      }catch(error){errors.push({row:row.row,message:(error as {statusCode?:number}).statusCode===403?"Brak uprawnień organizacji.":"Nie można przetworzyć wiersza. Sprawdź długości i formaty pól."});}
    }
    if(!prepared.length)fail(400,"Nie przetworzono żadnego wiersza. Sprawdź uprawnienia organizacji i poprawność wzoru.");
    await db.transaction(async tx=>{for(const row of prepared)await storeProposal(tx,row,user.id);});
    return reply.code(201).send(ImportAedProposalsResponse.parse({created:prepared.length,skipped:rows.length-prepared.length,errors}));
  });
  app.post("/api/admin/aed-proposals/:id/review",async req=>{
    const user=requireUser(req,["ADMIN"]),id=uuid(req.params),decision=ReviewAedProposalBody.parse(req.body);
    const updated=await db.transaction(async tx=>{
      const [row]=await tx.select().from(aedProposals).where(eq(aedProposals.id,id)).for("update");
      if(!row)fail(404,"Nie znaleziono zgłoszenia.");
      if(row.revision!==decision.revision)fail(409,"Zgłoszenie zmieniło się. Odśwież je przed zapisaniem decyzji.");
      if(["DONE","REJECTED"].includes(submissionStatus(row.status))||row.aedId)fail(409,"Zgłoszenie zostało już zakończone.");
      const {locationToken,publicationConsent,photoId,...payload}=SubmitAedBody.parse(decision.payload??row.payload);
      payload.sourceName=row.sourceName;payload.submissionMethod=row.submissionMethod as typeof payload.submissionMethod;
      payload.license=row.submitterRole==="USER"?"CC-BY-4.0":normalizeProposalLicense(payload.license);
      if(row.submitterRole==="USER")payload.sourceUrl="";
      if(payload.sourceUrl&&!/^https?:\/\/[^\s]+$/i.test(payload.sourceUrl))fail(400,"Popraw adres URL źródła.");
      if(decision.decision!=="SAVE"&&decision.note.trim().length<3)fail(400,"Dodaj uzasadnienie decyzji (co najmniej 3 znaki).");
      const consent=row.evidence.publicationConsent as {accepted?:boolean;license?:string}|undefined;
      if(decision.decision==="APPROVE"&&(!consent?.accepted||consent.license==="UNKNOWN")&&decision.note.trim().length<20)
        fail(400,"Udokumentuj podstawę licencji i uprawnienia organizacji w uzasadnieniu (minimum 20 znaków).");
      const locationChanged=(["latitude","longitude","address","city","postalCode","voivodeship"] as const)
        .some(k=>(row.payload[k]??"")!==(payload[k]??""));
      const oldLocation=row.evidence.locationEvidence as Record<string,unknown>;
      const evidence=locationChanged?{...row.evidence,locationEvidence:{...oldLocation,method:"administrator_completion",
        previousLocationEvidence:oldLocation,reviewerId:user.id,notDeviceVerification:true}}:row.evidence;
      const aedId=decision.decision==="APPROVE"?await publishProposal(tx,{...row,evidence},payload,user):null;
      const status=({SAVE:submissionStatus(row.status),APPROVE:"DONE",REJECT:"REJECTED",REQUEST_INFO:"UNCOMPLETED"})[decision.decision];
      const [after]=await tx.update(aedProposals).set({payload,evidence,issues:assessQuality(payload).qualityIssues,
        status,reviewNote:decision.note.trim(),reviewedBy:user.id,aedId,updatedAt:new Date(),revision:row.revision+1})
        .where(eq(aedProposals.id,id)).returning();
      await tx.insert(proposalEvents).values({proposalId:id,actorId:user.id,action:decision.decision,
        changes:{before:row.payload,after:payload,note:decision.note.trim(),beforeStatus:submissionStatus(row.status),status,aedId}});
      if(decision.note.trim())await tx.insert(submissionComments).values({kind:"AED",entityId:id,authorId:user.id,body:decision.note.trim()});
      await tx.insert(auditLogs).values({userId:user.id,entityId:id,action:`Decyzja administratora: ${decision.decision}`,
        details:{before:row.status,after:status,aedId}});
      return after!;
    });
    return ReviewAedProposalResponse.parse(proposalDto(updated));
  });
  app.get("/api/conflict-reports",async req=>{
    const user=requireUser(req),q=query.parse(req.query);
    if(q.status&&!["NEW","UNCOMPLETED","DONE","REJECTED"].includes(q.status))fail(400,"Nieprawidłowy status błędu.");
    const access=user.role==="ADMIN"?undefined:user.role==="PROVIDER"&&user.organizationId?eq(reports.organizationId,user.organizationId):eq(reports.submittedBy,user.id);
    const where=and(access,q.status?inArray(reports.status,statusAliases(q.status)):undefined);
    const [count]=await db.select({n:sql<number>`count(*)::int`}).from(reports).where(where);
    const rows=await db.select({report:reports,aedName:aeds.name}).from(reports).innerJoin(aeds,eq(reports.aedId,aeds.id)).where(where)
      .orderBy(desc(reports.createdAt),reports.id).limit(50).offset((q.page-1)*50);
    return ListConflictReportsResponse.parse({items:rows.map(r=>({...r.report,status:submissionStatus(r.report.status),aedName:r.aedName,createdAt:r.report.createdAt.toISOString()})),total:count!.n,page:q.page});
  });
  app.get("/api/conflict-reports/:id",async req=>{
    const user=requireUser(req),id=uuid(req.params);
    await submissionAccess("ERROR",id,user);
    const [row]=await db.select().from(reports).where(eq(reports.id,id));
    const [record]=await db.select({record:aeds,revision:sql<string>`${aeds.updatedAt}::text`}).from(aeds).where(eq(aeds.id,row!.aedId));
    const [submitter]=row!.submittedBy?await db.select({name:users.name}).from(users).where(eq(users.id,row!.submittedBy)):[];
    return GetConflictReportResponse.parse({...row,status:submissionStatus(row!.status),createdAt:row!.createdAt.toISOString(),aedName:record?.record.name??"",
      submitterName:submitter?.name??"Użytkownik",...(user.role==="ADMIN"&&record?{target:{...serializeAed(record.record),revision:record.revision}}:{})});
  });
  app.post("/api/admin/conflict-reports/:id/review",async req=>{
    const user=requireUser(req,["ADMIN"]),id=uuid(req.params),input=ReviewConflictReportBody.parse(req.body);
    const row=await db.transaction(async tx=>{
      const [before]=await tx.select().from(reports).where(eq(reports.id,id)).for("update");
      if(!before)fail(404,"Nie znaleziono zgłoszenia błędu.");
      if(before.revision!==input.revision)fail(409,"Zgłoszenie błędu zmieniło się. Odśwież listę.");
      if(["DONE","REJECTED"].includes(submissionStatus(before.status)))fail(409,"Zgłoszenie błędu zostało już rozpatrzone.");
      if(input.status==="DONE"){
        if(!input.correction)fail(400,"DONE wymaga poprawki istniejącego AED. Zgłoszenie niezasadne odrzuć z uzasadnieniem.");
        await applyAdminRecordCorrection(tx,user,before.aedId,input.correction,true);
      }
      const [after]=await tx.update(reports).set({status:input.status,reviewNote:input.note.trim(),reviewedBy:user.id,
        reviewedAt:new Date(),revision:before.revision+1}).where(eq(reports.id,id)).returning();
      await tx.insert(auditLogs).values({userId:user.id,entityId:id,action:"Rozpatrzono zgłoszenie błędu",
        details:{aedId:before.aedId,before:submissionStatus(before.status),after:input.status,note:input.note,correction:input.correction??null,notDeviceVerification:true}});
      await tx.insert(submissionComments).values({kind:"ERROR",entityId:id,authorId:user.id,body:input.note.trim()});
      return after!;
    });
    const [target]=await db.select({name:aeds.name}).from(aeds).where(eq(aeds.id,row.aedId));
    return ReviewConflictReportResponse.parse({...row,aedName:target?.name??"",createdAt:row.createdAt.toISOString()});
  });
}
