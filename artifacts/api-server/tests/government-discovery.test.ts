import test from "node:test";
import assert from "node:assert/strict";
import { cataloguePages, governmentBatches, relevantAedTitle } from "../src/ingestion/government";
import type { SourceContext } from "../src/ingestion/normalize";
import { normalizeRow } from "../src/ingestion/normalize";

const base:SourceContext={name:"dane.gov.pl",publisher:"Wydawcy",license:"UNKNOWN",url:"https://api.dane.gov.pl/1.4/datasets",
  datasetUrl:"https://dane.gov.pl",datasetId:"discovery",resourceId:"discovery",coverage:"PL",modified:null};
test("catalogue pagination follows all pages, including beyond the previous twenty-page cutoff",async()=>{
  let calls=0,items=0;
  const get=async(input:string)=>{
    calls++;const url=new URL(input),page=Number(url.searchParams.get("page"));
    return{data:[{id:String(page)}],meta:{count:21},links:{next:page<21?`/1.4/resources?page=${page+1}`:null}};
  };
  for await(const page of cataloguePages("https://api.dane.gov.pl/1.4/resources",{},get))items+=page.length;
  assert.equal(items,21);assert.equal(calls,21);
});
test("streamed discovery retains earlier pages but reports an incomplete or foreign continuation",async()=>{
  let calls=0;
  const iterator=cataloguePages("https://api.dane.gov.pl/1.4/resources",{},async()=>{
    calls++;return{data:[{id:"1"}],links:{next:"https://untrusted.invalid/1.4/resources?page=2"}};
  });
  assert.equal((await iterator.next()).value?.length,1);
  await assert.rejects(iterator.next(),/Nieprawidłowy odnośnik/);assert.equal(calls,1);
});
test("AED resource under a general dataset is imported without unrelated sibling resources or GPS requirement",async()=>{
  const downloaded:string[]=[];
  const resource={id:"100",type:"resource",attributes:{title:"Wykaz <mark>AED</mark>",format:"csv",file_url:"https://example.org/aed.csv"},
    relationships:{dataset:{data:{id:"10"}}}};
  const unrelated={id:"101",attributes:{title:"Budżet",format:"csv",file_url:"https://example.org/budget.csv"}};
  const get=async(input:string)=>{
    const url=new URL(input);
    if(url.pathname==="/1.4/datasets")return{data:[],meta:{count:0}};
    if(url.pathname==="/1.4/resources")return{data:[resource],meta:{count:1}};
    if(url.pathname==="/1.4/datasets/10")return{data:{id:"10",type:"dataset",attributes:{title:"Zdrowie",license_name:"CC BY 4.0"},
      relationships:{institution:{data:{id:"297"}}}}};
    if(url.pathname==="/1.4/institutions/297")return{data:{id:"297",type:"institution",attributes:{title:"Wydawca testowy",institution_type:"local"}}};
    if(url.pathname==="/1.4/datasets/10/resources")return{data:[resource,unrelated],meta:{count:2}};
    throw new Error("Unexpected fixture URL");
  };
  const batches=[];
  for await(const batch of governmentBatches(base,{io:{json:get,bytes:async input=>{
    downloaded.push(input);return Buffer.from('id,address\\n1,\"ul. Nowa 1, Warszawa\"\\n'.replaceAll("\\n","\n"));
  }}}))batches.push(batch);
  assert.deepEqual(downloaded,["https://example.org/aed.csv"]);
  assert.equal(batches.flatMap(b=>b.rows).length,1);
  assert.equal(batches.find(b=>b.rows.length)?.context.datasetTitle,"Zdrowie");
  assert.ok(!batches.some(b=>b.issue?.severity==="error"));
});
test("matching ignores markup and does not mistake a general health dataset for AED data",()=>{
  assert.equal(relevantAedTitle({attributes:{title:"Lokalizacje <mark>AED</mark>"}}),true);
  assert.equal(relevantAedTitle({attributes:{title:"Zdrowie"}}),false);
});
test("Polish structured address headers preserve the actual street, building, city and postcode, also without GPS",()=>{
  const original={nazwa:"Urząd",cecha_ulicy:"ulica",nazwa_ulicy:"Piłsudskiego",nr_budynku:"41",
    kod_pocztowy:"05-120",miejscowosc:"Legionowo"};
  const row=normalizeRow({original,context:{...base,license:"CC-BY-4.0"}});
  assert.equal(row.data?.address,"ulica Piłsudskiego 41");
  assert.equal(row.data?.city,"Legionowo");assert.equal(row.data?.postalCode,"05-120");
  assert.equal(row.data?.latitude,null);assert.equal(row.data?.longitude,null);
  assert.equal(original.nr_budynku,"41");
});
