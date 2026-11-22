import { and, eq, inArray, or, sql } from "drizzle-orm";
import { aeds } from "@workspace/db";

export function verificationState(value:string):"VERIFIED"|"NOT_VERIFIED"|"REJECTED"{
  return ["verified","VERIFIED"].includes(value)?"VERIFIED":["rejected","REJECTED"].includes(value)?"REJECTED":"NOT_VERIFIED";
}
/** Legacy moderation query names remain compatible with older clients and import history. */
export function verificationClause(value:string){
  if(["verified","VERIFIED"].includes(value))return inArray(aeds.verificationStatus,["verified","VERIFIED"]);
  if(["rejected","REJECTED"].includes(value))return inArray(aeds.verificationStatus,["rejected","REJECTED"]);
  if(value==="pending"||value==="unverified")return or(eq(aeds.verificationStatus,value),
    and(eq(aeds.verificationStatus,"NOT_VERIFIED"),eq(aeds.imported,value==="unverified")));
  return inArray(aeds.verificationStatus,["pending","unverified","NOT_VERIFIED"]);
}
export const locatedClause=()=>sql`${aeds.latitude} is not null and ${aeds.longitude} is not null
  and ${aeds.latitude} between 49 and 55 and ${aeds.longitude} between 14 and 24.2`;
export function located<T extends{latitude:number|null;longitude:number|null}>(r:T):r is T&{latitude:number;longitude:number}{
  return typeof r.latitude==="number"&&typeof r.longitude==="number"&&Number.isFinite(r.latitude)&&Number.isFinite(r.longitude);
}
