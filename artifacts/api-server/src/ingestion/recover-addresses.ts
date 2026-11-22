import { and,eq,isNull,like,sql } from "drizzle-orm";
import { db,aeds,sources,observations,observationVersions,auditLogs } from "@workspace/db";
import { normalizeRow,type ImportRow } from "./normalize";

/** Repair an empty parsed address from one unambiguous, preserved source original. */
export async function recoverImportedAddresses(){
  return db.transaction(async tx=>{
    const rows=await tx.select({record:aeds,observation:observations}).from(aeds)
      .innerJoin(observations,eq(observations.aedId,aeds.id))
      .innerJoin(sources,eq(observations.sourceId,sources.id))
      .where(and(eq(aeds.address,""),eq(aeds.imported,true),eq(aeds.isDemo,false),isNull(aeds.mergedIntoId),
        eq(aeds.recordVerificationStatus,"UNVERIFIED"),eq(aeds.verificationStatus,"NOT_VERIFIED"),
        eq(aeds.sourceConflict,false),isNull(observations.removedAt),like(sources.key,"dane-gov:%"),
        sql`${aeds.locationEvidence}->>'method' in ('source_import','source_recovery')`,
        sql`not exists(select 1 from source_observations other where other.aed_id=${aeds.id}
          and other.id<>${observations.id} and other.removed_at is null)`)).for("update",{of:aeds});
    let changed=0;
    for(const {record,observation} of rows){
      let packet:ImportRow;
      try{
        const stored=observation.originalRecord as Record<string,any>;
        const original=stored.encoding==="json-string"?JSON.parse(String(stored.payload)):stored;
        packet={original:original.record,context:original.context};
        if(!packet.original||!packet.context)continue;
      }catch{continue;}
      const normalized=normalizeRow(packet).data;
      if(!normalized?.address)continue;
      if(observation.contentHash)await tx.insert(observationVersions).values({observationId:observation.id,
        contentHash:observation.contentHash,document:{originalRecord:observation.originalRecord,normalizedRecord:observation.normalizedRecord}
      }).onConflictDoNothing();
      await tx.update(observations).set({normalizedRecord:JSON.parse(JSON.stringify({
        ...observation.normalizedRecord,...normalized,
      }))}).where(eq(observations.id,observation.id));
      const [after]=await tx.update(aeds).set({address:normalized.address,updatedAt:sql`clock_timestamp()`})
        .where(and(eq(aeds.id,record.id),eq(aeds.address,""))).returning({id:aeds.id});
      if(!after)continue;
      await tx.insert(auditLogs).values({entityId:record.id,action:"Uzupełniono adres z zachowanego oryginału źródłowego",
        details:{observationId:observation.id,before:{address:record.address},after:{address:normalized.address},
          parserCorrection:true,originalPreserved:true,coordinatesUnchanged:true,verificationStatusPreserved:true}});
      changed++;
    }
    return changed;
  });
}
