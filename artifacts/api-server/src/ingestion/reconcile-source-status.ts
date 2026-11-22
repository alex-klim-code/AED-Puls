import { desc,eq,inArray,isNotNull } from "drizzle-orm";
import { db,sources,importJobs,auditLogs } from "@workspace/db";
import { diagnostics,addIssue,type RunDiagnostics } from "./sync-diagnostics";
import { retainedDataRules,sourceCompletionMessage } from "./completion-status";

/** Correct current presentation from finished jobs, never rewrite import history or pretend to fetch again. */
export async function reconcileSourceStatuses(sourceIds?:string[]) {
  if(sourceIds&&!sourceIds.length)return {updated:0};
  const rows=await db.select({id:sources.id}).from(sources).where(sourceIds?inArray(sources.id,sourceIds):isNotNull(sources.key));
  let updated=0;
  for(const row of rows)updated+=await db.transaction(async tx=>{
    const [source]=await tx.select().from(sources).where(eq(sources.id,row.id)).for("update");
    if(!source||source.lockedUntil&&source.lockedUntil>new Date())return 0;
    const [job]=await tx.select().from(importJobs).where(eq(importJobs.sourceId,source.id)).orderBy(desc(importJobs.createdAt)).limit(1);
    if(!job?.finishedAt||!["partial","succeeded","failed","unavailable","interrupted"].includes(job.status)||
      ![job.status,"succeeded"].includes(source.status))return 0;
    const summary=job.summary as Record<string,any>;
    if(!summary||!Array.isArray(summary.errorSummary))return 0;
    const issues=summary.errorSummary;
    const errors=issues.filter(i=>i.severity==="error");
    const inferredTransport=errors.filter(i=>!retainedDataRules.has(i.rule)).reduce((sum,i)=>sum+(i.count??1),0);
    const transportFailures=Math.max(Number.isInteger(summary.transportFailures)?summary.transportFailures:0,inferredTransport);
    // Upgrade only a completed nonempty legacy run whose recorded errors are exclusively retained-data issues.
    const status=job.status==="partial"&&job.processed>0&&transportFailures===0&&
      (summary.transportFailures===0||errors.length>0)&&errors.every(i=>retainedDataRules.has(i.rule))?"succeeded":job.status;
    const run=diagnostics(source,job.id,{processed:job.processed,imported:job.imported,updated:job.updated,skipped:job.skipped,errors:job.errors});
    run.validRecords=summary.validRecords??0;run.duplicates=summary.duplicates??0;run.transportFailures=transportFailures;
    for(const issue of issues){addIssue(run,issue);run.issues.get(`${issue.severity}:${issue.rule}`)!.count=issue.count??1;}
    if(summary.recordStatuses)run.recordStatuses=summary.recordStatuses as RunDiagnostics["recordStatuses"];
    const message=sourceCompletionMessage(run,status,!!summary.recordStatuses);
    if(source.status===status&&source.statusMessage===message)return 0;
    await tx.update(sources).set({status,statusMessage:message,
      ...(status==="succeeded"?{lastSuccessAt:job.finishedAt}:{})}).where(eq(sources.id,source.id));
    await tx.insert(auditLogs).values({entityId:source.id,action:"Oddzielono kompletność pobrania od jakości danych",
      details:{jobId:job.id,before:{status:source.status,message:source.statusMessage},after:{status,message},historyPreserved:true,noNetworkFetch:true}});
    return 1;
  });
  return {updated};
}
