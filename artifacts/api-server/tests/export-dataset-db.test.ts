import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { eq, inArray } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import { db, pool, aeds, sources, observations, organizations, users, dataConflicts } from "@workspace/db";
import { buildApp } from "../src/app";
import { exportFields, exportSchemaVersion,exportContext,exportRecords,formatExport } from "../src/modules/export-dataset";
import { buildXlsxExport } from "../src/modules/export-xlsx";
import { assessExport } from "../src/modules/export-rights";

// All test AEDs remain private/pending. No import, approval or modification of real AEDs.
test("selected-provider downloads preserve one uniform record per AED",async t=>{
  const app=await buildApp(),actor=randomUUID(),org=randomUUID();
  const ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID(),randomUUID()];
  const [a,b,application,organization,unknown]=ids as [string,string,string,string,string];
  const src=[randomUUID(),randomUUID(),randomUUID()],obs=[randomUUID(),randomUUID()];
  const pa=`source:${src[0]}`,pb=`source:${src[1]}`,pe=`source:${src[2]}`,po=`organization:${org}`;
  let role="ADMIN",signedIn=true,fixture:typeof users.$inferSelect;
  app.addHook("preHandler",async req=>{if(signedIn&&fixture)req.account={...fixture,role};});
  const query=(providers:string[],scope="review")=>new URLSearchParams({scope,providerIds:providers.join(",")}).toString();
  // Separate bulk format checks from direct authorization probes without weakening production limits.
  const get=async(path:string,providers:string[],scope="review")=>app.inject({remoteAddress:"127.0.0.2",url:`/api/${path}?${query(providers,scope)}`});
  const norm=(name:string,license:string,url:string)=>({
    name,address:"Testowa 1",city:"TEST",latitude:52.23,longitude:21.01,country:"PL",
    description:null,placement:"unknown",accessibility:"unknown",openingHours:null,
    sourceName:name,sourceUrl:url,license,sourceCategory:"COMMUNITY_OPEN_DATA",qualityScore:65,qualityIssues:[],
    sourceOperationalClaim:"OPERATIONAL",
  });
  const da=norm('Źródło A, "hol"\nwejście',"CC0-1.0","https://example.org/export-a");
  const dbb=norm("Dane wyłącznie dostawcy B","CC-BY-4.0","https://example.org/export-b");
  const conditionsA={attribution:"Autor danych testowych A"};
  const review=(license:string,url:string,conditions:unknown)=>({
    status:"verified",license,sourceUrl:"https://example.org/test",recordSourceUrlPrefix:url,datasetId:"TEST",
    datasetUrl:"https://example.org/dataset",publisher:"TEST",licenseUrl:license==="CC0-1.0"?"https://creativecommons.org/publicdomain/zero/1.0/":
      license==="ODbL-1.0"?"https://opendatacommons.org/licenses/odbl/1-0/":"https://creativecommons.org/licenses/by/4.0/",
    authors:["Wydawca testowy"],attribution:"Źródło: Wydawca testowy. Wyłącznie prywatny test.",
    evidenceUrl:"https://example.org/license",evidenceSha256:"e".repeat(64),reviewedAt:"2026-11-20T00:00:00.000Z",
    conditionsSha256:createHash("sha256").update(JSON.stringify(conditions)).digest("hex"),additionalTermsReviewed:true,
  });
  try{
    await db.insert(organizations).values({id:org,name:"Niepubliczna organizacja testu eksportu",isDemo:false});
    [fixture!]=await db.insert(users).values({id:actor,name:"Niepubliczny test eksportu",role:"ADMIN",isDemo:false}).returning();
    await db.insert(sources).values(src.map((id,i)=>({id,key:`test-export-${id}`,name:`Niepubliczne źródło eksportu ${i}`,
      url:"https://example.org/test",license:i===1?"CC-BY-4.0":i===0?"CC0-1.0":"ODbL-1.0",coverage:"TEST",institution:"TEST",
      datasetId:"TEST",updateFrequency:"TEST",authoritativeScope:"TEST",statusMessage:"TEST",
      provenanceEvidence:i<2?{licenseReview:review(i===0?da.license:dbb.license,i===0?da.sourceUrl:dbb.sourceUrl,i===0?conditionsA:{})}:{}})));
    await db.insert(aeds).values(ids.map((id,i)=>({
      id,name:`Niepubliczne AED eksportu ${i}`,address:"Testowa 1",city:"TEST",latitude:52.23,longitude:21.01,
      sourceName:"TEST",sourceUrl:"https://example.org/test",license:i===4?"UNKNOWN":"CC0-1.0",
      imported:i<2,publicImport:false,isDemo:false,verificationStatus:i<2?"unverified":"pending",
      mergedIntoId:i===1?a:null,organizationId:i===3?org:null,
    })));
    await db.insert(observations).values([
      {id:obs[0],aedId:a,sourceId:src[0],sourceRecordId:"source-a",sourceUrl:da.sourceUrl,license:da.license,
        originalRecord:{test:true},normalizedRecord:da,reuseConditions:conditionsA,publisher:"TEST",datasetId:"TEST",datasetUrl:"https://example.org/dataset"},
      {id:obs[1],aedId:b,sourceId:src[1],sourceRecordId:"source-b",sourceUrl:dbb.sourceUrl,license:dbb.license,
        originalRecord:{test:true},normalizedRecord:dbb,publisher:"TEST",datasetId:"TEST",datasetUrl:"https://example.org/dataset"},
    ]);
    await t.test("catalog includes sources, app and actual organizations with overlapping counts",async()=>{
      const response=await app.inject({url:"/api/export-providers?scope=review"});
      assert.equal(response.statusCode,200,response.body);
      const list=response.json();
      assert.equal(list.find((p:any)=>p.id===pa).recordCount,1);
      assert.equal(list.find((p:any)=>p.id===pb).recordCount,1);
      assert.equal(list.find((p:any)=>p.id===pe).recordCount,0);
      assert.equal(list.find((p:any)=>p.id===po).recordCount,1);
      assert.ok(list.some((p:any)=>p.id==="aed-puls"&&p.kind==="application"));
    });
    await t.test("two selected sources give one AED with both attributed publications",async()=>{
      const response=await get("exports/json",[pa,pb]);
      assert.equal(response.statusCode,200,response.body);
      const records=response.json();assert.equal(records.length,1);
      const record=records[0];assert.equal(record.id,a);assert.equal(record.sources.length,2);
      assert.deepEqual(record.providerIds.sort(),[pa,pb].sort());
      assert.deepEqual(record.licenses,["CC-BY-4.0","CC0-1.0"]);
      assert.equal(record.name,da.name);assert.equal(record.license,da.license);
      assert.equal(record.sources.find((s:any)=>s.providerId===pb).data.name,dbb.name);
      const reuse=record.sources.find((s:any)=>s.providerId===pa).reuseConditions;
      assert.equal(reuse.attribution,conditionsA.attribution);
      assert.equal(reuse.mandatoryAttributionCannotBeDisabled,true);assert.equal(reuse.mandatoryAttributions.length,2);
      assert.equal(record.operationalStatus,"UNKNOWN");assert.equal(record.recordVerificationStatus,"UNVERIFIED");
      assert.equal(record.sourceOperationalClaim,"OPERATIONAL");
    });
    await t.test("secondary provider excludes unselected data but cannot erase mandatory legal lineage",async()=>{
      const response=await get("exports/json",[pb]);
      const [record]=response.json();assert.equal(record.id,a);assert.equal(record.name,dbb.name);
      assert.equal(record.sourceUrl,dbb.sourceUrl);assert.equal(record.license,dbb.license);
      assert.deepEqual(record.providerIds,[pb]);assert.equal(record.sources.length,1);
      assert.deepEqual(record.licenses,["CC-BY-4.0","CC0-1.0"]);assert.equal(record.sources[0].providerId,pb);
      assert.ok(response.body.includes(da.sourceUrl));
      assert.ok(!record.sources.some((s:any)=>s.data.name===da.name));
    });
    await t.test("app and organization stay separate; declarations alone do not grant export rights",async()=>{
      const appOnly=(await get("export-preview",["aed-puls"])).json();
      assert.ok(appOnly.candidateRecordCount>=2);assert.equal(appOnly.recordCount,0);
      assert.ok(appOnly.reasons.some((r:any)=>r.code==="unknown_license"));
      const orgOnly=(await get("export-preview",[po])).json();
      assert.equal(orgOnly.candidateRecordCount,1);assert.equal(orgOnly.recordCount,0);
      assert.deepEqual(orgOnly.providerIds,[po]);
      assert.equal((await get("exports/json",[po])).statusCode,422);
    });
    await t.test("CSV, JSON and GeoJSON have identical property sets and correctly encoded values",async()=>{
      const json=await get("exports/json",[pa,pb]),csv=await get("exports/csv",[pa,pb]),geo=await get("exports/geojson",[pa,pb]);
      for(const [response,format] of [[json,"json"],[csv,"csv"],[geo,"geojson"]] as const){
        assert.equal(response.statusCode,200,response.body);
        assert.match(response.headers["content-disposition"]!,new RegExp(`\\.${format}"$`));
        assert.equal(response.headers["x-aed-record-count"],"1");assert.equal(response.headers["x-aed-schema-version"],exportSchemaVersion);
      }
      const [record]=json.json(),[line]=parse(csv.body,{columns:true,bom:true});
      assert.deepEqual(Object.keys(record).sort(),[...exportFields].sort());
      assert.deepEqual(Object.keys(line).sort(),[...exportFields].sort());
      assert.equal(line.name,record.name);assert.equal(Number(line.latitude),record.latitude);
      assert.deepEqual(JSON.parse(line.sources),record.sources);
      assert.deepEqual(JSON.parse(line.providerIds),record.providerIds);
      const feature=geo.json().features[0];
      assert.deepEqual(feature.properties,record);assert.deepEqual(feature.geometry.coordinates,[record.longitude,record.latitude]);
      assert.equal(geo.json().type,"FeatureCollection");
    });
    await t.test("XLSX contains identical typed AED fields, attribution, schema and validation report",async()=>{
      const response=await get("exports/xlsx",[pa,pb]),json=await get("exports/json",[pa,pb]);
      assert.equal(response.statusCode,200,response.body);
      assert.match(String(response.headers["content-type"]),/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
      assert.match(String(response.headers["content-disposition"]),/\.xlsx"$/);
      assert.equal(response.headers["x-aed-record-count"],"1");
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(response.rawPayload as any);
      const data=workbook.getWorksheet("AED")!;
      assert.equal(data.rowCount,2);
      assert.deepEqual((data.getRow(1).values as string[]).slice(1),[...exportFields]);
      const [record]=json.json();
      exportFields.forEach((field,index)=>{
        const value=data.getRow(2).getCell(index+1).value,expected=record[field];
        assert.deepEqual(expected!==null&&typeof expected==="object"?JSON.parse(value as string):value,expected,field);
      });
      assert.equal(workbook.getWorksheet("Źródła i licencje")!.rowCount,3);
      assert.ok(workbook.getWorksheet("Warunki")!.rowCount>5);
      assert.equal(workbook.getWorksheet("Standard danych")!.rowCount,exportFields.length+1);
      const fragments:string[]=[];workbook.getWorksheet("Raport walidacji")!.eachRow((row,index)=>{if(index>1)fragments.push(row.getCell(2).value as string);});
      const report=JSON.parse(fragments.join(""));
      assert.equal(report.exportedRecordCount,1);assert.equal(report.attributionRequired,true);
      assert.equal(report.blanketLicense,null);assert.equal(report.format,"XLSX");
      assert.ok(!("files" in report));
      assert.equal((await get("exports/xlsx",[po])).statusCode,422);
    });
    await t.test("preview counts unique AEDs rather than summing providers",async()=>{
      const response=await get("export-preview",[pa,pb]);assert.equal(response.statusCode,200,response.body);
      const preview=response.json();assert.equal(preview.recordCount,1);assert.equal(preview.publicationCount,2);
      assert.deepEqual(preview.fields,[...exportFields]);
      assert.deepEqual(preview.licenses,["CC-BY-4.0","CC0-1.0"]);
    });
    await t.test("license selection filters preview, metadata and every file format without relicensing",async()=>{
      const q=query([pa,pb])+"&license=CC-BY-4.0";
      const preview=(await app.inject({url:"/api/export-preview?"+q})).json();
      assert.equal(preview.recordCount,1);assert.equal(preview.publicationCount,1);
      assert.deepEqual(preview.licenses,["CC-BY-4.0","CC0-1.0"]);
      for(const format of ["json","csv","geojson","xlsx"]){
        const response=await app.inject({url:`/api/exports/${format}?${q}`});
        assert.equal(response.statusCode,200);
        let record:any;
        if(format==="xlsx"){
          const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(response.rawPayload as any);
          const sheet=workbook.getWorksheet("AED")!;
          record=Object.fromEntries(exportFields.map((key,index)=>[key,sheet.getRow(2).getCell(index+1).value]));
        }else record=format==="json"?response.json()[0]:format==="geojson"?response.json().features[0].properties:
          parse(response.body,{columns:true,bom:true})[0];
        assert.equal(record.license,"CC-BY-4.0");assert.equal(record.name,dbb.name);
        const publications=format==="csv"||format==="xlsx"?JSON.parse(record.sources):record.sources;
        assert.equal(publications.length,1);assert.equal(publications[0].providerId,pb);
        assert.equal(publications[0].data.license,"CC-BY-4.0");
      }
      const metadata=(await app.inject({url:"/api/metadata?"+q})).json();
      assert.deepEqual(metadata.licenses,["CC-BY-4.0","CC0-1.0"]);
      assert.ok(metadata.resources.every((r:any)=>new URL(r.url,"https://example.org").searchParams.get("licenses")==="CC-BY-4.0"));
      const empty=query([pb])+"&license=ODbL-1.0";
      assert.equal((await app.inject({url:"/api/export-preview?"+empty})).json().recordCount,0);
      assert.equal((await app.inject({url:"/api/exports/json?"+empty})).statusCode,422);
    });
    await t.test("metadata follows exactly the selected providers and describes the common schema",async()=>{
      const response=await get("metadata",[pb]);assert.equal(response.statusCode,200,response.body);
      const metadata=response.json();assert.equal(metadata.recordCount,1);
      assert.deepEqual(metadata.sourceReferences,[dbb.sourceUrl]);assert.deepEqual(metadata.providerIds,[pb]);
      assert.deepEqual(metadata.fields,[...exportFields]);
      assert.ok(metadata.resources.every((r:any)=>new URL(r.url,"https://example.org").searchParams.get("providerIds")===pb));
    });
    await t.test("private pending records never enter public or approved downloads",async()=>{
      for(const scope of ["public","approved"]){
        const preview=await get("export-preview",[pa],scope);assert.equal(preview.json().recordCount,0);
        const response=await get("exports/json",[pa],scope);assert.equal(response.statusCode,422);
        assert.equal(response.headers["content-disposition"],undefined);
      }
      const publicList=(await app.inject({url:"/api/export-providers?scope=public"})).json();
      assert.ok(!publicList.some((p:any)=>p.id===po));
    });
    await t.test("ZIP contains exactly four valid files and retained mandatory lineage, with verifiable counts",async()=>{
      const q=query([pb])+"&licenses=CC-BY-4.0&attribution=false&fields=id,name";
      const response=await app.inject({url:"/api/exports/zip?"+q});
      assert.equal(response.statusCode,200,response.body);
      assert.match(response.headers["content-type"]!,/^application\/zip/);
      assert.equal(response.headers["x-aed-record-count"],"1");
      const zip=await JSZip.loadAsync(response.rawPayload,{checkCRC32:true});
      assert.deepEqual(Object.keys(zip.files).sort(),["LICENSES.txt","aed_data.csv","sources.csv","validation_report.json"]);
      const report=JSON.parse(await zip.file("validation_report.json")!.async("string"));
      assert.equal(report.exportedRecordCount,1);assert.equal(report.skippedRecordCount,0);
      assert.equal(report.candidateRecordCount,report.exportedRecordCount+report.skippedRecordCount);
      assert.equal(report.requiredLineagePublicationCount,2);assert.equal(report.attributionRequired,true);
      assert.equal(report.blanketLicense,null);
      const data=parse(await zip.file("aed_data.csv")!.async("string"),{columns:true,bom:true});
      assert.equal(data.length,1);assert.deepEqual(Object.keys(data[0]).sort(),[...exportFields].sort());
      const credits=parse(await zip.file("sources.csv")!.async("string"),{columns:true,bom:true});
      assert.equal(credits.length,2);
      assert.equal(credits.find((s:any)=>s.providerId===pa).selectedDataPublication,"false");
      assert.equal(credits.find((s:any)=>s.providerId===pb).selectedDataPublication,"true");
      for(const c of credits){assert.ok(c.authors);assert.ok(c.sourceUrl);assert.ok(c.licenseUrl);assert.ok(c.attribution);}
      const notices=await zip.file("LICENSES.txt")!.async("string");
      assert.ok(notices.includes("Wydawca testowy"));assert.ok(notices.includes("Brak jednej wspólnej licencji"));
      for(const [name,file] of Object.entries(report.files) as [string,{sha256:string;bytes:number}][]){
        const bytes=await zip.file(name)!.async("nodebuffer");
        assert.equal(file.bytes,bytes.length);assert.equal(file.sha256,createHash("sha256").update(bytes).digest("hex"));
      }
    });
    await t.test("multiple licenses union publications; empty, unsupported and ambiguous filters are rejected",async()=>{
      const url="/api/export-preview?"+query([pa,pb]);
      const response=await app.inject({url:url+"&licenses=CC0-1.0,CC-BY-4.0,CC0-1.0"});
      assert.equal(response.statusCode,200,response.body);assert.equal(response.json().recordCount,1);
      assert.equal(response.json().publicationCount,2);
      assert.deepEqual(response.json().selectedLicenses,["CC-BY-4.0","CC0-1.0"]);
      for(const suffix of ["&licenses=","&licenses=UNKNOWN","&licenses=CC0-1.0,","&licenses=CC0-1.0&license=CC0-1.0"])
        assert.equal((await app.inject({url:url+suffix})).statusCode,400);
    });
    await t.test("unselected source cannot launder unknown or unverified rights; observation self-declarations are untrusted",async()=>{
      const proof={licenseReview:review(da.license,da.sourceUrl,conditionsA)};
      await db.update(sources).set({provenanceEvidence:{}}).where(eq(sources.id,src[0]!));
      await db.update(observations).set({provenanceEvidence:proof}).where(eq(observations.id,obs[0]!));
      try{
        const preview=(await get("export-preview",[pb])).json();
        assert.equal(preview.recordCount,0);assert.equal(preview.skippedRecordCount,1);
        assert.ok(preview.reasons.some((r:any)=>r.code==="unverified_license"));
        for(const f of ["csv","json","geojson"])assert.equal((await get("exports/"+f,[pb])).statusCode,422);
        const zipResponse=await get("exports/zip",[pb]);assert.equal(zipResponse.statusCode,200);
        assert.equal(zipResponse.headers["x-aed-record-count"],"0");
        const zip=await JSZip.loadAsync(zipResponse.rawPayload,{checkCRC32:true});
        const report=JSON.parse(await zip.file("validation_report.json")!.async("string"));
        assert.equal(report.exportedRecordCount,0);assert.equal(report.skippedRecordCount,1);
        assert.ok(report.skippedRecords[0].reasons.includes("unverified_license"));
        assert.equal(parse(await zip.file("aed_data.csv")!.async("string"),{columns:true,bom:true}).length,0);
        await db.update(observations).set({license:"UNKNOWN"}).where(eq(observations.id,obs[0]!));
        const unknown=(await get("export-preview",[pb])).json();
        assert.equal(unknown.recordCount,0);assert.ok(unknown.reasons.some((r:any)=>r.code==="unknown_license"));
      }finally{
        await db.update(sources).set({provenanceEvidence:proof}).where(eq(sources.id,src[0]!));
        await db.update(observations).set({license:da.license,provenanceEvidence:{}}).where(eq(observations.id,obs[0]!));
      }
    });
    await t.test("changes to reviewed conditions invalidate permission instead of silently discarding extra terms",async()=>{
      await db.update(observations).set({reuseConditions:{...conditionsA,additionalTerms:"New attribution"}}).where(eq(observations.id,obs[0]!));
      try{const p=(await get("export-preview",[pa])).json();assert.equal(p.recordCount,0);assert.ok(p.reasons.some((r:any)=>r.code==="unverified_license"));}
      finally{await db.update(observations).set({reuseConditions:conditionsA}).where(eq(observations.id,obs[0]!));}
    });
    await t.test("ODbL obligations survive filters; only unresolved mixed records need review",async()=>{
      await db.update(sources).set({license:"ODbL-1.0",provenanceEvidence:{licenseReview:review("ODbL-1.0",da.sourceUrl,conditionsA)}}).where(eq(sources.id,src[0]!));
      await db.update(observations).set({license:"ODbL-1.0",normalizedRecord:{...da,license:"ODbL-1.0"}}).where(eq(observations.id,obs[0]!));
      try{
        const p=await app.inject({url:"/api/export-preview?"+query([pb])+"&licenses=CC-BY-4.0"});
        assert.equal(p.json().recordCount,0);assert.ok(p.json().reasons.some((r:any)=>r.code==="manual_review_required"));
        // Independent AEDs must not be blocked merely because both licenses occur in one download.
        await db.update(aeds).set({mergedIntoId:null}).where(eq(aeds.id,b));
        const mixed=(await get("export-preview",[pa,pb])).json();
        assert.equal(mixed.candidateRecordCount,2);assert.equal(mixed.skippedRecordCount,0);assert.equal(mixed.recordCount,2);
        const alone=await get("exports/json",[pa]);assert.equal(alone.statusCode,200);
        assert.deepEqual(alone.json()[0].licenses,["ODbL-1.0"]);
      }finally{
        await db.update(aeds).set({mergedIntoId:a}).where(eq(aeds.id,b));
        await db.update(observations).set({license:da.license,normalizedRecord:da}).where(eq(observations.id,obs[0]!));
        await db.update(sources).set({license:da.license,provenanceEvidence:{licenseReview:review(da.license,da.sourceUrl,conditionsA)}}).where(eq(sources.id,src[0]!));
      }
    });
    await t.test("pending license conflicts block the whole family, even from an unselected merged child",async()=>{
      const conflict=randomUUID();
      await db.insert(dataConflicts).values({id:conflict,aedId:b,observationId:obs[1]!,field:"license",currentValue:"CC-BY-4.0",incomingValue:"UNKNOWN",status:"pending"});
      try{const p=(await get("export-preview",[pa])).json();assert.equal(p.recordCount,0);assert.ok(p.reasons.some((r:any)=>r.code==="conflicting_license"));}
      finally{await db.delete(dataConflicts).where(eq(dataConflicts.id,conflict));}
    });
    await t.test("Geoapify derivation blocks export even when that dependency is not selected",async()=>{
      const context=await exportContext("review",[pa]);
      const copy={...context,lineage:new Map(context.lineage)};
      copy.lineage.set(a,context.lineage.get(a)!.map(row=>({...row,
        canonical:{...row.canonical,locationEvidence:{geocodingDependency:{provider:"Geoapify",rightsStatus:"NOT_REVIEWED"}}}})));
      const assessment=assessExport(copy,{scope:"review",providerIds:[pa],licenses:["CC0-1.0"],license:undefined});
      assert.equal(assessment.recordCount,0);
      assert.ok(assessment.reasons.some(reason=>reason.code==="unverified_geocoding_rights"&&reason.recordCount===1));
    });
    await t.test("unlocated records keep null coordinates across machine-readable formats and XLSX",async()=>{
      const context=await exportContext("review",[pa]);
      const copy={...context,rows:context.rows.map(row=>({...row,ref:row.ref?{...row.ref,
        normalizedRecord:{...row.ref.normalizedRecord,latitude:null,longitude:null}}:null}))};
      const options={scope:"review" as const,providerIds:[pa],licenses:["CC0-1.0"],license:undefined};
      const records=exportRecords(copy,options);assert.equal(records.length,1);
      assert.equal(records[0]!.latitude,null);assert.equal(records[0]!.longitude,null);
      const geo=JSON.parse(formatExport(records,"geojson"));assert.equal(geo.features[0].geometry,null);
      assert.equal(JSON.parse(formatExport(records,"json"))[0].latitude,null);
      const [csv]=parse(formatExport(records,"csv"),{columns:true,bom:true});assert.equal(csv.latitude,"");
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.load((await buildXlsxExport(copy,options)).buffer as any);
      assert.equal(workbook.getWorksheet("AED")!.getRow(2).getCell(exportFields.indexOf("latitude")+1).value,null);
    });
    await t.test("private lineage cannot leak through a public export or be ignored",async()=>{
      const context=await exportContext("review",[pa]);
      const lineage=context.lineage.get(a)!;
      const child=lineage.find(r=>r.original.id===b)!;
      const copy={...context,lineage:new Map(context.lineage)};
      copy.lineage.set(a,lineage.map(r=>r===child?{...r,original:{...r.original,imported:false,verificationStatus:"pending"}}:r));
      const assessment=assessExport(copy,{scope:"public",providerIds:[pa],licenses:["CC0-1.0"],license:undefined});
      assert.equal(assessment.recordCount,0);assert.ok(assessment.reasons.some(r=>r.code==="unavailable_lineage"));
    });
    await t.test("unavailable and empty selections fail clearly rather than downloading fake or empty data",async()=>{
      const preview=await get("export-preview",[pe]);assert.equal(preview.json().recordCount,0);
      assert.ok(preview.json().warnings.length>0);
      const empty=await get("exports/csv",[pe]);assert.equal(empty.statusCode,422);
      assert.equal(empty.headers["content-disposition"],undefined);
      assert.equal((await get("exports/json",[`source:${randomUUID()}`])).statusCode,400);
      assert.equal((await app.inject({url:"/api/exports/json?scope=review&providerIds="})).statusCode,400);
      assert.equal((await get("exports/yaml",[pa])).statusCode,400);
      assert.equal((await get("exports/json",["source:bad-id"])).statusCode,400);
      assert.equal((await get("exports/json",[`${pa}:unexpected`])).statusCode,400);
    });
    await t.test("removed observations do not appear in the download",async()=>{
      await db.update(observations).set({removedAt:new Date()}).where(eq(observations.id,obs[1]!));
      try{
        const response=await get("exports/json",[pa,pb]);assert.equal(response.statusCode,200);
        assert.deepEqual(response.json()[0].providerIds,[pa]);
      }finally{await db.update(observations).set({removedAt:null}).where(eq(observations.id,obs[1]!));}
    });
    await t.test("invalid coordinates fail before any attachment headers or partial file are sent",async()=>{
      await db.update(observations).set({normalizedRecord:{...da,latitude:999}}).where(eq(observations.id,obs[0]!));
      try{
        const response=await get("exports/json",[pa]);assert.equal(response.statusCode,422,response.body);
        assert.equal(response.headers["content-disposition"],undefined);
      }finally{await db.update(observations).set({normalizedRecord:da}).where(eq(observations.id,obs[0]!));}
    });
    await t.test("CSV protects formulas without changing numeric coordinates",async()=>{
      await db.update(observations).set({normalizedRecord:{...da,name:'=HYPERLINK("https://example.org")'}}).where(eq(observations.id,obs[0]!));
      try{
        const response=await get("exports/csv",[pa]);assert.equal(response.statusCode,200);
        const [line]=parse(response.body,{columns:true,bom:true});
        assert.ok(line.name.startsWith("'="));assert.equal(line.latitude,"52.23");
      }finally{await db.update(observations).set({normalizedRecord:da}).where(eq(observations.id,obs[0]!));}
    });
    await t.test("review endpoints enforce authentication and ADMIN independently of the frontend",async()=>{
      role="PROVIDER";
      assert.equal((await get("exports/json",[pa])).statusCode,403);
      assert.equal((await get("export-preview",[pa])).statusCode,403);
      assert.equal((await app.inject({url:"/api/export-providers?scope=review"})).statusCode,403);
      signedIn=false;
      assert.equal((await get("exports/json",[pa])).statusCode,401);
      assert.equal((await get("export-preview",[pa])).statusCode,401);
      assert.equal((await app.inject({url:"/api/export-providers?scope=review"})).statusCode,401);
    });
  }finally{
    await app.close();
    await db.delete(observations).where(inArray(observations.aedId,ids));
    await db.delete(aeds).where(inArray(aeds.id,ids));
    await db.delete(sources).where(inArray(sources.id,src));
    await db.delete(users).where(eq(users.id,actor));
    await db.delete(organizations).where(eq(organizations.id,org));
    await pool.end();
  }
});
