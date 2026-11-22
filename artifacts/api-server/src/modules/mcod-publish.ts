import { createHash } from "node:crypto";
import { and,eq,sql } from "drizzle-orm";
import { db,mcodInstitutionRequests,mcodDatasets,mcodResources,mcodPublicationPlans } from "@workspace/db";
import { McodError } from "../integrations/mcod/client";
import { institutionDetails } from "../integrations/mcod/contracts";
import { renderPublication,planKey } from "../integrations/mcod/publication-format";
import { fail } from "./auth";
import type { Actor } from "./proposal-service";
import { mcodClient,ownOrganization,event,json } from "./mcod-local";
import { publicationSnapshot } from "./mcod-plans";

export async function executeInstitution(actor:Actor,id:string){
  if(actor.role!=="ADMIN")fail(403,"Tylko administrator zatwierdza powiązanie z instytucją MCOD.");
  mcodClient.assertEnabled("write");
  const [initial]=await db.select().from(mcodInstitutionRequests).where(eq(mcodInstitutionRequests.id,id));
  if(!initial)fail(404,"Nie znaleziono wniosku.");
  if(initial.status==="REGISTERED")return json(initial);
  mcodClient.ensureOperations(initial.kind==="NEW"?["createInstitution"]:["getInstitution"],"write");
  const request=await db.transaction(async tx=>{
    const [row]=await tx.select().from(mcodInstitutionRequests).where(eq(mcodInstitutionRequests.id,id)).for("update");
    if(!row||row.status!=="APPROVED"||!row.reviewedBy)fail(409,"Wniosek nie jest zatwierdzony lub ma już rozpoczętą operację.");
    await tx.update(mcodInstitutionRequests).set({status:"PROCESSING",lastError:null,updatedAt:sql`clock_timestamp()`}).where(eq(mcodInstitutionRequests.id,id));
    await event(tx,actor,row.organizationId,id,"INSTITUTION_EXECUTION_STARTED",{idempotencyKey:`institution:${id}`});
    return row;
  });
  try{
    const remote=request.kind==="NEW"
      ?await mcodClient.createInstitution({...institutionDetails.parse(request.details),idempotencyKey:`institution:${id}`})
      :await mcodClient.getInstitution(request.requestedInstitutionId!);
    if(request.kind==="EXISTING"&&remote.id!==request.requestedInstitutionId)throw new McodError("MCOD_UNKNOWN_OUTCOME",502,"MCOD zwrócił inną instytucję niż wybrana.");
    return await db.transaction(async tx=>{
      const [updated]=await tx.update(mcodInstitutionRequests).set({institutionId:remote.id,status:"REGISTERED",lastError:null,updatedAt:sql`clock_timestamp()`})
        .where(and(eq(mcodInstitutionRequests.id,id),eq(mcodInstitutionRequests.status,"PROCESSING"))).returning();
      if(!updated)throw new Error("local_state_conflict");
      await tx.insert((await import("@workspace/db")).mcodInstitutions).values({id:remote.id,name:remote.name,payload:json(remote),checkedAt:new Date()})
        .onConflictDoUpdate({target:(await import("@workspace/db")).mcodInstitutions.id,set:{name:remote.name,payload:json(remote),checkedAt:new Date()}});
      await event(tx,actor,request.organizationId,id,"INSTITUTION_CONFIRMED",{institutionId:remote.id});
      return json(updated);
    });
  }catch(error){
    const uncertain=!(error instanceof McodError)||error.code==="MCOD_UNKNOWN_OUTCOME";
    await db.transaction(async tx=>{
      await tx.update(mcodInstitutionRequests).set({status:uncertain?"UNKNOWN_OUTCOME":"APPROVED",
        lastError:uncertain?"Nie potwierdzono wyniku. Wymagana ręczna kontrola MCOD; nie ponawiaj tworzenia.":(error as McodError).message,
        updatedAt:sql`clock_timestamp()`}).where(eq(mcodInstitutionRequests.id,id));
      await event(tx,actor,request.organizationId,id,"INSTITUTION_EXECUTION_FAILED",{code:error instanceof McodError?error.code:"UNKNOWN_OUTCOME",uncertain});
    });
    if(error instanceof McodError)throw error;
    throw new McodError("MCOD_UNKNOWN_OUTCOME",502,"Nie potwierdzono zapisu wyniku MCOD. Nie ponawiaj tworzenia.");
  }
}
const sameIdentity=(row:{institutionId:string;datasetId?:string;id:string},institutionId:string,datasetId?:string,id?:string)=>{
  if(row.institutionId!==institutionId||(datasetId&&row.datasetId!==datasetId)||(id&&row.id!==id))
    throw new McodError("MCOD_UNKNOWN_OUTCOME",502,"Niespójna tożsamość danych MCOD. Przerwano publikację.");
};
export async function executePublication(actor:Actor,id:string){
  mcodClient.assertEnabled("write");
  const [initial]=await db.select().from(mcodPublicationPlans).where(eq(mcodPublicationPlans.id,id));
  if(!initial)fail(404,"Nie znaleziono planu publikacji.");
  await ownOrganization(actor,initial.organizationId);
  if(initial.status==="PUBLISHED")return json({...initial,snapshot:undefined});
  mcodClient.ensureOperations(["getDatasets","createDataset","publishDataset","createResource","updateResource","publishResource","getResource","downloadResource"],"write");
  const licenses=[...new Set(initial.snapshot.map(r=>String(r.license)))] as ("CC0-1.0"|"CC-BY-4.0"|"ODbL-1.0")[];
  if(licenses.length>1&&!mcodClient.supportsMixedLicenses())
    throw new McodError("MCOD_CONTRACT_UNCONFIRMED",409,"Nie potwierdzono obsługi oznaczeń licencyjnych poszczególnych rekordów w zasobie MCOD.");
  const reservation=await db.transaction(async tx=>{
    const [dataset]=await tx.select().from(mcodDatasets).where(eq(mcodDatasets.id,initial.datasetId)).for("update");
    const [plan]=await tx.select().from(mcodPublicationPlans).where(eq(mcodPublicationPlans.id,id)).for("update");
    const [resource]=await tx.select().from(mcodResources).where(eq(mcodResources.id,initial.resourceId)).for("update");
    if(!dataset||!plan||!resource||resource.datasetId!==dataset.id||dataset.organizationId!==plan.organizationId)fail(409,"Niespójne powiązanie planu.");
    if(!["PREPARED","FAILED"].includes(plan.status)||["PROCESSING","UNKNOWN_OUTCOME"].includes(dataset.publicationStatus)||
      resource.publicationStatus==="UNKNOWN_OUTCOME")fail(409,"Plan jest zablokowany, już rozpoczęty lub ma niepotwierdzony wynik.");
    const [institution]=await tx.select().from(mcodInstitutionRequests).where(eq(mcodInstitutionRequests.id,dataset.institutionRequestId)).for("update");
    if(!institution||institution.status!=="REGISTERED"||!institution.institutionId||institution.organizationId!==plan.organizationId)
      fail(409,"Brak zweryfikowanego powiązania z rzeczywistą instytucją MCOD.");
    const current=await publicationSnapshot(plan.organizationId,tx);
    if(current.validation.issues.length||planKey(dataset.id,resource.format,current.snapshot,current.validation)!==plan.idempotencyKey)
      fail(409,"Dane lub prawa zmieniły się od przygotowania planu. Przygotuj nowy plan.");
    await tx.update(mcodPublicationPlans).set({status:"PROCESSING",lastError:null,updatedAt:sql`clock_timestamp()`}).where(eq(mcodPublicationPlans.id,id));
    await tx.update(mcodDatasets).set({publicationStatus:"PROCESSING",lastError:null}).where(eq(mcodDatasets.id,dataset.id));
    await event(tx,actor,plan.organizationId,id,"PUBLICATION_STARTED",{idempotencyKey:plan.idempotencyKey});
    return {dataset,plan,resource,institutionId:institution.institutionId};
  });
  const {dataset,plan,resource,institutionId}=reservation;
  let datasetId=dataset.datasetId,resourceId=resource.resourceId;
  const content=renderPublication(plan.snapshot,resource.format as "csv"|"geojson");
  try{
    if(!datasetId){
      const remote=await mcodClient.createDataset({institutionId,title:dataset.title,description:dataset.description,idempotencyKey:`dataset:${dataset.id}`});
      sameIdentity(remote,institutionId);datasetId=remote.id;
      await db.update(mcodDatasets).set({datasetId,institutionId,updatedAt:sql`clock_timestamp()`}).where(eq(mcodDatasets.id,dataset.id));
    }else{
      let found=false;
      for await(const page of mcodClient.allPages("getDatasets",{institutionId}))for(const remote of page)if(remote.id===datasetId){sameIdentity(remote,institutionId);found=true;}
      if(!found)throw new McodError("MCOD_OWNERSHIP_UNCONFIRMED",409,"Nie potwierdzono własności zbioru MCOD.");
    }
    if(resourceId)sameIdentity(await mcodClient.getResource(resourceId,institutionId),institutionId,datasetId,resourceId);
    const payload={institutionId,datasetId,title:`${dataset.title} — AED ${resource.format.toUpperCase()}`,
      format:resource.format as "csv"|"geojson",content,licenses,idempotencyKey:plan.idempotencyKey};
    const remote=resourceId?await mcodClient.updateResource(resourceId,payload):await mcodClient.createResource(payload);
    sameIdentity(remote,institutionId,datasetId,resourceId??undefined);
    if(remote.format!==resource.format||(remote.license&&(!licenses.includes(remote.license)||licenses.length>1)))
      throw new McodError("MCOD_UNKNOWN_OUTCOME",502,"MCOD nie potwierdził poprawnego formatu lub oznaczeń licencyjnych.");
    resourceId=remote.id;
    await db.update(mcodResources).set({resourceId,publicationStatus:"DRAFT",lastError:null}).where(eq(mcodResources.id,resource.id));
    const publishedDataset=await mcodClient.publishDataset(datasetId,{institutionId,idempotencyKey:`publish-dataset:${dataset.id}`});
    sameIdentity(publishedDataset,institutionId,undefined,datasetId);
    if(publishedDataset.publicationStatus!=="PUBLISHED")throw new McodError("MCOD_UNKNOWN_OUTCOME",502,"MCOD nie potwierdził publikacji zbioru.");
    const published=await mcodClient.publishResource(resourceId,{institutionId,idempotencyKey:`publish:${plan.idempotencyKey}`});
    sameIdentity(published,institutionId,datasetId,resourceId);
    const verified=await mcodClient.getResource(resourceId,institutionId);
    sameIdentity(verified,institutionId,datasetId,resourceId);
    if(published.publicationStatus!=="PUBLISHED"||verified.publicationStatus!=="PUBLISHED"||!verified.publishedAt)
      throw new McodError("MCOD_UNKNOWN_OUTCOME",502,"MCOD nie potwierdził opublikowanego stanu zasobu.");
    const downloaded=await mcodClient.downloadResource(resourceId,institutionId);
    const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
    if(downloaded.format!==resource.format||digest(downloaded.content)!==digest(content))
      throw new McodError("MCOD_UNKNOWN_OUTCOME",502,"Nie potwierdzono zgodności opublikowanego pliku z planem.");
    return await db.transaction(async tx=>{
      const publishedAt=new Date(verified.publishedAt!);
      const [completed]=await tx.update(mcodPublicationPlans).set({status:"PUBLISHED",lastError:null,publishedAt,updatedAt:sql`clock_timestamp()`})
        .where(and(eq(mcodPublicationPlans.id,id),eq(mcodPublicationPlans.status,"PROCESSING"))).returning();
      if(!completed)throw new Error("local_state_conflict");
      await tx.update(mcodResources).set({publicationStatus:"PUBLISHED",publishedAt,lastError:null}).where(eq(mcodResources.id,resource.id));
      await tx.update(mcodDatasets).set({publicationStatus:"PUBLISHED",lastError:null,updatedAt:sql`clock_timestamp()`}).where(eq(mcodDatasets.id,dataset.id));
      await event(tx,actor,plan.organizationId,id,"PUBLICATION_CONFIRMED",{institutionId,datasetId,resourceId,records:plan.snapshot.length});
      return json({...completed,snapshot:undefined});
    });
  }catch(error){
    const uncertain=!(error instanceof McodError)||error.code==="MCOD_UNKNOWN_OUTCOME";
    const message=uncertain?"Nie potwierdzono wyniku publikacji. Wymagana ręczna kontrola; bez automatycznego ponawiania.":(error as McodError).message;
    await db.transaction(async tx=>{
      await tx.update(mcodPublicationPlans).set({status:uncertain?"UNKNOWN_OUTCOME":"FAILED",lastError:message,updatedAt:sql`clock_timestamp()`}).where(eq(mcodPublicationPlans.id,id));
      await tx.update(mcodResources).set({publicationStatus:uncertain?"UNKNOWN_OUTCOME":"FAILED",lastError:message}).where(eq(mcodResources.id,resource.id));
      await tx.update(mcodDatasets).set({publicationStatus:uncertain?"UNKNOWN_OUTCOME":"FAILED",lastError:message}).where(eq(mcodDatasets.id,dataset.id));
      await event(tx,actor,plan.organizationId,id,"PUBLICATION_FAILED",{code:error instanceof McodError?error.code:"UNKNOWN_OUTCOME",uncertain});
    });
    if(error instanceof McodError)throw error;
    throw new McodError("MCOD_UNKNOWN_OUTCOME",502,message);
  }
}
