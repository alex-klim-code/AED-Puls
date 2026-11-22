import { pgTable, text, uuid, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
});
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleSubject: text("google_subject").unique(),
  demoIdentity: text("demo_identity").unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default("USER"),
  isDemo: boolean("is_demo").notNull().default(false),
  organizationId: uuid("organization_id").references(() => organizations.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const memberships = pgTable("organization_memberships", {
  userId: uuid("user_id").notNull().references(() => users.id),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
}, (t) => [primaryKey({ columns: [t.userId, t.organizationId] })]);
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  csrfToken: text("csrf_token").notNull(),
  oauthState: text("oauth_state"),
  oauthNonce: text("oauth_nonce"),
  oauthVerifier: text("oauth_verifier"),
  oauthExpiresAt: timestamp("oauth_expires_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const adminBootstrap = pgTable("admin_bootstrap", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
