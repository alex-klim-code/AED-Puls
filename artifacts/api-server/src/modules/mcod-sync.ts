import { and,eq,isNull,or,sql,between } from "drizzle-orm";
import { db,aeds,sources,observations,observationVersions,mcodResources,mcodDatasets,mcodSyncRuns } from "@workspace/db";
import { parseResource } from "../ingestion/parsers";
import { normalizeRow,preserveOriginal,stableDigest,canonicalLicense,clean } from "../ingestion/normalize";
import { matchRecords } from "../ingestion/matching";
import type { Actor } from "./proposal-service";
import { mcodClient,event,json } from "./mcod-local";
import { fail } from "./auth";

/** Explicit manual action only. No timer/startup hook invokes this workflow. */
export async function syncMcod(actor:Actor,client=mcodClient){
  if(actor.role!=="ADMIN")fail(403,"Tylko administrator uruchamia import MCOD.");
  client.assertEnabled("sync");
  client.ensureOperations(["getInstitutions","getDatasets","getResources","downloadResource"],"sync");
  const run=await db.transaction(async tx=>{
    // One local importer at a time, including different administrators.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('aed-puls-mcod-sync'))`);
    const [active]=await tx.select().from(mcodSyncRuns).where(eq(mcodSyncRuns.status,"RUNNING"));
    if(active)fail(409,"Synchronizacja MCOD już trwa lub wymaga wyjaśnienia przerwania.");
    const [created]=await tx.insert(mcodSyncRuns).values({status:"RUNNING"}).returning();
    await event(tx,actor,null,created!.id,"SYNC_STARTED");return created!;
  });
  let imported=0,updated=0,skipped=0;
  let sourceId:string|null=null;
  const errors:Record<string,unknown>[]=[];
  try{
    const [source]=await db.insert(sources).values({key:"mcod-aed",name:"MCOD — katalog AED",url:client.status().baseUrl,
      license:"PER_RECORD",coverage:"Polska",institution:"MCOD — wydawcy wskazani przy rekordach",datasetId:"",updateFrequency:"ręcznie po aktywacji",
      authoritativeScope:"Katalog nie potwierdza sprawności urządzeń.",status:"running",statusMessage:"Ręczna synchronizacja MCOD.",
      sourceType:"mcod_catalog",officialProvenance:"MCOD_PUBLIC_API",lastCheckedAt:new Date()})
      .onConflictDoUpdate({target:sources.key,set:{status:"running",statusMessage:"Ręczna synchronizacja MCOD.",lastCheckedAt:new Date()}}).returning();
    sourceId=source!.id;
    await client.syncAedFromMcod(async(resource,file)=>{
      // A resource published by this app already refers to its canonical AEDs.
      const [self]=await db.select({id:mcodResources.id}).from(mcodResources).innerJoin(mcodDatasets,eq(mcodDatasets.id,mcodResources.datasetId))
        .where(and(eq(mcodResources.resourceId,resource.id),eq(mcodDatasets.institutionId,resource.institutionId)));
      if(self){skipped++;return;}
      if(resource.publicationStatus!=="PUBLISHED"){skipped++;return;}
      if(file.format!==resource.format)throw new Error("format_mismatch");
      let rows:Record<string,unknown>[];
      try{rows=await parseResource(Buffer.from(file.content,"utf8"),file.format);}
      catch{errors.push({resourceId:resource.id,code:"UNREADABLE_RESOURCE"});return;}
      for(const original of rows){
        client.assertEnabled("sync");
        const props=(original.properties&&typeof original.properties==="object"?original.properties:original) as Record<string,unknown>;
        const rowLicense=canonicalLicense(props.license),metadataLicense=canonicalLicense(resource.license);
        const license=metadataLicense==="UNKNOWN"?rowLicense:rowLicense!=="UNKNOWN"&&rowLicense!==metadataLicense?"UNKNOWN":metadataLicense;
        const context={name:clean(resource.publisher),publisher:clean(resource.publisher),publisherId:resource.institutionId,
          license,url:resource.sourceUrl,datasetUrl:resource.sourceUrl,
          datasetId:`mcod:${resource.institutionId}:${resource.datasetId}:${resource.id}`,resourceId:resource.id,
          modified:null,coverage:"Polska",sourceCategory:"UNKNOWN" as const,
          provenanceEvidence:{method:"mcod_reviewed_contract",rightsVerified:resource.rightsVerified,rightsEvidence:resource.rightsEvidence}};
        const normalized=normalizeRow({original,context});
        const hash=stableDigest({original,context});
        try{
          await db.transaction(async tx=>{
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`mcod-observation:${source!.id}:${normalized.id}`}))`);
            const [previous]=await tx.select().from(observations).where(and(eq(observations.sourceId,source!.id),eq(observations.sourceRecordId,normalized.id))).for("update");
            if(previous?.contentHash===hash){await tx.update(observations).set({lastSyncedAt:new Date(),removedAt:null}).where(eq(observations.id,previous.id));skipped++;return;}
            const data=normalized.data;
            let aedId=previous?.aedId??null;
            if(data){
              const declaredCountry=clean(props.country).toUpperCase();
              const foreign=!!declaredCountry&&!["PL","POLAND","POLSKA"].includes(declaredCountry);
              if(foreign)data.country=declaredCountry;
              const publicImport=resource.rightsVerified&&!!resource.rightsEvidence&&data.license!=="UNKNOWN"&&!foreign&&
                !normalized.issues.some(i=>["outside_poland","border_review","inconsistent_coordinate_axes"].includes(i.rule));
              if(!aedId){
                const candidates=await tx.select().from(aeds).where(and(isNull(aeds.mergedIntoId),eq(aeds.isDemo,false),
                  or(data.deviceIdentifier?eq(aeds.deviceIdentifier,data.deviceIdentifier):sql`false`,
                    data.latitude!==null&&data.longitude!==null?and(between(aeds.latitude,data.latitude-.001,data.latitude+.001),
                      between(aeds.longitude,data.longitude-.001,data.longitude+.001)):sql`false`))).limit(50);
                const strong=candidates.filter(candidate=>matchRecords(data,candidate).autoMerge);
                if(strong.length===1)aedId=strong[0]!.id;
              }
              if(!aedId){
                const [created]=await tx.insert(aeds).values({...data,verificationStatus:"NOT_VERIFIED",recordVerificationStatus:"UNVERIFIED",
                  deviceOperationalStatus:"UNKNOWN",operationalStatus:"unknown",lastVerifiedAt:null,imported:true,publicImport,isDemo:false,
                  locationEvidence:{method:"mcod_resource",resourceId:resource.id,rightsVerified:resource.rightsVerified},
                  qualityIssues:[...data.qualityIssues,...(!publicImport?["Rekord wymaga oceny źródła, praw lub lokalizacji przed publikacją."]:[])]}).returning();
                aedId=created!.id;imported++;
              }else if(previous?.aedId){
                const [current]=await tx.select().from(aeds).where(eq(aeds.id,aedId)).for("update");
                const [links]=await tx.select({n:sql<number>`count(*)::int`}).from(observations).where(and(eq(observations.aedId,aedId),isNull(observations.removedAt)));
                const old=previous.normalizedRecord,keys=["name","address","city","latitude","longitude","license","description"] as const;
                const untouched=!!old&&keys.every(key=>JSON.stringify(current?.[key]??null)===JSON.stringify(old[key]??null));
                if(current?.imported&&current.verificationStatus==="NOT_VERIFIED"&&!current.sourceConflict&&links!.n===1&&untouched)
                  await tx.update(aeds).set({...data,lastVerifiedAt:null,deviceOperationalStatus:"UNKNOWN",operationalStatus:"unknown",
                    publicImport,updatedAt:sql`clock_timestamp()`}).where(eq(aeds.id,aedId));
                // Human-reviewed, locally edited and mixed-source fields are never overwritten.
              }
            }
            const document=preserveOriginal({record:original,context});
            const values={aedId,sourceId:source!.id,sourceRecordId:normalized.id,originalRecord:document,sourceUrl:resource.sourceUrl,
              license:data?.license??"UNKNOWN",publisher:resource.publisher,publisherId:resource.institutionId,datasetId:resource.datasetId,
              resourceId:resource.id,resourceFormat:resource.format,datasetUrl:resource.sourceUrl,contentHash:hash,
              normalizedRecord:data?json(data):{},officialProvenance:"MCOD_PUBLIC_API",provenanceEvidence:context.provenanceEvidence,
              lastSyncedAt:new Date(),removedAt:null};
            if(previous){
              await tx.insert(observationVersions).values({observationId:previous.id,contentHash:previous.contentHash??stableDigest(previous.originalRecord),
                document:json({originalRecord:previous.originalRecord,normalizedRecord:previous.normalizedRecord})}).onConflictDoNothing();
              await tx.update(observations).set(values).where(eq(observations.id,previous.id));updated++;
            }else await tx.insert(observations).values(values);
            if(!data){skipped++;errors.push({resourceId:resource.id,recordId:normalized.id,code:"UNPROCESSABLE_RECORD_PRESERVED"});}
          });
        }catch{errors.push({resourceId:resource.id,recordId:normalized.id,code:"LOCAL_RECORD_WRITE_FAILED"});}
      }
    });
    const status=errors.length?"PARTIAL":"COMPLETE";
    await db.update(sources).set({status:errors.length?"partial":"downloaded",statusMessage:errors.length?"Pobrano częściowo; sprawdź raport MCOD.":"Pobrano dane MCOD; każdy rekord ma odrębną ocenę.",
      lastCheckedAt:new Date(),...(errors.length?{}:{lastSuccessAt:new Date()})}).where(eq(sources.id,source!.id));
    const [completed]=await db.update(mcodSyncRuns).set({status,imported,updated,errors,finishedAt:new Date()}).where(eq(mcodSyncRuns.id,run.id)).returning();
    await db.transaction(tx=>event(tx,actor,null,run.id,"SYNC_FINISHED",{status,imported,updated,skipped,errors:errors.length}));
    return json({...completed!,skipped});
  }catch(error){
    errors.push({code:"MCOD_SYNC_INTERRUPTED"});
    if(sourceId)await db.update(sources).set({status:"error",statusMessage:"Przerwano synchronizację MCOD; dane i historię zachowano.",lastCheckedAt:new Date()}).where(eq(sources.id,sourceId));
    await db.update(mcodSyncRuns).set({status:"FAILED",imported,updated,errors,finishedAt:new Date()}).where(eq(mcodSyncRuns.id,run.id));
    await db.transaction(tx=>event(tx,actor,null,run.id,"SYNC_FAILED",{imported,updated}));
    throw error;
  }
}
