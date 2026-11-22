const locationErrors=new Set(["missing_coordinates","outside_poland","border_review","inconsistent_coordinate_axes"]);

/** A precise address result resolves a source-coordinate hold, not a legal or administrative hold. */
export function publicationAfterGeocoding(record:{
  publicImport:boolean;license:string;locationEvidence:Record<string,unknown>;
}):boolean{
  if(record.publicImport)return true;
  if(!record.license||record.license==="UNKNOWN"||
    !["source_import","source_recovery"].includes(String(record.locationEvidence.method)))return false;
  const issues=Array.isArray(record.locationEvidence.issues)
    ?record.locationEvidence.issues as Array<{rule?:string;severity?:string}>:[];
  const errors=issues.filter(issue=>issue.severity==="error");
  return errors.some(issue=>locationErrors.has(issue.rule??""))
    &&errors.every(issue=>locationErrors.has(issue.rule??""));
}
