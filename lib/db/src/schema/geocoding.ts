import { pgTable,uuid,text,timestamp,jsonb,index } from "drizzle-orm/pg-core";

// One row per outbound attempt doubles as a durable cache and a global daily budget.
// API keys and request URLs are deliberately never persisted here.
export const geocodingAttempts=pgTable("geocoding_attempts",{
  id:uuid("id").primaryKey().defaultRandom(),
  queryHash:text("query_hash").notNull(),
  attemptedAt:timestamp("attempted_at",{withTimezone:true}).notNull().defaultNow(),
  expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
  status:text("status").notNull(),
  result:jsonb("result").$type<Record<string,unknown>>().notNull().default({}),
},t=>[index("geocoding_query_cache").on(t.queryHash,t.attemptedAt),index("geocoding_daily_budget").on(t.attemptedAt)]);
