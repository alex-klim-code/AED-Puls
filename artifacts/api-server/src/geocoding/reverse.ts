import { createHash } from "node:crypto";
import { and,desc,eq,sql } from "drizzle-orm";
import { db,geocodingAttempts } from "@workspace/db";
import { z } from "zod/v4";
import { dailyGeocodingLimit } from "./geoapify";
import { clean } from "../ingestion/normalize";
import { fail } from "../modules/auth";

export type ReverseAddress={address:string;city:string;postalCode:string;voivodeship:string;addressStatus:"RESOLVED"|"UNRESOLVED"};
const resultSchema=z.object({results:z.array(z.object({
  country_code:z.string(),lat:z.number().min(-90).max(90),lon:z.number().min(-180).max(180),
  street:z.string().optional(),housenumber:z.string().optional(),city:z.string().optional(),town:z.string().optional(),
  village:z.string().optional(),municipality:z.string().optional(),postcode:z.string().optional(),state:z.string().optional(),
})).max(3)});
export function reverseAddress(latitude:number,longitude:number,document:unknown):ReverseAddress{
  const body=resultSchema.parse(document);
  const empty:ReverseAddress={address:"",city:"",postalCode:"",voivodeship:"",addressStatus:"UNRESOLVED"};
  const r=body.results[0];if(!r||r.country_code.toLowerCase()!=="pl")return empty;
  const rad=Math.PI/180,dy=(r.lat-latitude)*rad,dx=(r.lon-longitude)*rad;
  const h=Math.sin(dy/2)**2+Math.cos(latitude*rad)*Math.cos(r.lat*rad)*Math.sin(dx/2)**2;
  if(6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)))>200)return empty;
  const address=clean([r.street,r.housenumber].filter(Boolean).join(" ")).slice(0,240);
  const city=clean(r.city||r.town||r.village||r.municipality).slice(0,120);
  return {address,city,postalCode:/^\d{2}-\d{3}$/.test(r.postcode??"")?r.postcode!:"",
    voivodeship:clean(r.state).slice(0,100),addressStatus:address&&city?"RESOLVED":"UNRESOLVED"};
}
export async function lookupReverseAddress(latitude:number,longitude:number):Promise<ReverseAddress>{
  if(!process.env.GEOAPIFY_API_KEY)fail(503,"Automatyczne ustalanie adresu nie jest skonfigurowane.");
  const queryHash=createHash("sha256").update(`reverse:${latitude.toFixed(6)}:${longitude.toFixed(6)}`).digest("hex");
  return db.transaction(async tx=>{
    const lock=await tx.execute<{locked:boolean}>(sql`select pg_try_advisory_xact_lock(7349261) as locked`);
    if(!lock.rows[0]?.locked)fail(429,"Usługa adresowa jest zajęta. Spróbuj ponownie za chwilę.");
    const [cached]=await tx.select().from(geocodingAttempts).where(and(eq(geocodingAttempts.queryHash,queryHash),
      sql`${geocodingAttempts.expiresAt}>now()`)).orderBy(desc(geocodingAttempts.attemptedAt)).limit(1);
    if(cached&&["RESOLVED","UNRESOLVED"].includes(cached.status))return cached.result as unknown as ReverseAddress;
    const [budget]=await tx.select({n:sql<number>`count(*)::int`}).from(geocodingAttempts)
      .where(sql`${geocodingAttempts.attemptedAt}>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`);
    if(budget!.n>=dailyGeocodingLimit)fail(429,"Wyczerpano dzienny limit automatycznego ustalania adresów. Spróbuj jutro.");
    const expiresAt=new Date(Date.now()+86400000);
    const [attempt]=await tx.insert(geocodingAttempts).values({queryHash,status:"PROVIDER_ERROR",expiresAt:new Date(Date.now()+60000)}).returning();
    let result:ReverseAddress|null=null;
    try{
      const url=new URL("https://api.geoapify.com/v1/geocode/reverse");
      url.search=new URLSearchParams({lat:String(latitude),lon:String(longitude),format:"json",lang:"pl",limit:"1",apiKey:process.env.GEOAPIFY_API_KEY!}).toString();
      const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(8000)});
      if(response.ok){const text=await response.text();if(text.length<128000)result=reverseAddress(latitude,longitude,JSON.parse(text));}
    }catch{/* Provider URLs contain credentials; never log exception messages. */}
    if(result)await tx.update(geocodingAttempts).set({status:result.addressStatus,result,expiresAt}).where(eq(geocodingAttempts.id,attempt!.id));
    // Return the failure outside the transaction so failed outbound attempts still consume budget.
    return result;
  }).then(result=>{if(!result)fail(503,"Nie udało się ustalić adresu. Pozycja nie została zatwierdzona; ponów próbę.");return result;});
}
