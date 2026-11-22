import { pgTable,uuid,text,timestamp,integer,index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { users } from "./identity";
export const submissionPhotos=pgTable("submission_photos",{
  id:uuid("id").primaryKey().defaultRandom(),ownerId:uuid("owner_id").notNull().references(()=>users.id),
  rawPath:text("raw_path").notNull(),objectPath:text("object_path"),name:text("name").notNull(),
  contentType:text("content_type").notNull(),size:integer("size").notNull(),status:text("status").notNull().default("UPLOADING"),
  entityKind:text("entity_kind"),entityId:uuid("entity_id"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("submission_photo_owner").on(t.ownerId)]);
export const submissionComments=pgTable("submission_comments",{
  id:uuid("id").primaryKey().defaultRandom(),kind:text("kind").notNull(),entityId:uuid("entity_id").notNull(),
  authorId:uuid("author_id").notNull().references(()=>users.id),body:text("body").notNull(),
  photoId:uuid("photo_id").unique().references(()=>submissionPhotos.id),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("submission_comment_thread").on(t.kind,t.entityId)]);
export const insertSubmissionPhotoSchema=createInsertSchema(submissionPhotos);
export const insertSubmissionCommentSchema=createInsertSchema(submissionComments);
export type SubmissionPhotoRow=typeof submissionPhotos.$inferSelect;
export type SubmissionCommentRow=typeof submissionComments.$inferSelect;
