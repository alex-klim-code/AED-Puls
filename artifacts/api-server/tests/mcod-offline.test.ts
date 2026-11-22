import assert from "node:assert/strict";
import { test } from "node:test";
import { createMcodClient,McodError } from "../src/integrations/mcod/client";
import type { ContractBinding } from "../src/integrations/mcod/contracts";
import { assessPublication,renderPublication,planKey,type SnapshotRow } from "../src/integrations/mcod/publication-format";

// Entirely synthetic, in-process transports. These are NOT actual MCOD contracts.
const env={MCOD_API_ENABLED:"true",MCOD_WRITE_ENABLED:"true",MCOD_SYNC_ENABLED:"true",AED_INTEGRATION_SECRET:"synthetic-unit-value"};
const code=(expected:string)=>(e:unknown)=>e instanceof McodError&&e.code===expected;
const binding=(method:ContractBinding["method"],decode:ContractBinding["decode"]=(x)=>x):ContractBinding=>({
  method,evidence:{specSha256:"a".repeat(64),reviewedAt:"2026-01-01T00:00:00Z"},
  encode:(input)=>({path:`/api/integrations/aed/unit-fixture?page=${input.page??1}`}),decode,
});
test("every remote method fails closed, even with write/sync/legacy flags true",async()=>{
  let calls=0;
  const client=createMcodClient({...env,MCOD_API_ENABLED:"false",MCOD_INTEGRATION_ENABLED:"true"},async()=>{calls++;throw new Error();});
  const operations=[
    ()=>client.inspectContract(),()=>client.getInstitutions(),()=>client.getInstitution("1"),
    ()=>client.createInstitution({} as never),()=>client.getDatasets({institutionId:"1"}),
    ()=>client.createDataset({} as never),()=>client.getResources({institutionId:"1",datasetId:"2"}),
    ()=>client.getResource("3","1"),()=>client.createResource({} as never),()=>client.updateResource("3",{} as never),
    ()=>client.publishResource("3",{} as never),()=>client.publishDataset("2",{} as never),
    ()=>client.downloadResource("3","1"),()=>client.syncAedFromMcod(async()=>{}),
    async()=>{for await(const _ of client.allPages("getInstitutions",{}))assert.fail("must not yield");},
  ];
  for(const action of operations)await assert.rejects(action(),code("MCOD_DISABLED"));
  assert.equal(calls,0);
  assert.equal(client.status().writesEnabled,false);assert.equal(client.status().syncEnabled,false);
});
test("independent write/sync flags and unconfirmed contracts prevent all I/O",async()=>{
  let calls=0;const transport:typeof fetch=async()=>{calls++;throw new Error();};
  const client=createMcodClient({...env,MCOD_WRITE_ENABLED:"false",MCOD_SYNC_ENABLED:"false"},transport);
  await assert.rejects(client.createDataset({} as never),code("MCOD_WRITE_DISABLED"));
  await assert.rejects(client.syncAedFromMcod(async()=>{}),code("MCOD_SYNC_DISABLED"));
  await assert.rejects(client.getInstitutions(),code("MCOD_CONTRACT_UNCONFIRMED"));
  assert.throws(()=>client.ensureOperations(["createInstitution"],"write"),code("MCOD_WRITE_DISABLED"));
  assert.equal(calls,0);assert.equal(client.status().automaticSyncEnabled,false);
});
test("reviewed mock binding validates Bearer, pagination and response DTOs",async()=>{
  let calls=0;
  const client=createMcodClient(env,async(input,init)=>{
    calls++;assert.equal(init?.redirect,"manual");
    assert.equal(new Headers(init?.headers).get("authorization"),`Bearer ${env.AED_INTEGRATION_SECRET}`);
    const page=new URL(String(input)).searchParams.get("page");
    return Response.json({items:[{id:page!,name:`Synthetic institution ${page}`}],nextPage:page==="1"?2:null});
  },{getInstitutions:binding("GET")});
  const ids:string[]=[];
  for await(const page of client.allPages("getInstitutions",{}))ids.push(...page.map(x=>x.id));
  assert.deepEqual(ids,["1","2"]);assert.equal(calls,2);
});
test("pagination loops, foreign bindings and invalid DTOs fail without following links",async()=>{
  let calls=0;
  const transport:typeof fetch=async()=>{calls++;return Response.json({items:[],nextPage:1});};
  const client=createMcodClient(env,transport,{getInstitutions:binding("GET")});
  await assert.rejects(async()=>{for await(const _ of client.allPages("getInstitutions",{})){}},code("MCOD_PAGINATION_INVALID"));
  assert.equal(calls,1);
  const foreign={...binding("GET"),encode:()=>({path:"https://untrusted.invalid/api/integrations/aed/steal"})};
  await assert.rejects(createMcodClient(env,transport,{getInstitutions:foreign}).getInstitutions(),code("MCOD_CONTRACT_INVALID"));
  assert.equal(calls,1);
  await assert.rejects(createMcodClient(env,async()=>Response.json({items:[{id:"1"}],nextPage:null}),{getInstitutions:binding("GET")}).getInstitutions(),code("MCOD_CONNECTION_FAILED"));
});
test("ambiguous write responses never retry or expose remote data",async()=>{
  for(const status of [302,409,500]){
    let calls=0;
    const client=createMcodClient(env,async()=>{calls++;return new Response("sensitive-body",{status});},{createDataset:binding("POST")});
    await assert.rejects(client.createDataset({institutionId:"1",title:"Synthetic",description:"",idempotencyKey:"test-key"}),(error)=>{
      assert.ok(code("MCOD_UNKNOWN_OUTCOME")(error));assert.ok(!(error as Error).message.includes("sensitive-body"));return true;
    });
    assert.equal(calls,1);
  }
});
test("CSV download accepts only reviewed text mode and never follows another host",async()=>{
  const raw="\ufeffname,latitude\r\nSynthetic,52\r\n";
  const client=createMcodClient(env,async()=>new Response(raw,{headers:{"content-type":"text/csv"}}),{
    downloadResource:{...binding("GET",(content)=>({content,format:"csv"})),responseMode:"text"},
  });
  assert.equal((await client.downloadResource("1","2")).content,raw);
});
const row=(id:string,license:string):SnapshotRow=>({id,name:`Unit ${id}`,address:`Unit address ${id}`,city:"Unit",latitude:null,longitude:null,
  license,sourceName:"Synthetic publisher",sourceUrl:"https://example.invalid",requiredAttribution:"Synthetic attribution",sourceRevision:"2026-01-01 00:00:00.000001+00"});
