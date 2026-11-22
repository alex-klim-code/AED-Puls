import { randomUUID } from "node:crypto";
import { and,eq,isNull,isNotNull } from "drizzle-orm";
import { db,aeds,sources,observations,observationVersions,auditLogs } from "@workspace/db";
import { digest,normalizeRow,type ImportRow } from "./normalize";
import { refreshAggregation } from "./linkage";
import { requiresLocationReview } from "./sync-diagnostics";
import { recoverImportedAddresses } from "./recover-addresses";

/** Reprocess saved source originals, not the network. Source/observation locks make retries idempotent. */
export async function recoverIncompleteRecords(){
  const groups=await db.selectDistinct({sourceId:observations.sourceId}).from(observations)
    .where(and(isNull(observations.aedId),isNotNull(observations.sourceId),isNull(observations.removedAt)));
  const report={created:0,preservedUnprocessable:0,busySources:0,addressesRecovered:0};
  for(const group of groups){
    const result=await db.transaction(async tx=>{
      const[source]=await tx.select().from(sources).where(eq(sources.id,group.sourceId!)).for("update");
      if(!source||(source.lockedUntil&&source.lockedUntil>new Date()))return{created:0,preservedUnprocessable:0,busySources:1};
      const rows=await tx.select().from(observations).where(and(eq(observations.sourceId,source.id),
        isNull(observations.aedId),isNull(observations.removedAt))).for("update");
      const counts={created:0,preservedUnprocessable:0,busySources:0};
      for(const observation of rows){
        let packet:Record<string,any>;
        try{
          const stored=observation.originalRecord as Record<string,unknown>;
          if(!stored||typeof stored!=="object"||Array.isArray(stored)){counts.preservedUnprocessable++;continue;}
          packet=stored.encoding==="json-string"?JSON.parse(String(stored.payload)):stored;
          if(!packet.record||!packet.context||typeof packet.context.url!=="string"||typeof packet.context.license!=="string"){
            counts.preservedUnprocessable++;continue;
          }
        }catch{counts.preservedUnprocessable++;continue;}
        const row=normalizeRow({original:packet.record,context:packet.context} as ImportRow);
        if(!row.data){counts.preservedUnprocessable++;continue;}
        const id=randomUUID();
        await tx.insert(aeds).values({...row.data,id,imported:true,isDemo:false,verificationStatus:"NOT_VERIFIED",
          publicImport:!row.issues.some(i=>i.severity==="error"),locationEvidence:{
            method:"source_recovery",recoveredFromOriginal:true,issues:row.issues,requiresLocationReview:requiresLocationReview(row.issues),
            autoGeocodeEligible:row.issues.some(i=>i.rule==="missing_coordinates")&&!row.issues.some(i=>["outside_poland","border_review","inconsistent_coordinate_axes"].includes(i.rule)),
          }});
        await tx.insert(observationVersions).values({observationId:observation.id,contentHash:observation.contentHash??digest(observation.originalRecord),
          document:{originalRecord:observation.originalRecord,normalizedRecord:observation.normalizedRecord,aedId:observation.aedId}}).onConflictDoNothing();
        await tx.update(observations).set({aedId:id,normalizedRecord:JSON.parse(JSON.stringify(row.data))}).where(eq(observations.id,observation.id));
        await tx.insert(auditLogs).values({entityId:id,action:"Odzyskano niekompletny rekord z zachowanego oryginału",
          details:{sourceId:source.id,observationId:observation.id,originalPreserved:true,coordinatesInvented:false,issues:row.issues}});
        counts.created++;
      }
      return counts;
    });
    report.created+=result.created;report.preservedUnprocessable+=result.preservedUnprocessable;report.busySources+=result.busySources;
  }
  report.addressesRecovered=await recoverImportedAddresses();
  if(report.created||report.addressesRecovered)await refreshAggregation();
  return report;
}
