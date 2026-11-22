import { pgTable,uuid,text,jsonb,integer,timestamp,index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { users,organizations } from "./identity";
import { aeds } from "./aed";
export const aedProposals=pgTable("aed_proposals",{
  id:uuid("id").primaryKey().defaultRandom(),
  submittedBy:uuid("submitted_by").notNull().references(()=>users.id),
  organizationId:uuid("organization_id").references(()=>organizations.id),
  sourceName:text("source_name").notNull(),
  submitterRole:text("submitter_role").notNull(),
  submissionMethod:text("submission_method").notNull(),
  payload:jsonb("payload").$type<Record<string,unknown>>().notNull(),
  originalData:jsonb("original_data").$type<Record<string,unknown>>().notNull(),
  evidence:jsonb("evidence").$type<Record<string,unknown>>().notNull().default({}),
  issues:jsonb("issues").$type<string[]>().notNull().default([]),
  status:text("status").notNull().default("NEW"),
  photoId:uuid("photo_id"),
  reviewNote:text("review_note").notNull().default(""),
  revision:integer("revision").notNull().default(1),
  reviewedBy:uuid("reviewed_by").references(()=>users.id),
  aedId:uuid("aed_id").references(()=>aeds.id),
  targetAedId:uuid("target_aed_id").references(()=>aeds.id),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("proposals_owner").on(t.submittedBy),index("proposals_org").on(t.organizationId),index("proposals_status").on(t.status)]);
export const insertAedProposalSchema=createInsertSchema(aedProposals);
export type AedProposalRow=typeof aedProposals.$inferSelect;
