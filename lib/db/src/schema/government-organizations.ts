import { pgTable, text, uuid, jsonb, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users, organizations } from "./identity";

export const governmentInstitutions = pgTable("government_institutions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceUrl: text("source_url").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  importStatus: text("import_status").notNull().default("NOT_STARTED"),
  importMessage: text("import_message").notNull().default(""),
  importedCount: integer("imported_count").notNull().default(0),
  jobId: uuid("job_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const governmentDatasets = pgTable("government_datasets", {
  id: text("id").primaryKey(), institutionId: text("institution_id").notNull().references(() => governmentInstitutions.id),
  name: text("name").notNull(), sourceUrl: text("source_url").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
});
export const governmentResources = pgTable("government_resources", {
  id: text("id").primaryKey(), datasetId: text("dataset_id").notNull().references(() => governmentDatasets.id),
  name: text("name").notNull(), sourceUrl: text("source_url").notNull(), format: text("format").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
});
export const governmentClaims = pgTable("government_organization_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: text("institution_id").notNull().references(() => governmentInstitutions.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  representative: text("representative").notNull(), evidence: text("evidence").notNull(),
  status: text("status").notNull().default("PENDING"), note: text("note").notNull().default(""),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("government_claim_user_institution").on(t.userId, t.institutionId)]);
