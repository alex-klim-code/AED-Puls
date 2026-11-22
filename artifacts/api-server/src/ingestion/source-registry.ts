import { and,eq,inArray,isNull,or,sql } from "drizzle-orm";
import { db,sources,observations,aeds } from "@workspace/db";
import { SOURCE_DEFINITIONS,REVIEWED_SOURCES,type ConnectorBatch } from "./connectors";
import { openAedConfiguration } from "./optional-connectors";
import { resourceFingerprint } from "./resource-identity";

export async function ensureSources(){
  for(const definition of SOURCE_DEFINITIONS){
    await db.insert(sources).values({...definition,updateFrequency:"Co 24 godziny",
      status:definition.key==="openaed-eu"?"requires_configuration":definition.key==="warszawa"?"unavailable":"ready",
      statusMessage:definition.key==="openaed-eu"?openAedConfiguration().message:"Oczekuje na synchronizację; stan połączenia nie został jeszcze potwierdzony.",
    }).onConflictDoNothing({target:sources.key});
  }
  for(const definition of REVIEWED_SOURCES)await db.insert(sources).values({
    ...definition,updateFrequency:"Warstwa pomocnicza WMS — bez importu punktów",
  }).onConflictDoNothing({target:sources.key});
}
export async function sourceFamilyIds(source:typeof sources.$inferSelect){
  const rows=await db.select({id:sources.id}).from(sources).where(or(eq(sources.id,source.id),
    sql`${sources.provenanceEvidence}->>'parentSourceId'=${source.id}`));
  return rows.map(r=>r.id);
}
export async function registerDatasetSource(packet:ConnectorBatch,parent:typeof sources.$inferSelect){
  const c=packet.context;
  const evidence={...c.provenanceEvidence,parentSourceKey:"dane-gov",parentSourceId:parent.id,datasetTitle:c.datasetTitle,originalPublisher:c.publisher};
  const values={name:`${c.publisher} — ${c.datasetTitle}`.slice(0,220),url:c.datasetUrl,datasetUrl:c.datasetUrl,
    institution:c.publisher,license:c.license,coverage:c.coverage,datasetId:c.datasetId,sourceType:"catalogue_dataset",
    publisherId:c.publisherId??null,updateFrequency:"Co 24 godziny przez katalog dane.gov.pl",
    authoritativeScope:"Publikacja oryginalnego wydawcy odnaleziona przez dane.gov.pl"};
  const [owner]=await db.insert(sources).values({...values,key:`dane-gov:${c.datasetId}`,status:"running",statusMessage:"Synchronizacja przez katalog dane.gov.pl.",provenanceEvidence:evidence})
    .onConflictDoUpdate({target:sources.key,set:{...values,status:"running",
      provenanceEvidence:sql`${sources.provenanceEvidence} || ${JSON.stringify(evidence)}::jsonb`}}).returning();
  return owner!;
}
export async function attachCopyEvidence(packet:ConnectorBatch,sourceId:string){
  const fingerprint=packet.context.provenanceEvidence?.resourceFingerprint;
  if(typeof fingerprint!=="string")return;
  const [copy]=await db.select({id:sources.id,name:sources.name}).from(observations)
    .innerJoin(sources,eq(sources.id,observations.sourceId)).where(and(
      sql`${observations.provenanceEvidence}->>'resourceFingerprint'=${fingerprint}`,
      sql`${observations.sourceId}<>${sourceId}`,isNull(observations.removedAt))).limit(1);
  if(copy)packet.context.provenanceEvidence={...packet.context.provenanceEvidence,copyOfSourceId:copy.id,copyOfSourceName:copy.name};
}
export async function copiedAedIds(packet:ConnectorBatch){
  const sourceId=packet.context.provenanceEvidence?.copyOfSourceId,result=new Map<string,string>();
  if(typeof sourceId!=="string")return result;
  const rows=await db.select({document:observations.originalRecord,aedId:aeds.id,mergedIntoId:aeds.mergedIntoId})
    .from(observations).innerJoin(aeds,eq(aeds.id,observations.aedId))
    .where(and(eq(observations.sourceId,sourceId),isNull(observations.removedAt)));
  for(const r of rows){
    try{
      const raw=r.document as Record<string,unknown>;
      const doc=raw.encoding==="json-string"?JSON.parse(String(raw.payload)):raw;
      if(doc.record)result.set(resourceFingerprint([doc.record]),r.mergedIntoId??r.aedId);
    }catch{/* An unreadable historical document is not sufficient identity evidence. */}
  }
  return result;
}
export function scheduledSource(source:typeof sources.$inferSelect){
  if(!SOURCE_DEFINITIONS.some(s=>s.key===source.key))return false;
  if(source.key==="openaed-eu")return openAedConfiguration().ready;
  return source.key!=="warszawa"||source.status==="ready"||!!source.lastSuccessAt;
}
