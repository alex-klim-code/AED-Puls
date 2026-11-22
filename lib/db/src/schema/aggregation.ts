import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { observations } from "./provenance";
import { users } from "./identity";

export const observationVersions = pgTable("observation_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  observationId: uuid("observation_id").notNull().references(() => observations.id),
  contentHash: text("content_hash").notNull(),
  document: jsonb("document").$type<Record<string, unknown>>().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("observation_version_identity").on(t.observationId, t.contentHash)]);

export const mergeDecisions = pgTable("merge_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull(),
  keeperId: uuid("keeper_id").notNull(),
  loserId: uuid("loser_id").notNull(),
  actorId: uuid("actor_id").references(() => users.id),
  mode: text("mode").notNull(),
  before: jsonb("before").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
});
