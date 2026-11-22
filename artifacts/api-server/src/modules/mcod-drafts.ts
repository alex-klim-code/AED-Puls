import { z } from "zod/v4";
import { and,eq,sql,isNull } from "drizzle-orm";
import { db,aeds,aedProposals,mcodAedDrafts,mcodDatasets,mcodInstitutionRequests } from "@workspace/db";
import { fail } from "./auth";
import { prepareProposal,storeProposal,type Actor } from "./proposal-service";
import { event,ownOrganization,json } from "./mcod-local";

export const aedDraftPayload=z.object({
  name:z.string().max(160).default(""),address:z.string().max(240).default(""),city:z.string().max(120).default(""),
  postalCode:z.string().max(10).default(""),voivodeship:z.string().max(100).default(""),
  latitude:z.number().min(-90).max(90).nullable().default(null),longitude:z.number().min(-180).max(180).nullable().default(null),
  description:z.string().max(2000).default(""),placement:z.enum(["indoor","outdoor","unknown"]).default("unknown"),
  accessibility:z.enum(["24/7","limited","unknown"]).default("unknown"),openingHours:z.string().max(200).default(""),
  sourceUrl:z.string().max(1000).default(""),license:z.enum(["UNKNOWN","CC0-1.0","CC-BY-4.0","ODbL-1.0"]).default("UNKNOWN"),
  responsibleOrganization:z.string().max(500).default(""),publicAccess:z.boolean().nullable().default(null),
  notes:z.string().max(2000).default(""),deviceStatus:z.enum(["UNKNOWN","OPERATIONAL","OUT_OF_SERVICE"]).default("UNKNOWN"),
  lastVerifiedAt:z.union([z.iso.date(),z.literal(""),z.null()]).default(null).refine(value=>!value||
    value<=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Warsaw"}).format(new Date()),"Data kontroli nie może być w przyszłości."),
});
export async function saveAedDraft(actor:Actor,input:{payload:Record<string,unknown>;targetAedId?:string;expectedRevision?:number},id?:string){
  if(actor.role!=="PROVIDER"||!actor.organizationId)fail(403,"Szkice AED może zapisywać konto organizacji.");
  const organizationId=actor.organizationId;
  await ownOrganization(actor,organizationId);
  const payload=aedDraftPayload.parse(input.payload);
  return db.transaction(async tx=>{
    if(id){
      const [draft]=await tx.select().from(mcodAedDrafts).where(eq(mcodAedDrafts.id,id)).for("update");
      if(!draft||draft.organizationId!==actor.organizationId)fail(404,"Nie znaleziono szkicu.");
      if(draft.status!=="DRAFT"||draft.revision!==input.expectedRevision)fail(409,"Szkic został zmieniony lub wysłany.");
      if(input.targetAedId&&input.targetAedId!==draft.targetAedId)fail(400,"Nie można zmienić rekordu docelowego.");
      const [updated]=await tx.update(mcodAedDrafts).set({payload,revision:draft.revision+1,updatedAt:sql`clock_timestamp()`})
        .where(eq(mcodAedDrafts.id,id)).returning();
      await event(tx,actor,actor.organizationId,id,"AED_DRAFT_UPDATED",{revision:updated!.revision});
      return json(updated!);
    }
    let targetRevision:string|null=null;
    if(input.targetAedId){
      const [target]=await tx.select({record:aeds,revision:sql<string>`${aeds.updatedAt}::text`}).from(aeds).where(and(
        eq(aeds.id,input.targetAedId),eq(aeds.organizationId,organizationId),eq(aeds.imported,false),
        eq(aeds.isDemo,false),isNull(aeds.mergedIntoId)));
      if(!target)fail(404,"Nie znaleziono własnego rekordu AED.");
      targetRevision=target.revision;
    }
    const [draft]=await tx.insert(mcodAedDrafts).values({organizationId,createdBy:actor.id,payload,
      targetAedId:input.targetAedId??null,targetRevision}).returning();
    await event(tx,actor,actor.organizationId,draft!.id,"AED_DRAFT_SAVED",{targetAedId:input.targetAedId??null});
    return json(draft!);
  });
}
export async function submitAedDraft(actor:Actor,id:string,input:{expectedRevision:number;publicationConsent:boolean}){
  if(actor.role!=="PROVIDER"||!actor.organizationId)fail(403,"Tylko organizacja może przekazać swój szkic.");
  await ownOrganization(actor,actor.organizationId);
  return db.transaction(async tx=>{
    const [draft]=await tx.select().from(mcodAedDrafts).where(eq(mcodAedDrafts.id,id)).for("update");
    if(!draft||draft.organizationId!==actor.organizationId)fail(404,"Nie znaleziono szkicu.");
    if(draft.status!=="DRAFT"){
      if(draft.proposalId)return json(draft);
      fail(409,"Szkic został już wysłany.");
    }
    if(draft.revision!==input.expectedRevision)fail(409,"Szkic został zmieniony. Odśwież formularz.");
    const prepared=await prepareProposal({...draft.payload,sourceName:"",submissionMethod:"MANUAL",publicationConsent:input.publicationConsent},actor);
    const proposal=await storeProposal(tx,prepared,actor.id);
    await tx.update(aedProposals).set({targetAedId:draft.targetAedId,originalData:{...prepared.originalData,draftFields:draft.payload},
      evidence:{...prepared.evidence,...(draft.targetAedId?{targetRevision:draft.targetRevision}:{}),draftFields:draft.payload}})
      .where(eq(aedProposals.id,proposal.id));
    const [updated]=await tx.update(mcodAedDrafts).set({status:"PENDING_APPROVAL",proposalId:proposal.id,revision:draft.revision+1,updatedAt:sql`clock_timestamp()`})
      .where(eq(mcodAedDrafts.id,id)).returning();
    await event(tx,actor,draft.organizationId,id,"AED_DRAFT_SUBMITTED",{proposalId:proposal.id,targetAedId:draft.targetAedId});
    return json(updated!);
  });
}
export async function prepareDataset(actor:Actor,input:{institutionRequestId:string;title:string;description?:string}){
  if(input.title.trim().length<2)fail(400,"Podaj nazwę projektu zbioru.");
  const [request]=await db.select().from(mcodInstitutionRequests).where(eq(mcodInstitutionRequests.id,input.institutionRequestId));
  if(!request)fail(404,"Nie znaleziono wniosku instytucji.");
  await ownOrganization(actor,request.organizationId);
  if(!["APPROVED","REGISTERED"].includes(request.status))fail(409,"Administrator musi zatwierdzić reprezentanta instytucji.");
  return db.transaction(async tx=>{
    await tx.select().from(mcodInstitutionRequests).where(eq(mcodInstitutionRequests.id,request.id)).for("update");
    const [existing]=await tx.select().from(mcodDatasets).where(and(eq(mcodDatasets.institutionRequestId,request.id),
      sql`lower(${mcodDatasets.title}) = lower(${input.title.trim()})`));
    if(existing){
      if(existing.description!==(input.description??""))fail(409,"Projekt o tej nazwie już istnieje. Nie tworzono drugiego zbioru.");
      return json(existing);
    }
    const [row]=await tx.insert(mcodDatasets).values({organizationId:request.organizationId,institutionRequestId:request.id,
      institutionId:request.institutionId,title:input.title.trim(),description:input.description??""}).returning();
    await event(tx,actor,request.organizationId,row!.id,"DATASET_DRAFT_PREPARED");
    return json(row!);
  });
}
