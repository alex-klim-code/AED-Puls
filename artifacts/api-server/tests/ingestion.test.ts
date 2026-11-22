import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { normalizeRow, preserveOriginal, canonicalLicense, withinPoland, type SourceContext } from "../src/ingestion/normalize";
import { jsonRows, parseResource } from "../src/ingestion/parsers";
import { validateDownloadUrl } from "../src/ingestion/http";
import { governmentEvidence, officialEntityUrl } from "../src/ingestion/official";
import { connectSource } from "../src/ingestion/connectors";
import { openAedConfiguration } from "../src/ingestion/optional-connectors";
import { download } from "../src/ingestion/http";
import { resourceFingerprint } from "../src/ingestion/resource-identity";
import { governmentBatches } from "../src/ingestion/government";
import { coordinateLayoutHold } from "../src/ingestion/geographic-quality";

const context: SourceContext = { name: "Test źródła", publisher: "Wydawca testowy", license: "ODbL-1.0", url: "https://example.org/data", datasetUrl: "https://example.org", resourceId: "1", datasetId: "test", modified: null, coverage: "Polska" };
const feature = (properties: Record<string, unknown> = {}) => ({
  type: "Feature", geometry: { type: "Point", coordinates: [21.01, 52.23] },
  properties: { "@osm_id": 123, "@osm_type": "node", emergency: "defibrillator", ...properties },
});
test("normalization preserves OSM identity, attribution and honest unknown values", () => {
  const result = normalizeRow({ original: feature(), context });
  assert.equal(result.id, "test/node/123");
  assert.equal(result.data!.sourceUrl, "https://www.openstreetmap.org/node/123");
  assert.equal(result.data!.address, "");
  assert.equal(result.data!.city, "");
  assert.equal(result.data!.accessibility, "unknown");
  assert.equal(result.data!.operationalStatus, "unknown");
  assert.equal(result.data!.lastVerifiedAt, null);
  assert.ok(result.data!.qualityScore < 100);
});
test("hours alone do not assert public round-the-clock accessibility", () => {
  assert.equal(normalizeRow({ original: feature({ opening_hours: "24/7" }), context }).data!.accessibility, "limited");
  assert.equal(normalizeRow({ original: feature({ opening_hours: "24/7", access: "yes" }), context }).data!.accessibility, "24/7");
});
test("one malformed JSON row does not discard genuine incomplete AED records",()=>{
  const rows=jsonRows([{id:1,address:"Nowa 1"},null,"broken"]);
  assert.equal(rows.length,3);
  assert.equal(normalizeRow({original:rows[0]!,context}).data!.address,"Nowa 1");
  assert.equal(normalizeRow({original:rows[1]!,context}).data,null);
  assert.equal(rows[1]!._aedPulsOriginalValue,null);
});
test("CSV rows missing trailing location columns remain processable",async()=>{
  const rows=await parseResource(Buffer.from("id;name;address;city;latitude;longitude\n1;AED;Nowa 1;Warszawa\n"),"csv");
  assert.equal(rows.length,1);
  const record=normalizeRow({original:rows[0]!,context});
  assert.equal(record.data!.latitude,null);assert.equal(record.data!.address,"Nowa 1");
});
test("missing, invalid and foreign coordinates never become public map points", () => {
  for (const coords of [[], ["x", "y"], [100, 12], [14.4, 50.08]]) {
    const row = feature(); row.geometry.coordinates = coords as any;
    const result = normalizeRow({ original: row, context });
    assert.notEqual(result.data, null);
    assert.equal(result.data!.latitude, null);
    assert.equal(result.data!.longitude, null);
    assert.ok(result.issues.some(i => ["missing_coordinates","outside_poland","border_review"].includes(i.rule)));
  }
  assert.equal(withinPoland(52.23, 21.01), true);
  assert.equal(withinPoland(50.08, 14.4), false);
});
test("missing licenses and invalid dates are explicit quality problems", () => {
  const result = normalizeRow({ original: feature({ check_date: "2025-02-31" }), context: { ...context, license: "UNKNOWN" } });
  assert.equal(result.data!.lastVerifiedAt, null);
  assert.ok(result.issues.some(i => i.rule === "invalid_date"));
  assert.ok(result.issues.some(i => i.rule === "missing_license" && i.severity === "error"));
});
test("normalization never invents a date of physical verification", () => {
  const result = normalizeRow({ original: feature({ check_date: "2024-03-05" }), context });
  assert.equal(result.data!.lastVerifiedAt?.toISOString(), "2024-03-05T00:00:00.000Z");
  assert.equal("verificationStatus" in result.data!, false);
});
test("Unicode truncation cannot split an emoji into invalid JSON for PostgreSQL", () => {
  const result = normalizeRow({ original: feature({ name: "a".repeat(159) + "🚑" }), context });
  assert.equal(result.data!.name.length, 159);
  assert.equal(JSON.stringify(result.data).includes("\\ud83d"), false);
  const raw = { attribute: "\ud800", other: "literal\0value" };
  const encoded = preserveOriginal(raw);
  assert.equal(encoded.encoding, "json-string");
  assert.deepEqual(JSON.parse(String(encoded.payload)), raw);
});
test("licenses are recognized, not guessed or silently converted", () => {
  assert.equal(canonicalLicense("CC0 1.0"), "CC0-1.0");
  assert.equal(canonicalLicense("https://dane.przemysl.eu/creative-commons-cc-by-4-0/"), "CC-BY-4.0");
  assert.equal(canonicalLicense("ODbL 1.0"), "ODbL-1.0");
  assert.equal(canonicalLicense("public data"), "UNKNOWN");
});
test("source identifiers remain stable when rows are reordered", () => {
  const a = normalizeRow({ original: { id: 5, latitude: 52.23, longitude: 21.01 }, context });
  const b = normalizeRow({ original: { longitude: 21.01, id: 5, latitude: 52.23 }, context });
  assert.equal(a.id, b.id);
  assert.equal(normalizeRow({original:{name:"AED",latitude:52.23,longitude:21.01},context}).id,
    normalizeRow({original:{longitude:21.01,latitude:52.23,name:"AED"},context}).id);
});
test("more detailed Polish boundary recovers real border-city points without inventing coordinates",()=>{
  for(const [lon,lat]of [[16.6715794,50.1889909],[22.8135613,49.7242277],[14.2744842,53.8948134],[18.2664851,49.9814162]]){
    const point=feature();point.geometry.coordinates=[lon!,lat!];
    const normalized=normalizeRow({original:point,context});
    assert.ok(normalized.data,JSON.stringify({lon,lat,issues:normalized.issues}));
    assert.equal(normalized.data.longitude,lon);assert.equal(normalized.data.latitude,lat);
    assert.equal(normalized.data.operationalStatus,"unknown");
    assert.ok(normalized.issues.some(i=>i.rule==="missing_city"));
  }
});
test("ambiguous coastal points remain held for review, not falsely asserted foreign or verified",()=>{
  const point=feature();point.geometry.coordinates=[18.6708565,54.6980914];
  const result=normalizeRow({original:point,context});
  assert.equal(result.data!.latitude,null);assert.equal(result.data!.longitude,null);assert.ok(result.issues.some(i=>i.rule==="border_review"));
});
test("official Warsaw key/value and CKAN records parse as records, never as invented locations",()=>{
  const raw={values:[{key:"lat",value:"52.23"},{key:"lon",value:"21.01"}]};
  const [record]=jsonRows({result:[raw]});assert.deepEqual(record,raw);
  assert.equal(normalizeRow({original:record!,context}).data!.latitude,52.23);
  assert.equal(jsonRows({result:{records:[{id:5}]}})[0]!.id,5);
  assert.equal(normalizeRow({original:jsonRows({result:{records:[{id:5}]}})[0]!,context}).data!.latitude,null);
});
test("copy fingerprints ignore file row and property order, not differences between devices",()=>{
  const a=[{id:1,lat:52.23,lon:21.01},{id:2,lat:52.24,lon:21.02}];
  const b=[{lon:21.02,lat:52.24,id:2},{lon:21.01,lat:52.23,id:1}];
  assert.equal(resourceFingerprint(a),resourceFingerprint(b));
  assert.notEqual(resourceFingerprint(a),resourceFingerprint([{...a[0],serial:"different-device"}]));
});
test("OpenAED remains unconfigured without documented Poland scope, even with a token",()=>{
  assert.equal(openAedConfiguration({}).ready,false);
  const env={OPENAED_API_TOKEN:"test-token-not-a-secret",OPENAED_API_BASE_URL:"https://example.org",
    OPENAED_PL_CONFIRMED:"true",OPENAED_PL_EVIDENCE_URL:"https://example.org/documentation"};
  assert.equal(openAedConfiguration({...env,OPENAED_PL_CONFIRMED:"false"}).ready,false);
  assert.equal(openAedConfiguration({...env,OPENAED_API_BASE_URL:"https://nl.api.openaed.eu"}).ready,false);
  assert.equal(openAedConfiguration({...env,OPENAED_API_BASE_URL:"https://example.org?token=not-secret"}).ready,false);
  assert.equal(openAedConfiguration(env).ready,true);
});
test("Bearer credentials are not forwarded to a redirect on another origin",async()=>{
  const originalFetch=globalThis.fetch,calls:string[]=[];
  globalThis.fetch=(async(url:any,options:any)=>{
    calls.push(String(url));assert.equal(options.headers.Authorization,"Bearer test-only-not-a-secret");
    return new Response(null,{status:302,headers:{location:"https://www.wikipedia.org/other"}});
  }) as typeof fetch;
  try{
    await assert.rejects(download("https://example.org/test",{attempts:1,bearerToken:"test-only-not-a-secret"}),/innej domeny/);
    assert.equal(calls.length,1);
  }finally{globalThis.fetch=originalFetch;}
});
test("government discovery reads the original publisher and falls back from catalogue HTML to a real file",async()=>{
  const originalFetch=globalThis.fetch;
  const dataset={id:"10",type:"dataset",attributes:{title:"AED — test katalogu",license_name:"CC BY 4.0"},
    relationships:{institution:{data:{id:"20",type:"institution"}}}};
  const institution={id:"20",type:"institution",attributes:{title:"Oryginalny wydawca",institution_type:"local"}};
  const resource={id:"30",type:"resource",attributes:{format:"JSON",file_url:"https://example.org/catalogue",
    download_url:"https://example.org/file.json"},relationships:{dataset:{data:{id:"10",type:"dataset"}}}};
  globalThis.fetch=(async(url:any)=>{
    const path=new URL(String(url)).pathname;
    const body=path==="/1.4/datasets/10"?{data:dataset}:path==="/1.4/institutions/20"?{data:institution}:
      path==="/1.4/datasets/10/resources"?{data:[resource]}:path==="/file.json"?[feature()]:null;
    return new Response(body?JSON.stringify(body):"<html>Katalog, nie dane AED</html>",{status:200});
  })as typeof fetch;
  try{
    const packets=[];for await(const p of governmentBatches(context,{datasetId:"10",probe:true}))packets.push(p);
    const data=packets.find(p=>p.rows.length)!;
    assert.ok(data);assert.equal(data.context.publisher,"Oryginalny wydawca");
    assert.equal(data.context.license,"CC-BY-4.0");assert.equal(data.context.url,"https://example.org/file.json");
    assert.equal(data.context.sourceCategory,"OFFICIAL_GOV_PL");
    assert.ok(packets.some(p=>p.issue?.rule==="dataset_discovered"));
    assert.equal(normalizeRow({original:data.rows[0]!,context:data.context}).data!.operationalStatus,"unknown");
  }finally{globalThis.fetch=originalFetch;}
});
test("CSV handles BOM, Polish column aliases, semicolons and quoted multiline fields", async () => {
  const rows = await parseResource(Buffer.from('\uFEFFNumer Id;Długość geograficzna;Szerokość geograficzna;Nazwa;Adres\n1;21.01;52.23;"AED\nwewnątrz";"ul. Testowa 1"'), "csv");
  const normalized = normalizeRow({ original: rows[0]!, context });
  assert.equal(normalized.data!.latitude, 52.23);
  assert.equal(normalized.data!.longitude, 21.01);
  assert.equal(normalized.data!.address, "ul. Testowa 1");
});
test("municipal single-cell CSV rows retain originals and expose actual coordinates in CSV and XLSX",async()=>{
  const header="Długość geograficzna,Szerokość geograficzna, Nazwa, Lokalizacja, Adres, Numer Id";
  const line='21.10,52.33,AED,Recepcja,"ul. Testowa, 2",7';
  const wrapped=[header,line].map(v=>`"${v.replace(/"/g,'""')}"`).join("\n");
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("AED");sheet.addRow([header]);sheet.addRow([line]);
  const csv=await parseResource(Buffer.from(wrapped),"csv");
  const xlsx=await parseResource(Buffer.from(await book.xlsx.writeBuffer()),"xlsx");
  assert.equal(resourceFingerprint(csv),resourceFingerprint(xlsx));
  for(const rows of[csv,xlsx]){
    const normalized=normalizeRow({original:rows[0]!,context});
    assert.equal(normalized.data!.latitude,52.33);assert.equal(normalized.data!.longitude,21.10);
    assert.equal(normalized.data!.address,"ul. Testowa, 2");assert.equal(normalized.id,"test/7");
    assert.equal(rows[0]!._aedPulsOriginalRow[header],line);
  }
  const unknown=await parseResource(Buffer.from(["notes",'"one address, no GPS"'].join("\n")),"csv");
  assert.equal(normalizeRow({original:unknown[0]!,context}).data!.latitude,null);
});
test("mixed or reversed flat-file axes hold the whole dataset instead of fabricating corrected locations",()=>{
  const rows=[{latitude:21.10,longitude:52.32},{latitude:21.11,longitude:52.33},{latitude:49.71,longitude:21.72}];
  const reason=coordinateLayoutHold(rows);assert.match(reason!,/2 z 3/);
  for(const original of rows){const normalized=normalizeRow({original,context:{...context,coordinateHoldReason:reason}});assert.equal(normalized.data!.latitude,null);assert.equal(normalized.data!.longitude,null);}
  assert.equal(coordinateLayoutHold([{latitude:52.23,longitude:21.01},{latitude:52.24,longitude:21.02}]),undefined);
  assert.equal(coordinateLayoutHold([feature(),feature()]),undefined);
});
test("GeoJSON and flat JSON are parsed without accepting unrelated response shapes", async () => {
  assert.equal((await parseResource(Buffer.from(JSON.stringify({ type: "FeatureCollection", features: [feature()] })), "geojson")).length, 1);
  assert.equal(jsonRows([{ id: 1 }]).length, 1);
  assert.throws(() => jsonRows({ error: "Bad Gateway" }));
  await assert.rejects(parseResource(Buffer.from("<html>not data</html>"), "json"));
  await assert.rejects(parseResource(Buffer.from(""), "pdf"));
});
test("XLSX imports cell values without executing formulas", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("AED");
  sheet.addRow(["id", "latitude", "longitude", "name"]);
  sheet.addRow([1, 52.23, 21.01, "Testowy AED"]);
  const rows = await parseResource(Buffer.from(await book.xlsx.writeBuffer()), "xlsx");
  assert.equal(rows[0]!.latitude, 52.23);
  assert.equal(rows[0]!.name, "Testowy AED");
});
test("download URL validation blocks local destinations and embedded credentials", async () => {
  for (const url of ["http://example.org/a", "https://127.0.0.1/a", "https://[::1]/a", "https://user:password@example.org/a", "https://example.org:8080/a"]) {
    await assert.rejects(validateDownloadUrl(url));
  }
});
test("official provenance requires an actual matching dataset, resource and publisher identity", () => {
  const dataset = { id: "10", type: "dataset", relationships: { institution: { data: { id: "20" } } } };
  const resource = { id: "30", type: "resource", relationships: { dataset: { data: { id: "10" } } } };
  const publisher = { id: "20", type: "institution", attributes: { title: "Testowy wydawca", institution_type: "local" } };
  assert.equal(governmentEvidence(dataset, resource, publisher).publisherId, "20");
  assert.throws(() => governmentEvidence(dataset, resource, { ...publisher, id: "21" }));
  assert.throws(() => governmentEvidence(dataset, { ...resource, relationships: { dataset: { data: { id: "99" } } } }, publisher));
  assert.throws(() => officialEntityUrl("https://example.org/gov/datasets/10", "datasets", "10"));
  assert.throws(() => officialEntityUrl("https://api.dane.gov.pl.attacker.test/1.4/datasets/10", "datasets", "10"));
  assert.equal(officialEntityUrl("https://api.dane.gov.pl/1.4/datasets/10,test", "datasets", "10"), "https://api.dane.gov.pl/1.4/datasets/10,test");
});
test("official source category never turns an imported operational claim into device evidence", () => {
  const result = normalizeRow({ original: feature({ operational_status: "operational", check_date: "2025-01-01" }),
    context: { ...context, sourceCategory: "OFFICIAL_GOV_PL" } });
  assert.equal(result.data!.sourceCategory, "OFFICIAL_GOV_PL");
  assert.equal(result.data!.operationalStatus, "unknown");
  assert.equal("verifiedAt" in result.data!, false);
  assert.equal("verificationEvidence" in result.data!, false);
});
test("national OSM fallback retains source IDs and community classification", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return String(url).includes("openaedmap.org")
      ? new Response("not available", { status: 503 })
      : new Response(JSON.stringify({ type: "FeatureCollection", features: [feature()] }), { status: 200 });
  }) as typeof fetch;
  try {
    const packets = [];
    for await (const packet of connectSource("openaedmap")) packets.push(packet);
    assert.ok(packets.some(p => p.issue?.rule === "fallback_source"));
    const data = packets.find(p => p.rows.length)!;
    assert.equal(data.context.sourceCategory, "COMMUNITY_OPEN_DATA");
    assert.equal(data.context.provenanceEvidence?.fallbackUsed, true);
    assert.equal(normalizeRow({ original: data.rows[0]!, context: data.context }).id, "PL/node/123");
    assert.ok(calls.includes("https://aed.openstreetmap.org.pl/aed_poland.geojson"));
  } finally { globalThis.fetch = originalFetch; }
});
