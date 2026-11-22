import { and,eq,sql,isNull } from "drizzle-orm";
import { db,aeds,aedProposals,proposalEvents,observations,submissions,auditLogs,organizations,duplicateCandidates,validationIssues,users,type AedProposalRow } from "@workspace/db";
import { SubmitAedBody } from "@workspace/api-zod";
import { fail } from "./auth";
import { readLocationReceipt } from "./submission-location";
import { located } from "./record-state";
import { assessQuality } from "./quality";
import { attachPhoto } from "./submission-photos";
import { submissionStatus } from "./submission-access";

export type Actor=typeof users.$inferSelect;
export type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
export const normalizeProposalLicense=(value:string)=>{
  const s=value.trim().toLowerCase().replace(/[ _]/g,"-");
  return ({"cc0":"CC0-1.0","cc0-1.0":"CC0-1.0","cc-by-4.0":"CC-BY-4.0","odbl":"ODbL-1.0","odbl-1.0":"ODbL-1.0"} as Record<string,string>)[s]??"UNKNOWN";
};
export async function proposalSource(user:Actor){
  if(user.role==="PROVIDER"&&!user.organizationId)fail(403,"Konto nie jest przypisane do organizacji.");
  if(user.organizationId){
    const [org]=await db.select().from(organizations).where(eq(organizations.id,user.organizationId));
    if(!org||org.isDemo)fail(403,"Organizacja jest niedostępna.");
    return org.name;
  }
  return "Użytkownik AED Puls";
}
export async function prepareProposal(body:unknown,user:Actor,file?:{filename:string;row:number;original:Record<string,unknown>;warnings:string[]},previous?:AedProposalRow){
  if(!["USER","PROVIDER"].includes(user.role))fail(403,"Administrator moderuje zgłoszenia i nie może tworzyć ani uzupełniać zgłoszeń jako zgłaszający.");
  const parsed=SubmitAedBody.parse(body);
  const {locationToken,publicationConsent,photoId,...input}=parsed;
  const method=file?"FILE":parsed.submissionMethod??"MANUAL";
  if(!file&&method==="FILE")fail(400,"Do pliku użyj formularza importu.");
  if(user.role==="USER"&&method!=="GPS")fail(403,"Użytkownik może dodawać AED wyłącznie przez przesłanie GPS.");
  const unchanged=!!previous&&previous.submissionMethod==="GPS"&&(["latitude","longitude","address","city","postalCode","voivodeship"] as const)
    .every(key=>(input[key]??"")===(previous.payload[key]??""));
  const gps=method==="GPS"&&!unchanged?readLocationReceipt(locationToken,user.id):null;
  if(gps&&(["latitude","longitude","address","city","postalCode","voivodeship"] as const).some(key=>
    input[key]!==undefined&&input[key]!==gps[key]))fail(400,"Nie zmieniaj danych pobranych z GPS. Wyślij lokalizację ponownie.");
  if(user.role==="USER"&&!publicationConsent)fail(400,"Potwierdź udostępnienie własnego zgłoszenia na CC BY 4.0.");
  const sourceName=await proposalSource(user);
  const payload={...input,submissionMethod:method,sourceName,
    license:user.role==="USER"?"CC-BY-4.0":normalizeProposalLicense(input.license),
    sourceUrl:user.role==="USER"?"":input.sourceUrl.trim(),
    ...(gps?{latitude:gps.latitude,longitude:gps.longitude,address:gps.address,city:gps.city,postalCode:gps.postalCode,voivodeship:gps.voivodeship}:{})};
  for(const key of ["name","address","city","description","postalCode","voivodeship","openingHours"] as const)
    if(typeof payload[key]==="string")(payload as Record<string,unknown>)[key]=(payload[key] as string).trim();
  if(!file&&method==="MANUAL"&&!payload.name&&!payload.address&&!payload.city&&!payload.description&&payload.latitude===null&&payload.longitude===null)
    fail(400,"Uzupełnij przynajmniej nazwę, opis lub lokalizację rzeczywistego AED.");
  if(payload.sourceUrl&&!/^https?:\/\/[^\s]+$/i.test(payload.sourceUrl))fail(400,"Adres źródła musi zaczynać się od https:// lub http://.");
  const issues=[...assessQuality(payload).qualityIssues,...(file?.warnings??[])];
  if(!located(payload))issues.push("Brak poprawnej lokalizacji w Polsce — administrator musi ją uzupełnić lub sprawdzić.");
  if(!payload.name||!payload.address||!payload.city)issues.push("Niepełna nazwa, miejscowość lub adres.");
  if(!publicationConsent)issues.push("Brak potwierdzenia prawa do udostępnienia danych; wymagana ocena administratora.");
  const locationEvidence=unchanged?previous!.evidence.locationEvidence:gps?{method:"browser_geolocation",accuracy:gps.accuracy,capturedAt:new Date(gps.capturedAt).toISOString(),
    addressStatus:gps.addressStatus,notDeviceVerification:true,
    ...((gps.address||gps.city||gps.postalCode||gps.voivodeship)?{geocodingDependency:{provider:"Geoapify",rightsStatus:"NOT_REVIEWED",
      attribution:"Powered by Geoapify; © OpenStreetMap contributors",termsUrl:"https://www.geoapify.com/terms-and-conditions/"}}:{})}:{method:method==="FILE"?"organization_file":"manual_submission",notDeviceVerification:true};
  return {submittedBy:user.id,organizationId:user.organizationId,sourceName,submitterRole:user.role,submissionMethod:method,photoId:photoId??null,
    payload:payload as Record<string,unknown>,originalData:file?.original??input,
    issues:[...new Set(issues)],evidence:{locationEvidence,publicationConsent:{accepted:!!publicationConsent,
      license:payload.license,acceptedAt:publicationConsent?new Date().toISOString():null},
      ...(file?{file:{filename:file.filename,row:file.row}}:{})}};
}
export async function storeProposal(tx:Tx,prepared:Awaited<ReturnType<typeof prepareProposal>>,actorId:string){
  const [row]=await tx.insert(aedProposals).values({...prepared,status:"NEW",
    originalData:sql`${JSON.stringify(prepared.originalData)}::jsonb`}).returning();
  if(prepared.photoId){
    const [actor]=await tx.select().from(users).where(eq(users.id,actorId));
    await attachPhoto(tx,prepared.photoId,actor!,"AED",row!.id);
  }
  await tx.insert(proposalEvents).values({proposalId:row!.id,actorId,action:"SUBMITTED",changes:{payload:prepared.payload,issues:prepared.issues}});
  await tx.insert(auditLogs).values({userId:actorId,entityId:row!.id,action:"Przekazano zgłoszenie AED do administratora",details:{method:prepared.submissionMethod}});
  return row!;
}
export function canReadProposal(row:AedProposalRow,user:Actor){
  return user.role==="ADMIN"||row.submittedBy===user.id||(user.role==="PROVIDER"&&!!user.organizationId&&row.organizationId===user.organizationId);
}
export function proposalAccess(user:Actor){
  return user.role==="ADMIN"?undefined:user.role==="PROVIDER"&&user.organizationId?eq(aedProposals.organizationId,user.organizationId):eq(aedProposals.submittedBy,user.id);
}
export function proposalDto(row:AedProposalRow,history?:unknown[]){
  const consent=row.evidence.publicationConsent as {accepted?:boolean;license?:string}|undefined;
  return {...row,status:submissionStatus(row.status),payload:{...row.payload,publicationConsent:!!consent?.accepted&&consent.license===row.payload.license&&consent.license!=="UNKNOWN"},
    createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),
    ...(history?{history}:{}),originalData:undefined,evidence:undefined};
}
export async function publishProposal(tx:Tx,row:AedProposalRow,payload:ReturnType<typeof SubmitAedBody.parse>,reviewer:Actor){
  if(!located(payload))fail(400,"Przed zatwierdzeniem uzupełnij poprawne współrzędne w Polsce.");
  if(payload.name.trim().length<3||payload.address.trim().length<3||payload.city.trim().length<2)fail(400,"Przed zatwierdzeniem uzupełnij nazwę, adres i miejscowość.");
  const license=normalizeProposalLicense(payload.license);
  if(license==="UNKNOWN")fail(400,"Wybierz ustaloną licencję otwartą przed zatwierdzeniem.");
  const consent=row.evidence.publicationConsent as {accepted?:boolean;license?:string}|undefined;
  if(row.submitterRole==="USER"&&license!=="CC-BY-4.0")fail(400,"Zgłoszenie użytkownika ma stałą licencję CC BY 4.0.");
  // Admin corrections cannot silently relicense a submitter's contribution.
  if(consent?.accepted&&consent.license!=="UNKNOWN"&&normalizeProposalLicense(consent.license??"")!==license)
    fail(400,"Zgłaszający nie udzielił tej licencji. Nie zmieniaj znanej licencji bez nowej zgody.");
  const {locationToken,publicationConsent,submissionMethod,photoId,...data}=payload;
  const values:typeof aeds.$inferInsert={...data,license,sourceName:row.sourceName,
    sourceUrl:row.submitterRole==="USER"?"":data.sourceUrl,sourceCategory:row.organizationId?"ORGANIZATION_SUBMISSION":"USER_SUBMISSION",
    submittedBy:row.submittedBy,organizationId:row.organizationId,responsibleOrganization:row.organizationId?row.sourceName:null,
    locationEvidence:(row.evidence.locationEvidence as Record<string,unknown>)??{},
    ...assessQuality({...data,license}),verificationStatus:"VERIFIED",lastVerifiedAt:new Date(),
    recordVerificationStatus:"UNVERIFIED",deviceOperationalStatus:"UNKNOWN",operationalStatus:"unknown",
    imported:false,publicImport:false,isDemo:false,publicationCount:1,independentSourceCount:1};
  let record:typeof aeds.$inferSelect|undefined;
  if(row.targetAedId){
    const [target]=await tx.select().from(aeds).where(eq(aeds.id,row.targetAedId)).for("update");
    if(!target||target.imported||target.isDemo||target.mergedIntoId||!row.organizationId||target.organizationId!==row.organizationId)
      fail(409,"Korekta nie dotyczy własnego, nieimportowanego AED organizacji.");
    const revision=row.evidence.targetRevision;
    if(typeof revision!=="string")fail(409,"Brak wersji rekordu bazowego korekty.");
    if(target.license!==license)fail(409,"Korekta nie może zmieniać ustalonej licencji istniejących danych.");
    const external=await tx.select({id:observations.id}).from(observations).where(and(eq(observations.aedId,target.id),
      isNull(observations.removedAt),sql`${observations.sourceId} IS NOT NULL`)).limit(1);
    if(external.length)fail(409,"Rekord ma również pochodzenie importowane; wymaga odrębnej oceny pochodzenia pól.");
    [record]=await tx.update(aeds).set({...values,submittedBy:target.submittedBy,updatedAt:sql`clock_timestamp()`,
      locationEvidence:{...target.locationEvidence,...values.locationEvidence}})
      .where(and(eq(aeds.id,target.id),sql`${aeds.updatedAt} = ${revision}::timestamptz`)).returning();
    if(!record)fail(409,"AED zmieniono po utworzeniu szkicu. Przygotuj korektę na aktualnych danych.");
    await tx.update(observations).set({removedAt:sql`clock_timestamp()`}).where(and(eq(observations.aedId,target.id),
      isNull(observations.removedAt),isNull(observations.sourceId),eq(observations.officialProvenance,"ORGANIZATION_SUBMISSION")));
  }else [record]=await tx.insert(aeds).values(values).returning();
  await tx.insert(observations).values({aedId:record!.id,sourceRecordId:row.id,originalRecord:row.originalData,publisher:row.sourceName,
    officialProvenance:row.organizationId?"ORGANIZATION_SUBMISSION":"USER_SUBMISSION",
    sourceUrl:record!.sourceUrl,license,normalizedRecord:{...record!,createdAt:undefined,updatedAt:undefined},
    provenanceEvidence:{method:"administrator_approved_submission",proposalId:row.id,reviewerId:reviewer.id,
      submitterRole:row.submitterRole,publicationConsent:row.evidence.publicationConsent}});
  await tx.insert(submissions).values({aedId:record!.id,userId:row.submittedBy,status:"verified"});
  const quality=assessQuality(payload);
  if(quality.qualityIssues.length)await tx.insert(validationIssues).values(quality.qualityIssues.map(message=>({aedId:record!.id,rule:"completeness",message})));
  const neighbors=await tx.select({id:aeds.id}).from(aeds).where(and(eq(aeds.isDemo,false),
    sql`${aeds.id}<>${record!.id}`,sql`abs(${aeds.latitude}-${record!.latitude})<0.002`,
    sql`abs(${aeds.longitude}-${record!.longitude})<0.003`)).limit(20);
  if(neighbors.length)await tx.insert(duplicateCandidates).values(neighbors.map(n=>({firstId:n.id,secondId:record!.id,
    reason:"Zbliżone współrzędne nowego zatwierdzonego zgłoszenia — wymagane ręczne porównanie; nie scalaj automatycznie."})));
  await tx.insert(auditLogs).values({userId:reviewer.id,entityId:record!.id,action:"Zatwierdzono i utworzono rekord AED",details:{proposalId:row.id,notDeviceVerification:true}});
  return record!.id;
}
