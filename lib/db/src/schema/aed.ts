import { pgTable, text, uuid, boolean, timestamp, doublePrecision, integer, jsonb, index } from "drizzle-orm/pg-core";
import { organizations, users } from "./identity";
import { sql } from "drizzle-orm";

export const aeds = pgTable("aed_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  postalCode: text("postal_code"),
  voivodeship: text("voivodeship"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  // CASE always returns a status. Omit a redundant NOT NULL: drizzle-kit otherwise
  // proposes truncating existing rows when adding a generated column.
  completenessStatus: text("completeness_status").generatedAlwaysAs(sql`case when
    latitude is not null and longitude is not null
    and lower(trim(name)) not in ('','unknown') and lower(trim(address)) not in ('','unknown')
    and lower(trim(city)) not in ('','unknown') and lower(trim(license)) not in ('','unknown')
    then 'COMPLETE' else 'INCOMPLETE' end`),
  locationEvidence: jsonb("location_evidence").$type<Record<string, unknown>>().notNull().default({}),
  description: text("description"),
  placement: text("placement").notNull().default("unknown"),
  accessibility: text("accessibility").notNull().default("unknown"),
  openingHours: text("opening_hours"),
  operationalStatus: text("operational_status").notNull().default("unknown"),
  verificationStatus: text("verification_status").notNull().default("NOT_VERIFIED"),
  recordVerificationStatus: text("record_verification_status").notNull().default("UNVERIFIED"),
  deviceOperationalStatus: text("device_operational_status").notNull().default("UNKNOWN"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verificationEvidence: jsonb("verification_evidence").$type<Record<string, unknown>>().notNull().default({}),
  sourceCategory: text("source_category").notNull().default("UNKNOWN"),
  qualityScore: integer("quality_score").notNull().default(0),
  qualityIssues: jsonb("quality_issues").$type<string[]>().notNull().default([]),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  license: text("license").notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  submittedBy: uuid("submitted_by").references(() => users.id),
  isDemo: boolean("is_demo").notNull().default(false),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  country: text("country").notNull().default("PL"),
  responsibleOrganization: text("responsible_organization"),
  imported: boolean("imported").notNull().default(false),
  publicImport: boolean("public_import").notNull().default(false),
  mergedIntoId: uuid("merged_into_id"),
  deviceIdentifier: text("device_identifier"),
  publicationCount: integer("publication_count").notNull().default(0),
  independentSourceCount: integer("independent_source_count").notNull().default(0),
  sourceConflict: boolean("source_conflict").notNull().default(false),
}, t=>[index("aed_merged_parent").on(t.mergedIntoId)]);
export const submissions = pgTable("submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  aedId: uuid("aed_id").notNull().references(() => aeds.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const reports = pgTable("conflict_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  aedId: uuid("aed_id").notNull().references(() => aeds.id),
  message: text("message").notNull(),
  submittedBy:uuid("submitted_by").references(()=>users.id),
  organizationId:uuid("organization_id").references(()=>organizations.id),
  sourceName:text("source_name").notNull().default("Użytkownik AED Puls"),
  status:text("status").notNull().default("NEW"),
  photoId:uuid("photo_id"),
  reviewNote:text("review_note").notNull().default(""),
  revision:integer("revision").notNull().default(1),
  reviewedBy:uuid("reviewed_by").references(()=>users.id),
  reviewedAt:timestamp("reviewed_at",{withTimezone:true}),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