const proof={consent:true,externalProvenance:false,geocodingUnreviewed:false};
for(const license of ["CC0-1.0","CC-BY-4.0","ODbL-1.0"])test(`local publication preserves ${license}, attribution and missing GPS`,()=>{
  const rows=[row("1",license)],report=assessPublication(rows,new Map([["1",proof]]));
  assert.equal(report.issues.length,0);assert.equal(report.exported,1);assert.equal(report.notices.length,1);
  const csv=renderPublication(rows,"csv");assert.ok(csv.includes(license));assert.ok(csv.includes("Synthetic attribution"));
  assert.equal(JSON.parse(renderPublication(rows,"geojson")).features[0].geometry,null);
});
test("mixed ODbL and CC BY are not a blanket prohibition; rights checks are per record",()=>{
  const rows=[row("1","ODbL-1.0"),row("2","CC-BY-4.0"),row("3","CC0-1.0")];
  const evidence=new Map(rows.map(r=>[r.id,proof]));
  assert.equal(assessPublication(rows,evidence).issues.length,0);
  evidence.set("2",{...proof,consent:false});
  const report=assessPublication(rows,evidence);
  assert.equal(report.exported,2);assert.equal(report.omitted,1);
  assert.deepEqual(report.issues,[{id:"2",reason:"NO_MATCHING_PUBLICATION_CONSENT"}]);
});
test("unknown rights, imported fields, duplicate rows and unreviewed geocoding are blocked",()=>{
  const a=row("1","UNKNOWN"),b={...a,id:"2"};
  const report=assessPublication([a,b],new Map([["1",{...proof,geocodingUnreviewed:true}],["2",{...proof,externalProvenance:true}]]));
  for(const reason of ["UNKNOWN_LICENSE","GEOCODING_RIGHTS_NOT_REVIEWED","IMPORTED_OR_MIXED_PROVENANCE_REQUIRES_REVIEW","POTENTIAL_DUPLICATE"])
    assert.ok(report.issues.some(i=>i.reason===reason));
  assert.equal(report.omitted,2);
});
test("snapshot idempotency uses exact microsecond revision and CSV neutralizes formulas, not numbers",()=>{
  const rows=[{...row("1","CC-BY-4.0"),name:"=1+1",latitude:-20,longitude:18}];
  const csv=renderPublication(rows,"csv");assert.ok(csv.includes(`\"'=1+1\"`));assert.ok(csv.includes('"-20"'));
  assert.equal(planKey("d","csv",rows,{}),planKey("d","csv",rows,{}));
  assert.notEqual(planKey("d","csv",rows,{}),planKey("d","csv",[{...rows[0]!,sourceRevision:"2026-01-01 00:00:00.000002+00"}],{}));
});
