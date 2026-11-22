import test from "node:test";
import assert from "node:assert/strict";
import { childCompletionStatus,sourceCompletionMessage } from "../src/ingestion/completion-status";
import { diagnostics,addIssue,recordCompleteness,requiresLocationReview } from "../src/ingestion/sync-diagnostics";
import { normalizeRow,type SourceContext } from "../src/ingestion/normalize";

const context:SourceContext={name:"Test",publisher:"Test",url:"https://example.org/private",datasetUrl:"https://example.org/private",
  datasetId:"test",resourceId:"test",license:"UNKNOWN",coverage:"Polska",modified:null};
test("outside-country data is retained for review rather than dropped or silently moved",()=>{
  const original={id:"test",name:"TEST",latitude:48.85,longitude:2.35};
  const r=normalizeRow({original,context});
  assert.ok(r.data);assert.equal(r.data.latitude,null);assert.equal(r.data.longitude,null);
  assert.ok(requiresLocationReview(r.issues));assert.equal(recordCompleteness(r.data),"INCOMPLETE");
  assert.equal(original.latitude,48.85);assert.equal(original.longitude,2.35);
});
test("fully received data is downloaded even when all records require validation",()=>{
  assert.equal(childCompletionStatus(8,0),"succeeded");
  assert.equal(childCompletionStatus(8,1),"partial");
  assert.equal(childCompletionStatus(0,1),"unavailable");
  assert.equal(childCompletionStatus(8,0,true),"interrupted");
});
test("download errors cannot be obscured by a later coordinate warning",()=>{
  const run=diagnostics({} as never,"test");run.counts.processed=100;
  addIssue(run,{rule:"resource_failed",severity:"error",message:"Warszawa: przekroczono czas pobierania"});
  addIssue(run,{rule:"outside_poland",severity:"error",message:"Współrzędne poza Polską"});
  const m=sourceCompletionMessage(run,"partial");
  assert.match(m,/Problemy walidacji danych: 1/);assert.match(m,/błędy pobierania lub zapisu: 1/);
  assert.match(m,/Problem pobierania: Warszawa/);assert.doesNotMatch(m,/Ostatni problem/);
});
