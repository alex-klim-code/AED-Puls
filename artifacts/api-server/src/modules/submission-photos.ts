import type { FastifyInstance } from "fastify";
import { eq,and,sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db,submissionPhotos } from "@workspace/db";
import { RequestSubmissionPhotoBody,RequestSubmissionPhotoResponse,CompleteSubmissionPhotoResponse } from "@workspace/api-zod";
import { requireUser,fail } from "./auth";
import type { Actor,Tx } from "./proposal-service";
import { submissionAccess,type SubmissionKind } from "./submission-access";
import { PHOTO_MAX,photoUploadUrl,sanitizePhoto,privatePhotoFile } from "./submission-photo-storage";
export async function attachPhoto(tx:Tx,id:string|null|undefined,user:Actor,kind:SubmissionKind,entityId:string){
  if(!id)return null;
  const [photo]=await tx.select().from(submissionPhotos).where(eq(submissionPhotos.id,z.uuid().parse(id))).for("update");
  if(!photo||photo.ownerId!==user.id||photo.status!=="READY"||photo.entityId)fail(400,"Zdjęcie jest niedostępne, niewalidowane lub już przypisane.");
  await tx.update(submissionPhotos).set({status:"ATTACHED",entityKind:kind,entityId}).where(eq(submissionPhotos.id,id));
  return id;
}
export function registerSubmissionPhotos(app:FastifyInstance){
  app.post("/api/submission-photos/uploads",{config:{rateLimit:{max:12,timeWindow:"1 minute"}}},async(req,reply)=>{
    const user=requireUser(req),input=RequestSubmissionPhotoBody.parse(req.body);
    const [quota]=await db.select({n:sql<number>`count(*)::int`}).from(submissionPhotos)
      .where(and(eq(submissionPhotos.ownerId,user.id),sql`${submissionPhotos.createdAt}>now()-interval '1 day'`));
    if(quota!.n>=100)fail(429,"Dzienny limit 100 zdjęć został przekroczony.");
    const upload=await photoUploadUrl();
    const [photo]=await db.insert(submissionPhotos).values({...input,ownerId:user.id,rawPath:upload.rawPath}).returning();
    return reply.code(201).send(RequestSubmissionPhotoResponse.parse({id:photo!.id,uploadURL:upload.uploadURL}));
  });
  app.post("/api/submission-photos/:id/complete",{config:{rateLimit:{max:12,timeWindow:"1 minute"}}},async req=>{
    const user=requireUser(req),id=z.uuid().parse((req.params as {id:string}).id);
    const photo=await db.transaction(async tx=>{
      const [row]=await tx.select().from(submissionPhotos).where(eq(submissionPhotos.id,id)).for("update");
      if(!row||row.ownerId!==user.id)fail(404,"Nie znaleziono zdjęcia.");
      if(row.status==="READY"||row.status==="ATTACHED")return row;
      if(Date.now()-row.createdAt.getTime()>15*60000)fail(400,"Przesyłanie wygasło. Wybierz zdjęcie ponownie.");
      const objectPath=await sanitizePhoto(row.rawPath,row.size,row.contentType);
      const [after]=await tx.update(submissionPhotos).set({objectPath,status:"READY"}).where(eq(submissionPhotos.id,id)).returning();
      return after!;
    });
    return CompleteSubmissionPhotoResponse.parse({id:photo.id,url:`/api/submission-photos/${photo.id}`});
  });
  app.get("/api/submission-photos/:id",async(req,reply)=>{
    const user=requireUser(req),id=z.uuid().parse((req.params as {id:string}).id);
    const [photo]=await db.select().from(submissionPhotos).where(eq(submissionPhotos.id,id));
    if(!photo?.objectPath||!["READY","ATTACHED"].includes(photo.status))fail(404,"Nie znaleziono zdjęcia.");
    if(photo.entityId)await submissionAccess(photo.entityKind as SubmissionKind,photo.entityId,user);
    else if(photo.ownerId!==user.id)fail(404,"Nie znaleziono zdjęcia.");
    return reply.header("Content-Type","image/webp").header("Cache-Control","private, no-store")
      .header("Content-Security-Policy","default-src 'none'; sandbox").send(privatePhotoFile(photo.objectPath).createReadStream({start:0,end:PHOTO_MAX}));
  });
}
