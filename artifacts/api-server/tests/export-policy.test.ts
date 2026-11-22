import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { assessExport, publicationRelationship } from "../src/modules/export-rights";
import { exportRecords, formatExport, type ExportContext, type ExportRow, type ExportOptions } from "../src/modules/export-dataset";
import { exportBundleContent } from "../src/modules/export-bundle";
import { buildXlsxExport } from "../src/modules/export-xlsx";
import { supportedGovernmentConditions } from "../src/ingestion/license-evidence";
import ExcelJS from "exceljs";

const now = new Date("2026-11-01T12:00:00Z");
function fixture(license: string) {
  const id = randomUUID(), sourceId = randomUUID(), publicationId = randomUUID();
  const sourceUrl = `https://example.org/data/${publicationId}`, datasetUrl = `https://example.org/dataset/${sourceId}`;
  const review = { status:"verified", license, sourceUrl:`https://example.org/meta/${sourceId}`, recordSourceUrlPrefix:sourceUrl,
    datasetId:sourceId,datasetUrl,publisher:"Wydawca",licenseUrl:license === "ODbL-1.0" ? "https://opendatacommons.org/licenses/odbl/1-0/" :
      license === "CC0-1.0" ? "https://creativecommons.org/publicdomain/zero/1.0/" : "https://creativecommons.org/licenses/by/4.0/",
    authors:["Wydawca"],attribution:"Źródło: Wydawca",evidenceUrl:`https://example.org/meta/${sourceId}`,
    evidenceSha256:"a".repeat(64),reviewedAt:now.toISOString(),conditionsSha256:createHash("sha256").update("{}").digest("hex"),additionalTermsReviewed:true };
  const data = {name:"Rzeczywista struktura testowa — tylko w pamięci",address:"Testowa 1",city:"TEST",latitude:52.23,longitude:21.01,
    sourceName:"Wydawca",sourceUrl,license,sourceCategory:"UNKNOWN",qualityScore:50};
  const row = { original:{...data,id,imported:true,isDemo:false,publicImport:false,verificationStatus:"NOT_VERIFIED",
      organizationId:null,locationEvidence:{},createdAt:now,updatedAt:now},
    canonical:{id,verificationStatus:"NOT_VERIFIED",recordVerificationStatus:"UNVERIFIED",operationalStatus:"UNKNOWN",verifiedAt:null,sourceConflict:false,locationEvidence:{}},
    ref:{id:publicationId,sourceId,sourceRecordId:id,normalizedRecord:data,license,sourceUrl,publisher:"Wydawca",publisherId:null,
      datasetId:sourceId,datasetTitle:"Zbiór",datasetUrl,resourceId:"1",reuseConditions:{},provenanceEvidence:{},
      importedAt:now,lastSyncedAt:now,sourceModifiedAt:null,removedAt:null} } as unknown as ExportRow;
  const source = {id:sourceId,key:`test-${sourceId}`,name:"Wydawca",url:review.sourceUrl,datasetUrl,provenanceEvidence:{licenseReview:review}};
  return {row,source};
}
function context(items: ReturnType<typeof fixture>[]): ExportContext {
  const lineage = new Map<string,ExportRow[]>();
  for(const {row} of items)lineage.set(row.canonical.id,[...(lineage.get(row.canonical.id)??[]),row]);
  return {rows:items.map(i=>i.row),sourceRows:items.map(i=>i.source),
    providers:items.map(i=>({id:`source:${i.source.id}`,name:"Wydawca",kind:"source",status:"ready",license:i.row.ref!.license,recordCount:1})),
    lineage,rightsLoaded:true,licenseConflicts:new Set()} as ExportContext;
}
const options:ExportOptions = {scope:"review",licenses:["CC0-1.0","CC-BY-4.0","ODbL-1.0"],license:undefined,providerIds:undefined};
for(const license of options.licenses)test(`verified ${license} exports with attribution, evidence and field provenance`,()=>{
  const ctx=context([fixture(license)]),assessment=assessExport(ctx,options);
  assert.equal(assessment.recordCount,1);assert.equal(assessment.skippedRecordCount,0);
  const record=exportRecords(ctx,options,assessment)[0]!;
  assert.deepEqual(record.licenses,[license]);assert.equal(record.fieldProvenance![0]!.publicationId,ctx.rows[0]!.ref!.id);
  assert.ok(JSON.stringify(record.sources).includes("mandatoryAttributions"));
  const bundle=exportBundleContent(ctx,options,assessment);
  assert.equal(bundle.report.recordDecisions[0]!.decision,"EXPORTED");
  assert.ok(bundle.licensesText.includes(license));assert.ok(bundle.files["sources.csv"]!.includes("evidenceSha256"));
});
test("independent CC0, CC BY and ODbL records coexist without blanket blocking or relicensing",()=>{
  const ctx=context(options.licenses.map(fixture)),a=assessExport(ctx,options);
  assert.equal(a.recordCount,3);assert.equal(a.skippedRecordCount,0);
  assert.equal(a.reasons.some(r=>String(r.code)==="incompatible_odbl"),false);
  assert.equal(exportBundleContent(ctx,options,a).report.blanketLicense,null);
});
test("mixed ODbL/CC BY within one AED goes to review without blocking an unrelated ODbL record",()=>{
  const first=fixture("ODbL-1.0"),second=fixture("CC-BY-4.0"),clean=fixture("ODbL-1.0");
  second.row.canonical.id=first.row.canonical.id;
  const ctx=context([first,second,clean]),a=assessExport(ctx,options);
  assert.equal(a.recordCount,1);assert.equal(a.manualReviewCount,1);
  assert.ok(a.skipped.get(first.row.canonical.id)?.has("manual_review_required"));
  const filtered=assessExport(ctx,{...options,licenses:["ODbL-1.0"],providerIds:[`source:${first.source.id}`,`source:${clean.source.id}`]});
  assert.equal(filtered.recordCount,1);assert.equal(filtered.manualReviewCount,1);
});
test("CC0 plus CC BY preserves both obligations and does not invent a joint license",()=>{
  const first=fixture("CC0-1.0"),second=fixture("CC-BY-4.0");second.row.canonical.id=first.row.canonical.id;
  const ctx=context([first,second]),records=exportRecords(ctx,options);
  assert.equal(records.length,1);assert.equal(records[0]!.sources.length,2);
  assert.deepEqual(records[0]!.licenses,["CC-BY-4.0","CC0-1.0"]);
});
test("unknown rights and undeclared derivatives affect only their own records",()=>{
  const bad=fixture("UNKNOWN"),derived=fixture("ODbL-1.0"),good=fixture("CC0-1.0");
  derived.row.ref!.provenanceEvidence={derivedFrom:"unresolved-parent"};
  const a=assessExport(context([bad,derived,good]),options);
  assert.equal(a.recordCount,1);assert.equal(a.manualReviewCount,2);
});
test("official catalogue aliases are reported as republication rather than independent databases",()=>{
  const a=fixture("CC0-1.0"),b=fixture("CC-BY-4.0");
  for(const item of [a,b])item.row.ref!.provenanceEvidence={method:"official_api_dataset_resource_institution",datasetApiUrl:"https://api.dane.gov.pl/1.4/datasets/4581"};
  assert.equal(publicationRelationship([a.row,b.row]),"REPUBLICATION");
});
for(const license of options.licenses)test(`${license} without GPS exports INCOMPLETE in CSV, JSON and XLSX`,async()=>{
  const item=fixture(license);Object.assign(item.row.ref!.normalizedRecord!,{latitude:null,longitude:null});
  const ctx=context([item]),records=exportRecords(ctx,options);assert.equal(records.length,1);
  assert.equal(records[0]!.completenessStatus,"INCOMPLETE");assert.equal(records[0]!.latitude,null);
  assert.equal(JSON.parse(formatExport(records,"json"))[0].completenessStatus,"INCOMPLETE");
  assert.ok(formatExport(records,"csv").includes("INCOMPLETE"));
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load((await buildXlsxExport(ctx,options)).buffer as any);
  assert.equal(workbook.getWorksheet("AED")!.rowCount,2);
});
test("metadata automation never approves custom terms, personal-data conditions or conflicting declarations",()=>{
  assert.equal(supportedGovernmentConditions({license_name:"CC0 1.0",license_chosen:null,license_description:""}),true);
  assert.equal(supportedGovernmentConditions({license_name:"CC0 1.0",license_chosen:"CC BY 4.0"}),false);
  assert.equal(supportedGovernmentConditions({license_name:"CC BY 4.0",license_condition_personal_data:true}),false);
  assert.equal(supportedGovernmentConditions({license_name:"CC0 1.0",license_condition_custom_description:"Wymagana indywidualna zgoda"}),false);
});
test("a missing OSM object ID can cite the verified country export without losing ODbL permission",()=>{
  const item=fixture("ODbL-1.0"),url="https://openaedmap.org/api/v1/countries/PL.geojson";
  Object.assign(item.source,{key:"openaedmap",url,datasetUrl:url});
  Object.assign(item.row.ref!,{sourceUrl:url,datasetUrl:url,datasetId:"PL",resourceId:"openaedmap",
    publisher:"Współtwórcy OpenStreetMap / OpenAEDMap",provenanceEvidence:{method:"community_osm_export"}});
  assert.equal(assessExport(context([item]),options).recordCount,1);
  item.row.ref!.sourceUrl="https://aed.openstreetmap.org.pl/aed_poland.geojson";
  assert.equal(assessExport(context([item]),options).recordCount,1);
  item.row.ref!.sourceUrl="https://example.org/not-the-country-export";
  assert.equal(assessExport(context([item]),options).recordCount,0);
});
test("a missing coordinate axis is incomplete rather than an export prohibition",()=>{
  const item=fixture("CC0-1.0");item.row.ref!.normalizedRecord!.longitude=null;
  const records=exportRecords(context([item]),options);assert.equal(records.length,1);
  assert.equal(records[0]!.latitude,null);assert.equal(records[0]!.longitude,null);
  assert.equal(records[0]!.completenessStatus,"INCOMPLETE");
});

test("a source publication attached to a local AED never exports local application fields",()=>{
  const item=fixture("CC0-1.0");
  item.row.original.imported=false;
  item.row.original.verificationStatus="verified";
  item.row.original.name="Prywatna treść zgłoszenia w aplikacji";
  item.row.ref!.normalizedRecord!.name="Nazwa z publikacji źródłowej";
  const records=exportRecords(context([item]),options);
  assert.equal(records.length,1);
  assert.equal(records[0]!.name,"Nazwa z publikacji źródłowej");
  assert.equal(records[0]!.sources[0]!.data.name,"Nazwa z publikacji źródłowej");
  assert.ok(!JSON.stringify(records).includes("Prywatna treść zgłoszenia"));
});
