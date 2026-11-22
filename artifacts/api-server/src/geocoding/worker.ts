import { and,eq,inArray,isNull,sql } from "drizzle-orm";
import { db,aeds,auditLogs } from "@workspace/db";
import { lookupGeoapify } from "./geoapify";
import { logger } from "../lib/logger";
import { geocodingAddress } from "./address";
import { publicationAfterGeocoding } from "./publication";

export async function geocodePendingRecords(limit=10,recordIds?:string[]){
  if(!process.env.GEOAPIFY_API_KEY)return{processed:0,resolved:0,status:"NOT_CONFIGURED"};
  const pending=await db.select({record:aeds,revision:sql<string>`${aeds.updatedAt}::text`}).from(aeds).where(and(
    eq(aeds.isDemo,false),eq(aeds.imported,true),isNull(aeds.mergedIntoId),isNull(aeds.latitude),isNull(aeds.longitude),
    recordIds?inArray(aeds.id,recordIds):undefined,
    inArray(aeds.verificationStatus,["NOT_VERIFIED","unverified","pending"]),
    sql`(${aeds.locationEvidence}->>'autoGeocodeEligible'='true' or
      (${aeds.locationEvidence}->>'autoGeocodeEligible' is null and
       ${aeds.locationEvidence}->>'method' in ('source_import','source_recovery')))`,
    sql`length(trim(${aeds.address}))>0`,
    sql`coalesce(${aeds.locationEvidence}->>'geocodeRetryAt','')<=${new Date().toISOString()}`
  )).orderBy(aeds.updatedAt,aeds.id).limit(Math.min(25,Math.max(1,limit)));
  let processed=0,resolved=0,status="READY";
  for(const{record,revision}of pending){
    const result=await lookupGeoapify(record);
    if(["BUDGET_EXHAUSTED","BUSY","NOT_CONFIGURED"].includes(result.status)){status=result.status;break;}
    const candidate=result.status==="RESOLVED"?result.candidate:undefined;
    const explicitAddress=geocodingAddress(record);
    const addressFields=candidate&&explicitAddress?{
      ...(!record.city?{city:explicitAddress.city}:{}),
      ...(!record.postalCode&&explicitAddress.postalCode?{postalCode:explicitAddress.postalCode}:{}),
    }:{};
    const dependency=candidate?{provider:"Geoapify",providerUrl:"https://www.geoapify.com/",
      underlyingSource:candidate.datasource??{},rightsStatus:"NOT_REVIEWED",
      attribution:"Powered by Geoapify; © OpenStreetMap contributors",
      termsUrl:"https://www.geoapify.com/terms-and-conditions/"}:undefined;
    const updated=await db.transaction(async tx=>{
      const [after]=await tx.update(aeds).set({
        ...(candidate?{latitude:candidate.lat,longitude:candidate.lon,publicImport:publicationAfterGeocoding(record),...addressFields}:{}),
        locationEvidence:{...record.locationEvidence,provider:"Geoapify",geocodingStatus:result.status,
          ...(candidate?{requiresLocationReview:false,coordinateOrigin:"address_geocoding",sourceCoordinateIssuesPreserved:true}:{}),
          geocodedAt:new Date().toISOString(),geocodeRetryAt:result.retryAt,queryHash:result.queryHash,
          result:result.candidate??null,candidates:result.candidates??[],
          ...(dependency?{geocodingDependency:dependency}:{}),notDeviceVerification:true},
        updatedAt:sql`clock_timestamp()`,
      }).where(and(eq(aeds.id,record.id),sql`${aeds.updatedAt}=${revision}::timestamptz`,isNull(aeds.latitude),isNull(aeds.longitude))).returning();
      if(!after)return false;
      await tx.insert(auditLogs).values({entityId:record.id,action:candidate?"Uzupełniono lokalizację przez Geoapify":"Próba geokodowania adresu AED",
        details:{provider:"Geoapify",status:result.status,cached:result.cached??false,queryHash:result.queryHash,
          changedFields:candidate?["latitude","longitude",...Object.keys(addressFields)]:[],
          before:{latitude:record.latitude,longitude:record.longitude},after:{latitude:after.latitude,longitude:after.longitude},
          verificationStatusPreserved:true,originalSourceDataPreserved:true,attribution:dependency??null}});
      return true;
    });
    if(updated){processed++;if(candidate)resolved++;}
    if(result.status==="PROVIDER_ERROR"){status=result.status;break;}
  }
  return{processed,resolved,status};
}
export function startGeocodingScheduler(){
  let stopped=false,running=false;
  const check=async()=>{
    if(stopped||running)return;running=true;
    try{const result=await geocodePendingRecords();if(result.processed)logger.info(result,"Przetworzono adresy niekompletnych AED; bez automatycznej weryfikacji urządzeń.");}
    catch{logger.error("Nie udało się przetworzyć kolejki geokodowania; zachowano rekordy bez lokalizacji.");}
    finally{running=false;}
  };
  const initial=setTimeout(()=>void check(),8000);initial.unref();
  const timer=setInterval(()=>void check(),60000);timer.unref();
  return()=>{stopped=true;clearTimeout(initial);clearInterval(timer);};
}
