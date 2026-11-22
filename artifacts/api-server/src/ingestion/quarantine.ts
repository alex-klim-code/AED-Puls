import { and,eq,inArray,sql } from "drizzle-orm";
import { db,aeds,auditLogs } from "@workspace/db";
type Transaction=Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function quarantineSourcePoints(tx:Transaction,ids:string[],sourceId:string,userId:string|null){
  if(!ids.length)return;
  const held=await tx.update(aeds).set({publicImport:false}).where(and(
    inArray(aeds.id,ids),eq(aeds.imported,true),eq(aeds.publicImport,true),inArray(aeds.verificationStatus,["unverified","NOT_VERIFIED"]),
    eq(aeds.recordVerificationStatus,"UNVERIFIED"),
    sql`coalesce(${aeds.locationEvidence}->>'method','')<>'administrator_edit'`,
    sql`coalesce(${aeds.locationEvidence}->>'geocodingStatus','')<>'RESOLVED'`,
    sql`not exists(select 1 from source_observations o join aed_records f on f.id=o.aed_id
      where coalesce(f.merged_into_id,f.id)=${aeds.id} and o.source_id<>${sourceId}
        and o.removed_at is null and o.normalized_record is not null)`
  )).returning({id:aeds.id});
  if(held.length)await tx.insert(auditLogs).values(held.map(r=>({userId,entityId:r.id,
    action:"Wstrzymano publikację importu: lokalizacja wymaga oceny",details:{sourceId,preservedOriginals:true,administratorReviewRequired:true}})));
}
