import type { sources } from "@workspace/db";
import type { Issue, Normalized } from "./normalize";

export const locationReviewRules = ["outside_poland","border_review","inconsistent_coordinate_axes"] as const;
export const requiresLocationReview = (issues:Issue[]) => issues.some(i=>locationReviewRules.some(rule=>rule===i.rule));
export function recordCompleteness(data:Normalized) {
  return data.latitude!==null&&data.longitude!==null&&
    [data.name,data.address,data.city,data.license].every(v=>v.trim()&&!/^unknown$/i.test(v)) ? "COMPLETE" : "INCOMPLETE";
}

export const counters=()=>({processed:0,imported:0,updated:0,skipped:0,errors:0});
export function diagnostics(source:typeof sources.$inferSelect,jobId:string,counts=counters()){
  return{source,jobId,counts,validRecords:0,duplicates:0,transportFailures:0,lastError:"",
    recordStatuses:{complete:0,incomplete:0,locationReview:0,unparseable:0},
    issues:new Map<string,Issue&{count:number}>()};
}
export type RunDiagnostics=ReturnType<typeof diagnostics>;
export function addIssue(run:RunDiagnostics,issue:Issue){
  const key=`${issue.severity}:${issue.rule}`,old=run.issues.get(key);
  run.issues.set(key,{...issue,count:(old?.count??0)+1});
  if(issue.severity==="error")run.lastError=issue.message;
}
export function diagnosticSummary(run:RunDiagnostics){
  return{validRecords:run.validRecords,duplicates:run.duplicates,transportFailures:run.transportFailures,
    recordStatuses:run.recordStatuses,errorSummary:[...run.issues.values()]};
}
