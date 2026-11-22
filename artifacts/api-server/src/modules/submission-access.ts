import { eq } from "drizzle-orm";
import { db,aedProposals,reports } from "@workspace/db";
import { fail } from "./auth";
import type { Actor,Tx } from "./proposal-service";
export type SubmissionKind="AED"|"ERROR";
export const submissionStatus=(s:string)=>({PENDING:"NEW",NEEDS_INFO:"UNCOMPLETED",APPROVED:"DONE",RESOLVED:"DONE"} as Record<string,string>)[s]??s;
export const statusAliases=(s:string)=>[s,...Object.entries({PENDING:"NEW",NEEDS_INFO:"UNCOMPLETED",APPROVED:"DONE",RESOLVED:"DONE"}).filter(([,v])=>v===s).map(([k])=>k)];
export async function submissionAccess(kind:SubmissionKind,id:string,user:Actor,tx:Tx|typeof db=db,lock=false){
  const query=kind==="AED"?tx.select().from(aedProposals).where(eq(aedProposals.id,id)):tx.select().from(reports).where(eq(reports.id,id));
  const [row]=await(lock?query.for("update"):query);
  if(!row||!(user.role==="ADMIN"||row.submittedBy===user.id||(user.role==="PROVIDER"&&!!user.organizationId&&row.organizationId===user.organizationId)))
    fail(404,"Nie znaleziono zgłoszenia.");
  return row;
}
