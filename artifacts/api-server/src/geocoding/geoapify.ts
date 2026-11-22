import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { desc,eq,sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db,geocodingAttempts } from "@workspace/db";
import { keyOf,withinPoland } from "../ingestion/normalize";
import { geocodingAddress,type GeocodeAddress } from "./address";

export const dailyGeocodingLimit=25;
const day=86400000;
const rank=z.object({confidence:z.number().min(0).max(1).optional(),
  confidence_city_level:z.number().min(0).max(1).optional(),confidence_street_level:z.number().min(0).max(1).optional(),
  confidence_building_level:z.number().min(0).max(1).optional(),match_type:z.string().optional()});
const candidate=z.object({
  lat:z.number().finite(),lon:z.number().finite(),country_code:z.string(),city:z.string().optional(),
  street:z.string().optional(),housenumber:z.string().optional(),postcode:z.string().optional(),
  formatted:z.string().optional(),result_type:z.string().optional(),rank,
  datasource:z.object({sourcename:z.string().optional(),attribution:z.string().optional(),
    license:z.string().optional(),url:z.string().optional()}).optional(),
});
export type GeocodeCandidate=z.infer<typeof candidate>;
export type { GeocodeAddress } from "./address";
export type GeocodeStatus="RESOLVED"|"UNRESOLVED"|"AMBIGUOUS"|"INSUFFICIENT_ADDRESS"|"NOT_CONFIGURED"|"PROVIDER_ERROR"|"BUDGET_EXHAUSTED"|"BUSY";
export type GeocodeResult={status:GeocodeStatus;queryHash:string;candidate?:GeocodeCandidate;candidates?:GeocodeCandidate[];cached?:boolean;retryAt:string;providerStatus?:number};
const known=(s:string)=>s.trim().length>=2&&!["unknown","brak danych"].includes(s.trim().toLowerCase());
const streetKey=(s:string)=>keyOf(s.replace(/^(ulica|ul\.?|aleja|al\.?|plac|pl\.?)\s+/i,""));
export function assessGeocode(address:GeocodeAddress,results:unknown):Pick<GeocodeResult,"status"|"candidate"|"candidates">{
  const explicitAddress=geocodingAddress(address);
  if(!explicitAddress)return{status:"INSUFFICIENT_ADDRESS"};
  address=explicitAddress;
  const parsed=z.array(candidate).max(3).safeParse(results);
  if(!parsed.success)return{status:"PROVIDER_ERROR"};
  const house=address.address.trim().match(/^(.*?)\s+(\d+[a-z]?(?:\/\d+[a-z]?)?)$/iu);
  const reliable=parsed.data.filter(c=>house&&known(address.city)&&c.country_code.toLowerCase()==="pl"
    &&withinPoland(c.lat,c.lon)&&c.result_type==="building"
    &&c.rank.match_type==="full_match"
    &&[c.rank.confidence,c.rank.confidence_city_level,c.rank.confidence_street_level,c.rank.confidence_building_level].every(n=>typeof n==="number"&&n>=0.95)
    &&keyOf(c.city??"")===keyOf(address.city)
    &&(!address.postalCode||c.postcode===address.postalCode)
    &&streetKey(c.street??"")===streetKey(house[1]!)
    &&keyOf(c.housenumber??"")===keyOf(house[2]!));
  if(reliable.length===1)return{status:"RESOLVED",candidate:reliable[0],candidates:parsed.data};
  return{status:reliable.length>1?"AMBIGUOUS":"UNRESOLVED",candidates:parsed.data};
}
/** Fixed HTTPS provider only. No user-facing generic geocoder and no GPS transmission. */
export async function lookupGeoapify(address:GeocodeAddress):Promise<GeocodeResult>{
  const explicitAddress=geocodingAddress(address);
  const query=[(explicitAddress??address).address.trim(),(explicitAddress??address).postalCode?.trim(),(explicitAddress??address).city.trim(),"Polska"].filter(Boolean).join(", ");
  const queryHash=createHash("sha256").update(query.toLocaleLowerCase("pl")).digest("hex");
  const fallback=(status:GeocodeStatus,ms=day):GeocodeResult=>({status,queryHash,retryAt:new Date(Date.now()+ms).toISOString()});
  if(!explicitAddress)return fallback("INSUFFICIENT_ADDRESS");
  address=explicitAddress;
  if(!process.env.GEOAPIFY_API_KEY)return fallback("NOT_CONFIGURED",3600000);
  return db.transaction(async tx=>{
    const lock=await tx.execute<{locked:boolean}>(sql`select pg_try_advisory_xact_lock(7349261) as locked`);
    if(!lock.rows[0]?.locked)return fallback("BUSY",60000);
    const [cache]=await tx.select().from(geocodingAttempts).where(eq(geocodingAttempts.queryHash,queryHash))
      .orderBy(desc(geocodingAttempts.attemptedAt)).limit(1);
    if(cache&&cache.expiresAt>new Date()){
      const stored=cache.result as unknown as GeocodeResult;
      return{...stored,status:cache.status as GeocodeStatus,queryHash,cached:true,retryAt:cache.expiresAt.toISOString()};
    }
    const[count]=await tx.select({n:sql<number>`count(*)::int`}).from(geocodingAttempts)
      .where(sql`${geocodingAttempts.attemptedAt}>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`);
    if(count!.n>=dailyGeocodingLimit)return fallback("BUDGET_EXHAUSTED");
    const[last]=await tx.select({at:geocodingAttempts.attemptedAt}).from(geocodingAttempts).orderBy(desc(geocodingAttempts.attemptedAt)).limit(1);
    if(last)await delay(Math.max(0,1100-(Date.now()-last.at.getTime())));
    const [attempt]=await tx.insert(geocodingAttempts).values({queryHash,status:"PROVIDER_ERROR",expiresAt:new Date(Date.now()+3600000)}).returning();
    let result:GeocodeResult;
    try{
      const url=new URL("https://api.geoapify.com/v1/geocode/search");
      url.search=new URLSearchParams({text:query,filter:"countrycode:pl",format:"json",limit:"3",lang:"pl",apiKey:process.env.GEOAPIFY_API_KEY!}).toString();
      const response=await fetch(url,{headers:{Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(8000)});
      if(!response.ok){result={...fallback("PROVIDER_ERROR",3600000),providerStatus:response.status};}
      else{
        const text=await response.text();
        if(text.length>128000)result=fallback("PROVIDER_ERROR",3600000);
        else{
          const body=JSON.parse(text) as{results?:unknown};
          const assessed=assessGeocode(address,body.results);
          result={...fallback(assessed.status,assessed.status==="PROVIDER_ERROR"?3600000:7*day),...assessed};
        }
      }
    }catch{
      // Never log fetch errors: they may contain the credential-bearing URL.
      result=fallback("PROVIDER_ERROR",3600000);
    }
    await tx.update(geocodingAttempts).set({status:result.status,expiresAt:new Date(result.retryAt),result:JSON.parse(JSON.stringify(result))}).where(eq(geocodingAttempts.id,attempt!.id));
    return result;
  });
}
