import { and,eq,inArray,isNull,desc,sql,ilike } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db,users,organizations,memberships,mcodInstitutions,mcodInstitutionRequests,mcodDatasets,mcodResources,
  mcodPublicationPlans,mcodAedDrafts,mcodEvents,mcodSyncRuns,aeds,aedProposals } from "@workspace/db";
import { fail } from "./auth";
import type { Actor,Tx } from "./proposal-service";
import { institutionDetails } from "../integrations/mcod/contracts";
import { serializeAed } from "./aeds";
import { createMcodClient } from "../integrations/mcod/client";

export const mcodClient=createMcodClient();
export const json=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export async function ownOrganization(actor:Actor,organizationId:string){
  if(actor.role==="ADMIN")return;
  if(actor.role!=="PROVIDER"||actor.organizationId!==organizationId)fail(403,"Brak uprawnień do tej organizacji.");
  const [member]=await db.select().from(memberships).where(and(eq(memberships.userId,actor.id),eq(memberships.organizationId,organizationId)));
  if(!member)fail(403,"Brak potwierdzonego członkostwa w organizacji AED Puls.");
}
export const event=(tx:Tx,actor:Actor,organizationId:string|null,entityId:string|null,action:string,details:Record<string,unknown>={})=>
  tx.insert(mcodEvents).values({actorId:actor.id,organizationId,entityId,action,details});

