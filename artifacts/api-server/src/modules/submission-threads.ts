import type { FastifyInstance } from "fastify";
import { and,asc,eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db,submissionComments,users,auditLogs,proposalEvents } from "@workspace/db";
import { AddSubmissionCommentBody,AddSubmissionCommentResponse,GetSubmissionThreadResponse } from "@workspace/api-zod";
import { requireUser,fail } from "./auth";
import { submissionAccess } from "./submission-access";
import { attachPhoto } from "./submission-photos";
const params=z.object({kind:z.enum(["AED","ERROR"]),id:z.uuid()});
export function registerSubmissionThreads(app:FastifyInstance){
  app.get("/api/submission-threads/:kind/:id",async req=>{
    const user=requireUser(req),{kind,id}=params.parse(req.params);
    await submissionAccess(kind,id,user);
    const comments=await db.select({id:submissionComments.id,body:submissionComments.body,author:users.name,
      authorRole:users.role,createdAt:submissionComments.createdAt,photoId:submissionComments.photoId})
      .from(submissionComments).innerJoin(users,eq(submissionComments.authorId,users.id))
      .where(and(eq(submissionComments.kind,kind),eq(submissionComments.entityId,id))).orderBy(asc(submissionComments.createdAt),submissionComments.id);
    const history=kind==="AED"
      ?await db.select().from(proposalEvents).where(eq(proposalEvents.proposalId,id)).orderBy(asc(proposalEvents.createdAt))
      :(await db.select().from(auditLogs).where(eq(auditLogs.entityId,id)).orderBy(asc(auditLogs.createdAt)))
        .map(e=>({...e,changes:e.details}));
    return GetSubmissionThreadResponse.parse({comments:comments.map(c=>({...c,createdAt:c.createdAt.toISOString()})),
      history:history.map(e=>({...e,createdAt:e.createdAt.toISOString()}))});
  });
  app.post("/api/submission-threads/:kind/:id",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(req,reply)=>{
    const user=requireUser(req),{kind,id}=params.parse(req.params),input=AddSubmissionCommentBody.parse(req.body);
    if(!input.body.trim()&&!input.photoId)fail(400,"Napisz komentarz lub dodaj zdjęcie.");
    const row=await db.transaction(async tx=>{
      await submissionAccess(kind,id,user,tx,true);
      await attachPhoto(tx,input.photoId,user,kind,id);
      const [row]=await tx.insert(submissionComments).values({kind,entityId:id,authorId:user.id,body:input.body.trim(),photoId:input.photoId}).returning();
      await tx.insert(auditLogs).values({userId:user.id,entityId:id,action:"Dodano komentarz do zgłoszenia",details:{commentId:row!.id,photoId:input.photoId??null}});
      return row!;
    });
    return reply.code(201).send(AddSubmissionCommentResponse.parse({...row,author:user.name,authorRole:user.role,createdAt:row.createdAt.toISOString()}));
  });
}
