import { and,eq,inArray,isNull,desc,sql } from "drizzle-orm";
import { db,aeds,aedProposals,observations,mcodDatasets,mcodResources,mcodPublicationPlans } from "@workspace/db";
import { fail } from "./auth";
import type { Actor,Tx } from "./proposal-service";
import { ownOrganization,event,json } from "./mcod-local";
import { assessPublication,planKey,renderPublication,type SnapshotRow } from "../integrations/mcod/publication-format";

type Reader=Pick<Tx,"select">;
export async function publicationSnapshot(organizationId:string,reader:Reader=db){
  const approved=await reader.select({record:aeds,sourceRevision:sql<string>`${aeds.updatedAt}::text`,proposal:aedProposals}).from(aeds)
    .innerJoin(aedProposals,and(eq(aedProposals.aedId,aeds.id),eq(aedProposals.status,"DONE"),eq(aedProposals.organizationId,organizationId)))
    .where(and(eq(aeds.organizationId,organizationId),eq(aeds.imported,false),eq(aeds.isDemo,false),isNull(aeds.mergedIntoId),eq(aeds.verificationStatus,"VERIFIED")))
    .orderBy(aeds.id,desc(aedProposals.updatedAt),desc(aedProposals.id));
  const byId=new Map<string,typeof approved[number]>();
  for(const row of approved)if(!byId.has(row.record.id))byId.set(row.record.id,row);
  const unique=[...byId.values()];
  const active=unique.length?await reader.select().from(observations).where(and(inArray(observations.aedId,unique.map(x=>x.record.id)),isNull(observations.removedAt))):[];
  const evidence=new Map<string,{consent:boolean;externalProvenance:boolean;geocodingUnreviewed:boolean}>();
  const snapshot:SnapshotRow[]=unique.map(({record,sourceRevision,proposal})=>{
    const consent=proposal.evidence.publicationConsent as {accepted?:boolean;license?:string}|undefined;
    const dependency=record.locationEvidence.geocodingDependency as {rightsStatus?:string}|undefined;
    evidence.set(record.id,{consent:!!consent?.accepted&&consent.license===record.license,
      externalProvenance:record.sourceConflict||active.some(o=>o.aedId===record.id&&(!!o.sourceId||o.officialProvenance!=="ORGANIZATION_SUBMISSION")),
      geocodingUnreviewed:!!dependency&&dependency.rightsStatus!=="REVIEWED_ALLOWED"});
    const extra=(proposal.evidence.draftFields??{}) as Record<string,unknown>;
    return {id:record.id,approvedProposalId:proposal.id,name:record.name,address:record.address,city:record.city,postalCode:record.postalCode,
      voivodeship:record.voivodeship,latitude:record.latitude,longitude:record.longitude,description:record.description,
      placement:record.placement,accessibility:record.accessibility,openingHours:record.openingHours,
      publicAccess:typeof extra.publicAccess==="boolean"?extra.publicAccess:null,
      deviceOperationalStatus:record.deviceOperationalStatus,lastVerifiedAt:record.verifiedAt?.toISOString()??null,
      sourceOperationalClaim:extra.deviceStatus??"UNKNOWN",declaredCheckDate:extra.lastVerifiedAt??null,
      responsibleOrganization:record.responsibleOrganization,notes:extra.notes??"",completenessStatus:record.completenessStatus,
      sourceName:record.sourceName,sourceUrl:record.sourceUrl,license:record.license,deviceIdentifier:record.deviceIdentifier,
      requiredAttribution:`${record.sourceName}; ${record.sourceUrl||"zgłoszenie organizacji w AED Puls"}; ${record.license}; normalizacja w AED Puls.`,
      sourceRevision};
  });
  return {snapshot,validation:assessPublication(snapshot,evidence)};
}
export async function preparePublication(actor:Actor,input:{datasetId:string;format:"csv"|"geojson"}){
  const [dataset]=await db.select().from(mcodDatasets).where(eq(mcodDatasets.id,input.datasetId));
  if(!dataset)fail(404,"Nie znaleziono projektu zbioru.");
  await ownOrganization(actor,dataset.organizationId);
  return db.transaction(async tx=>{
    await tx.select().from(mcodDatasets).where(eq(mcodDatasets.id,dataset.id)).for("update");
    const {snapshot,validation}=await publicationSnapshot(dataset.organizationId,tx);
    const [resource]=await tx.insert(mcodResources).values({datasetId:dataset.id,format:input.format})
      .onConflictDoUpdate({target:[mcodResources.datasetId,mcodResources.format],set:{format:input.format}}).returning();
    const idempotencyKey=planKey(dataset.id,input.format,snapshot,validation);
    const [inserted]=await tx.insert(mcodPublicationPlans).values({datasetId:dataset.id,resourceId:resource!.id,
      organizationId:dataset.organizationId,createdBy:actor.id,idempotencyKey,snapshot,validation:json(validation),
      status:validation.issues.length?"VALIDATION_FAILED":"PREPARED"}).onConflictDoNothing().returning();
    const [existing]=inserted?[]:await tx.select().from(mcodPublicationPlans).where(and(
      eq(mcodPublicationPlans.organizationId,dataset.organizationId),eq(mcodPublicationPlans.idempotencyKey,idempotencyKey)));
    const plan=inserted??existing!;
    if(inserted)await event(tx,actor,dataset.organizationId,plan.id,"PUBLICATION_PREPARED",{records:snapshot.length,format:input.format,blocked:validation.issues.length});
    const {snapshot:_,...metadata}=plan;
    return json({...metadata,recordCount:snapshot.length,recordIds:snapshot.map(r=>r.id),format:input.format});
  });
}
export async function publicationFile(actor:Actor,id:string){
  const [row]=await db.select({plan:mcodPublicationPlans,resource:mcodResources}).from(mcodPublicationPlans)
    .innerJoin(mcodResources,eq(mcodResources.id,mcodPublicationPlans.resourceId)).where(eq(mcodPublicationPlans.id,id));
  if(!row)fail(404,"Nie znaleziono planu.");
  await ownOrganization(actor,row.plan.organizationId);
  if(row.plan.status==="VALIDATION_FAILED")fail(409,"Najpierw wyjaśnij błędy praw i walidacji w planie publikacji.");
  if(!["csv","geojson"].includes(row.resource.format))fail(409,"Nieobsługiwany format.");
  return {content:renderPublication(row.plan.snapshot,row.resource.format as "csv"|"geojson"),format:row.resource.format};
}