export async function mcodWorkspace(actor:Actor){
  const admin=actor.role==="ADMIN",orgId=actor.organizationId;
  if(orgId&&!admin)await ownOrganization(actor,orgId);
  const orgFilter=(column:AnyPgColumn)=>admin?undefined:orgId?eq(column,orgId):sql`false`;
  const [org]=orgId?await db.select().from(organizations).where(eq(organizations.id,orgId)):[];
  const requests=await db.select().from(mcodInstitutionRequests).where(orgFilter(mcodInstitutionRequests.organizationId)).orderBy(desc(mcodInstitutionRequests.createdAt));
  const datasets=await db.select().from(mcodDatasets).where(orgFilter(mcodDatasets.organizationId)).orderBy(desc(mcodDatasets.createdAt));
  const resources=datasets.length?await db.select().from(mcodResources).where(inArray(mcodResources.datasetId,datasets.map(d=>d.id))):[];
  const plans=await db.select().from(mcodPublicationPlans).where(orgFilter(mcodPublicationPlans.organizationId)).orderBy(desc(mcodPublicationPlans.createdAt));
  const drafts=await db.select().from(mcodAedDrafts).where(orgFilter(mcodAedDrafts.organizationId)).orderBy(desc(mcodAedDrafts.createdAt));
  const proposalIds=drafts.flatMap(d=>d.proposalId?[d.proposalId]:[]);
  const proposalRows=proposalIds.length?await db.select().from(aedProposals).where(inArray(aedProposals.id,proposalIds)):[];
  const recordRows=await db.select({record:aeds,sourceRevision:sql<string>`${aeds.updatedAt}::text`}).from(aeds).where(and(admin?isNull(aeds.mergedIntoId):orgId?eq(aeds.organizationId,orgId):sql`false`,
    eq(aeds.imported,false),eq(aeds.isDemo,false),isNull(aeds.mergedIntoId))).orderBy(aeds.name);
  const records=recordRows.map(r=>r.record);
  const events=await db.select().from(mcodEvents).where(admin?undefined:orgId?eq(mcodEvents.organizationId,orgId):sql`false`).orderBy(desc(mcodEvents.createdAt)).limit(100);
  const runs=admin?await db.select().from(mcodSyncRuns).orderBy(desc(mcodSyncRuns.startedAt)).limit(30):[];
  const publishedProposals=new Set(plans.filter(p=>p.status==="PUBLISHED").flatMap(p=>p.snapshot.map(r=>r.approvedProposalId)));
  const status=mcodClient.status();
  return json({status,message:status.enabled?"Komunikacja włączona; operacje wymagają potwierdzonych kontraktów i oddzielnych uprawnień.":"Integracja MCOD oczekuje na aktywację.",
    organization:org??null,institutionRequests:requests.map(r=>({...r,organizationName:("fullName" in r.details?r.details.fullName:org?.name)??"",
      representativeName:r.details.representativeName,representativeRole:r.details.representativeRole,representativeEmail:r.details.representativeEmail})),
    datasets:datasets.map(d=>({...d,remoteId:d.datasetId})),resources,
    plans:plans.map(({snapshot,...plan})=>({...plan,recordCount:snapshot.length,recordIds:snapshot.map(r=>r.id),
      format:resources.find(r=>r.id===plan.resourceId)?.format})),
    drafts:drafts.map(d=>{
      const proposal=proposalRows.find(p=>p.id===d.proposalId);
      return {...d,status:proposal?.status==="DONE"?(publishedProposals.has(proposal.id)?"PUBLISHED":"APPROVED"):
        proposal?.status==="REJECTED"?"REJECTED":d.status,reviewStatus:proposal?.status,proposalStatus:proposal?.status,reviewNote:proposal?.reviewNote};
    }),
    records:records.map(serializeAed),
    recordStates:recordRows.map(({record,sourceRevision})=>({id:record.id,
      status:plans.some(p=>p.status==="PUBLISHED"&&p.snapshot.some(r=>r.id===record.id&&r.sourceRevision===sourceRevision))?"PUBLISHED":
        record.verificationStatus==="VERIFIED"?"APPROVED":record.verificationStatus==="REJECTED"?"REJECTED":"PENDING_APPROVAL"})),events,
    syncRuns:runs.map(r=>({...r,kind:"MCOD_IMPORT",createdAt:r.startedAt})),
    unconfirmedOperations:mcodClient.unconfirmedOperations()});
}
export async function cachedInstitutions(page:number,search:string){
  const where=search?ilike(mcodInstitutions.name,`%${search.replace(/[%_\\]/g,"\\$&")}%`):undefined;
  const [total]=await db.select({n:sql<number>`count(*)::int`}).from(mcodInstitutions).where(where);
  const items=await db.select().from(mcodInstitutions).where(where).orderBy(mcodInstitutions.name,mcodInstitutions.id).limit(20).offset((page-1)*20);
  return json({items:items.map(({id,name,checkedAt})=>({id,name,checkedAt})),total:total!.n,page,pageSize:20,activationRequired:!mcodClient.status().enabled});
}
export async function refreshInstitutions(actor:Actor){
  if(actor.role!=="ADMIN")fail(403,"Tylko administrator odświeża instytucje MCOD.");
  mcodClient.assertEnabled();
  let count=0;
  for await(const page of mcodClient.allPages("getInstitutions",{}))for(const institution of page){
    await db.insert(mcodInstitutions).values({id:institution.id,name:institution.name,payload:json(institution),checkedAt:new Date()})
      .onConflictDoUpdate({target:mcodInstitutions.id,set:{name:institution.name,payload:json(institution),checkedAt:new Date()}});
    count++;
  }
  await db.transaction(tx=>event(tx,actor,null,null,"INSTITUTIONS_REFRESHED",{count}));
  return {count,message:"Odświeżono rzeczywiste instytucje z MCOD."};
}
export async function submitInstitution(actor:Actor,input:{
  kind:"NEW"|"EXISTING";organizationName?:string;institutionId?:string;representativeName:string;representativeRole:string;
  representativeEmail:string;details?:Record<string,unknown>;
}){
  if(!["USER","PROVIDER"].includes(actor.role))fail(403,"Administrator weryfikuje wnioski; nie składa ich jako organizacja.");
  if(input.representativeName.trim().length<2||input.representativeRole.trim().length<2)fail(400,"Podaj imię, nazwisko i funkcję reprezentanta.");
  const details=input.kind==="NEW"?institutionDetails.parse({...input.details,representativeName:input.representativeName,representativeRole:input.representativeRole})
    :{...input.details,representativeName:input.representativeName,representativeRole:input.representativeRole};
  return db.transaction(async tx=>{
    const [current]=await tx.select().from(users).where(eq(users.id,actor.id)).for("update");
    if(!current)fail(401,"Sesja wygasła.");
    const [cached]=input.kind==="EXISTING"&&input.institutionId?await tx.select().from(mcodInstitutions).where(eq(mcodInstitutions.id,input.institutionId)):[];
    if(input.kind==="EXISTING"&&!cached)fail(409,"Wybierz rzeczywistą instytucję z potwierdzonej pamięci MCOD. Obecnie może być wymagane jej odświeżenie po aktywacji.");
    let organizationId=current.organizationId;
    if(!organizationId){
      const name=(input.organizationName||("fullName" in details?String(details.fullName):cached?.name)||"").trim();
      if(name.length<2)fail(400,"Podaj pełną nazwę organizacji.");
      const [org]=await tx.insert(organizations).values({name,isDemo:false}).returning();
      organizationId=org!.id;
      await tx.insert(memberships).values({userId:actor.id,organizationId});
      await tx.update(users).set({role:"PROVIDER",organizationId}).where(eq(users.id,actor.id));
    }else{
      const [membership]=await tx.select().from(memberships).where(and(eq(memberships.organizationId,organizationId),eq(memberships.userId,actor.id)));
      if(!membership)fail(403,"Brak członkostwa w organizacji.");
    }
    await tx.select().from(organizations).where(eq(organizations.id,organizationId)).for("update");
    const [active]=await tx.select().from(mcodInstitutionRequests).where(and(eq(mcodInstitutionRequests.organizationId,organizationId),
      inArray(mcodInstitutionRequests.status,["PENDING_VERIFICATION","APPROVED","PROCESSING","REGISTERED","UNKNOWN_OUTCOME"])));
    if(active)fail(409,"Organizacja ma już aktywny wniosek lub powiązanie MCOD.");
    const [request]=await tx.insert(mcodInstitutionRequests).values({organizationId,submittedBy:actor.id,kind:input.kind,
      requestedInstitutionId:cached?.id??null,details:json({...details,representativeEmail:input.representativeEmail,
        ...(cached?{fullName:cached.name,cacheCheckedAt:cached.checkedAt.toISOString()}:{} )}),status:"PENDING_VERIFICATION"}).returning();
    await event(tx,actor,organizationId,request!.id,"INSTITUTION_REQUESTED",{kind:input.kind});
    return json(request!);
  });
}
export async function reviewInstitution(actor:Actor,id:string,input:{decision:"APPROVE"|"REJECT";expectedRevision:number;note:string;representativeVerified:boolean}){
  if(actor.role!=="ADMIN")fail(403,"Tylko administrator weryfikuje przedstawiciela instytucji.");
  if(input.note.trim().length<5)fail(400,"Opisz wynik i podstawę sprawdzenia reprezentanta.");
  return db.transaction(async tx=>{
    const [request]=await tx.select().from(mcodInstitutionRequests).where(eq(mcodInstitutionRequests.id,id)).for("update");
    if(!request)fail(404,"Nie znaleziono wniosku.");
    if(request.status!=="PENDING_VERIFICATION"||request.revision!==input.expectedRevision)fail(409,"Wniosek został zmieniony lub już oceniony.");
    if(input.decision==="APPROVE"&&!input.representativeVerified)fail(400,"Najpierw potwierdź uprawnienia reprezentanta.");
    const [updated]=await tx.update(mcodInstitutionRequests).set({status:input.decision==="APPROVE"?"APPROVED":"REJECTED",
      reviewNote:input.note,reviewedBy:actor.id,revision:request.revision+1,updatedAt:sql`clock_timestamp()`})
      .where(eq(mcodInstitutionRequests.id,id)).returning();
    await event(tx,actor,request.organizationId,id,"INSTITUTION_REVIEWED",{decision:input.decision,note:input.note,representativeVerified:input.representativeVerified});
    return json(updated!);
  });
}
