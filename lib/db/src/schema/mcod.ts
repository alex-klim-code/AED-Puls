import { pgTable,uuid,text,jsonb,integer,timestamp,uniqueIndex,index } from "drizzle-orm/pg-core";
import { organizations,users } from "./identity";
import { aeds } from "./aed";
import { aedProposals } from "./aed-proposals";

export const mcodInstitutions=pgTable("mcod_institution_cache",{
  id:text("id").primaryKey(),name:text("name").notNull(),payload:jsonb("payload").$type<Record<string,unknown>>().notNull(),
  checkedAt:timestamp("checked_at",{withTimezone:true}).notNull().defaultNow(),
});
export const mcodInstitutionRequests=pgTable("mcod_institution_requests",{
  id:uuid("id").primaryKey().defaultRandom(),organizationId:uuid("organization_id").notNull().references(()=>organizations.id),
  submittedBy:uuid("submitted_by").notNull().references(()=>users.id),kind:text("kind").notNull(),
  institutionId:text("institution_id"),requestedInstitutionId:text("requested_institution_id"),
  details:jsonb("details").$type<Record<string,unknown>>().notNull(),status:text("status").notNull().default("PENDING_VERIFICATION"),
  revision:integer("revision").notNull().default(1),reviewNote:text("review_note").notNull().default(""),
  reviewedBy:uuid("reviewed_by").references(()=>users.id),lastError:text("last_error"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("mcod_requests_org").on(t.organizationId)]);
export const mcodDatasets=pgTable("mcod_datasets",{
  id:uuid("id").primaryKey().defaultRandom(),organizationId:uuid("organization_id").notNull().references(()=>organizations.id),
  institutionRequestId:uuid("institution_request_id").notNull().references(()=>mcodInstitutionRequests.id),
  title:text("title").notNull(),description:text("description").notNull().default(""),institutionId:text("institution_id"),
  datasetId:text("dataset_id"),publicationStatus:text("publication_status").notNull().default("DRAFT"),lastError:text("last_error"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
});
export const mcodResources=pgTable("mcod_resources",{
  id:uuid("id").primaryKey().defaultRandom(),datasetId:uuid("dataset_id").notNull().references(()=>mcodDatasets.id),
  format:text("format").notNull(),resourceId:text("resource_id"),publicationStatus:text("publication_status").notNull().default("DRAFT"),
  publishedAt:timestamp("published_at",{withTimezone:true}),lastError:text("last_error"),
},t=>[uniqueIndex("mcod_resource_dataset_format").on(t.datasetId,t.format)]);
export const mcodPublicationPlans=pgTable("mcod_publication_plans",{
  id:uuid("id").primaryKey().defaultRandom(),datasetId:uuid("dataset_id").notNull().references(()=>mcodDatasets.id),
  resourceId:uuid("resource_id").notNull().references(()=>mcodResources.id),organizationId:uuid("organization_id").notNull().references(()=>organizations.id),
  createdBy:uuid("created_by").notNull().references(()=>users.id),idempotencyKey:text("idempotency_key").notNull(),
  snapshot:jsonb("snapshot").$type<Record<string,unknown>[]>().notNull(),validation:jsonb("validation").$type<Record<string,unknown>>().notNull(),
  status:text("status").notNull().default("PREPARED"),lastError:text("last_error"),publishedAt:timestamp("published_at",{withTimezone:true}),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("mcod_plan_idempotency").on(t.organizationId,t.idempotencyKey)]);
export const mcodAedDrafts=pgTable("mcod_aed_drafts",{
  id:uuid("id").primaryKey().defaultRandom(),organizationId:uuid("organization_id").notNull().references(()=>organizations.id),
  createdBy:uuid("created_by").notNull().references(()=>users.id),payload:jsonb("payload").$type<Record<string,unknown>>().notNull(),
  status:text("status").notNull().default("DRAFT"),proposalId:uuid("proposal_id").references(()=>aedProposals.id),
  targetAedId:uuid("target_aed_id").references(()=>aeds.id),targetRevision:text("target_revision"),
  revision:integer("revision").notNull().default(1),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
});
export const mcodEvents=pgTable("mcod_events",{
  id:uuid("id").primaryKey().defaultRandom(),organizationId:uuid("organization_id").references(()=>organizations.id),
  actorId:uuid("actor_id").references(()=>users.id),entityId:uuid("entity_id"),action:text("action").notNull(),
  details:jsonb("details").$type<Record<string,unknown>>().notNull().default({}),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
export const mcodSyncRuns=pgTable("mcod_sync_runs",{
  id:uuid("id").primaryKey().defaultRandom(),status:text("status").notNull().default("RUNNING"),
  imported:integer("imported").notNull().default(0),updated:integer("updated").notNull().default(0),
  errors:jsonb("errors").$type<Record<string,unknown>[]>().notNull().default([]),
  startedAt:timestamp("started_at",{withTimezone:true}).notNull().defaultNow(),finishedAt:timestamp("finished_at",{withTimezone:true}),
});
