import { createHmac,timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod/v4";
import { CreateSubmissionLocationBody,CreateSubmissionLocationResponse } from "@workspace/api-zod";
import { requireUser,fail } from "./auth";
import { lookupReverseAddress } from "../geocoding/reverse";

const receiptSchema=z.object({
  userId:z.string(),expiresAt:z.number(),capturedAt:z.number(),
  latitude:z.number().min(49).max(55),longitude:z.number().min(14).max(24.2),accuracy:z.number().min(0).max(100),
  address:z.string().max(240),city:z.string().max(120),postalCode:z.string().max(10),voivodeship:z.string().max(100),
  addressStatus:z.enum(["RESOLVED","UNRESOLVED"]),
});
export type LocationReceipt=z.infer<typeof receiptSchema>;
const signature=(payload:string)=>createHmac("sha256",process.env.SESSION_SECRET!).update(`gps-submission:${payload}`).digest("base64url");
export function signLocationReceipt(receipt:LocationReceipt){
  const payload=Buffer.from(JSON.stringify(receiptSchema.parse(receipt))).toString("base64url");
  return `${payload}.${signature(payload)}`;
}
export function readLocationReceipt(token:string|undefined,userId:string):LocationReceipt{
  if(!token||token.length>10000)fail(400,"Najpierw wyślij swoją geolokalizację przyciskiem GPS.");
  try{
    const parts=token.split(".");if(parts.length!==2)throw new Error();
    const expected=signature(parts[0]!),actual=parts[1]!;
    if(actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))throw new Error();
    const receipt=receiptSchema.parse(JSON.parse(Buffer.from(parts[0]!,"base64url").toString("utf8")));
    if(receipt.userId!==userId||receipt.expiresAt<Date.now())throw new Error();
    return receipt;
  }catch{fail(400,"Potwierdzenie GPS wygasło lub jest nieprawidłowe. Wyślij swoją geolokalizację ponownie.");}
}
export function registerSubmissionLocation(app:FastifyInstance){
  app.post("/api/submission-location",{config:{rateLimit:{max:6,timeWindow:"1 minute"}}},async req=>{
    const user=requireUser(req,["USER","PROVIDER","ADMIN"]);
    const point=CreateSubmissionLocationBody.parse(req.body),now=Date.now();
    if(point.capturedAt<now-300000||point.capturedAt>now+60000)fail(400,"Odczyt GPS jest nieaktualny. Ustal pozycję ponownie.");
    const address=await lookupReverseAddress(point.latitude,point.longitude);
    const receipt={...point,...address,userId:user.id,expiresAt:now+15*60000};
    return CreateSubmissionLocationResponse.parse({...point,...address,locationToken:signLocationReceipt(receipt)});
  });
}
