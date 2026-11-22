import { pgTable,uuid,text,jsonb,timestamp,index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { aedProposals } from "./aed-proposals";
import { users } from "./identity";
export const proposalEvents=pgTable("aed_proposal_events",{
  id:uuid("id").primaryKey().defaultRandom(),
  proposalId:uuid("proposal_id").notNull().references(()=>aedProposals.id),
  actorId:uuid("actor_id").notNull().references(()=>users.id),
  action:text("action").notNull(),
  changes:jsonb("changes").$type<Record<string,unknown>>().notNull().default({}),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("proposal_events_parent").on(t.proposalId)]);
export const insertProposalEventSchema=createInsertSchema(proposalEvents);
export type ProposalEventRow=typeof proposalEvents.$inferSelect;
