import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { downloadExport, ExportDownloadError, exportQuery } from "../src/lib/export-download";

test("download saves only a completely received valid export",async t=>{
  const clicks:{href:string;download:string}[]=[],blobs:Blob[]=[];
  const oldDocument=Object.getOwnPropertyDescriptor(globalThis,"document");
  Object.defineProperty(globalThis,"document",{configurable:true,value:{
    createElement:()=>({href:"",download:"",rel:"",click(){clicks.push({href:this.href,download:this.download});},remove(){}}),
    body:{appendChild(){}},
  }});
  mock.method(URL,"createObjectURL",(blob:Blob)=>{blobs.push(blob);return "blob:test";});
  mock.method(URL,"revokeObjectURL",()=>{});
  let request:{url:string;options?:RequestInit}|undefined,response:Response;
  mock.method(globalThis,"fetch",async(url:string,options?:RequestInit)=>{
    request={url,options};return response;
  });
  const headers={"content-type":"application/json; charset=utf-8","X-AED-Record-Count":"1",
    "X-AED-Schema-Version":"1.0.0","content-disposition":'attachment; filename="aed_test.json"'};
  try{
    await t.test("provider, scope and license filters use exactly the same query",async()=>{
      assert.deepEqual(exportQuery("public",["source:b","source:a"],"CC-BY-4.0"),{
        scope:"public",providerIds:"source:a,source:b",license:"CC-BY-4.0",
      });
      assert.ok(!("license" in exportQuery("public",["source:a"],"all")));
      response=new Response('[{"id":"one"}]',{headers});
      await downloadExport("json","public",["source:a"],new AbortController().signal,"ODbL-1.0");
      assert.equal(new URL(request!.url,"https://example.org").searchParams.get("license"),"ODbL-1.0");
      clicks.length=0;blobs.length=0;
    });
    await t.test("waits for complete bytes then triggers the correct automatic download",async()=>{
      let complete!:(blob:Blob)=>void;
      response=new Response('[{"id":"one"}]',{headers});
      response.blob=()=>new Promise(resolve=>{complete=resolve;});
      const controller=new AbortController(),promise=downloadExport("json","public",["source:b","source:a"],controller.signal);
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(clicks.length,0);assert.equal(blobs.length,0);
      const url=new URL(request!.url,"https://example.org");
      assert.equal(url.pathname,"/api/exports/json");assert.equal(url.searchParams.get("providerIds"),"source:a,source:b");
      assert.equal(url.searchParams.get("license"),null);assert.equal(request!.options!.credentials,"include");
      assert.equal(request!.options!.signal,controller.signal);
      complete(new Blob(['[{"id":"one"}]'],{type:"application/json"}));
      const result=await promise;
      assert.equal(clicks.length,1);assert.equal(clicks[0]!.download,"aed_test.json");
      assert.equal(result.recordCount,1);assert.equal(result.schemaVersion,"1.0.0");
      assert.equal(await blobs[0]!.text(),'[{"id":"one"}]');
    });
    await t.test("XLSX uses its own MIME, preserves filters and downloads the complete binary file",async()=>{
      const type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",before=clicks.length;
      response=new Response(new Uint8Array([80,75,3,4]),{headers:{...headers,"content-type":type,"content-disposition":'attachment; filename="aed_test.xlsx"'}});
      await downloadExport("xlsx","public",["source:a"],new AbortController().signal,["CC0-1.0","CC-BY-4.0"]);
      assert.equal(clicks.length,before+1);assert.equal(clicks.at(-1)!.download,"aed_test.xlsx");
      assert.equal(new URL(request!.url,"https://example.org").pathname,"/api/exports/xlsx");
      assert.equal(new URL(request!.url,"https://example.org").searchParams.get("licenses"),"CC0-1.0,CC-BY-4.0");
      assert.equal((request!.options!.headers as Record<string,string>).Accept,type);
      assert.deepEqual(new Uint8Array(await blobs.at(-1)!.arrayBuffer()),new Uint8Array([80,75,3,4]));
    });
    await t.test("server errors cannot be saved as JSON files",async()=>{
      const before=clicks.length;response=new Response('{"error":"Brak rekordów"}',{status:422,headers});
      await assert.rejects(downloadExport("json","public",["source:a"],new AbortController().signal),/Brak rekordów/);
      assert.equal(clicks.length,before);
    });
    await t.test("wrong MIME, empty bytes, zero and missing counts cannot create files",async()=>{
      const before=clicks.length;
      for(const [content,count,type] of [["x","1","text/html"],["x","1","application/json-error"],["","1","application/json"],
        ["[]","0","application/json"],["[]","","application/json"],["[]","-1","application/json"],["[]","1.5","application/json"]]){
        response=new Response(content,{headers:{...headers,"content-type":type!,"X-AED-Record-Count":count!}});
        await assert.rejects(downloadExport("json","public",["source:a"],new AbortController().signal),ExportDownloadError);
      }
      assert.equal(clicks.length,before);
    });
    await t.test("cancellation while receiving the body never clicks a download link",async()=>{
      const before=clicks.length,controller=new AbortController();
      let complete!:(blob:Blob)=>void;
      response=new Response("x",{headers});response.blob=()=>new Promise(resolve=>{complete=resolve;});
      const promise=downloadExport("json","public",["source:a"],controller.signal);
      await new Promise(resolve=>setImmediate(resolve));controller.abort();complete(new Blob(["x"]));
      await assert.rejects(promise,{name:"AbortError"});assert.equal(clicks.length,before);
    });
    await t.test("network failure and incomplete bodies never create a file",async()=>{
      const before=clicks.length;
      response=new Response("x",{headers});response.blob=async()=>{throw new TypeError("Connection interrupted");};
      await assert.rejects(downloadExport("json","public",["source:a"],new AbortController().signal),/Connection interrupted/);
      assert.equal(clicks.length,before);
    });
    await t.test("checkbox license arrays serialize to canonical licenses, never singular license",async()=>{
      assert.deepEqual(exportQuery("public",["source:a"],["ODbL-1.0","CC0-1.0","ODbL-1.0"]),{
        scope:"public",providerIds:"source:a",licenses:"CC0-1.0,ODbL-1.0",
      });
      assert.deepEqual(exportQuery("approved",["source:a"],["CC0-1.0","CC-BY-4.0","ODbL-1.0"]).licenses,"CC0-1.0,CC-BY-4.0,ODbL-1.0");
      assert.ok(!("license" in exportQuery("public",["source:a"],["CC-BY-4.0"])));
      response=new Response('[{"id":"one"}]',{headers});
      await downloadExport("json","public",["source:a"],new AbortController().signal,["CC-BY-4.0","CC0-1.0"]);
      const u=new URL(request!.url,"https://example.org");
      assert.equal(u.searchParams.get("licenses"),"CC0-1.0,CC-BY-4.0");assert.equal(u.searchParams.get("license"),null);
    });
    await t.test("an empty license array is rejected before a request",async()=>{
      const before=request,clicksBefore=clicks.length;
      await assert.rejects(downloadExport("zip","public",["source:a"],new AbortController().signal,[]),ExportDownloadError);
      assert.equal(request,before);assert.equal(clicks.length,clicksBefore);
    });
    await t.test("zip accepts zero records with application/zip, raw formats reject zero",async()=>{
      const zh={"content-type":"application/zip","X-AED-Record-Count":"0","content-disposition":'attachment; filename="aed_export.zip"'};
      const before=clicks.length;
      response=new Response("PK\u0003\u0004",{headers:zh});
      const r=await downloadExport("zip","public",["source:a"],new AbortController().signal,["CC0-1.0"]);
      assert.equal(r.recordCount,0);assert.equal(r.filename,"aed_export.zip");assert.equal(clicks.length,before+1);
      assert.equal(new URL(request!.url,"https://example.org").pathname,"/api/exports/zip");
      for(const f of ["csv","json","geojson"] as const){
        const type=f==="csv"?"text/csv":f==="geojson"?"application/geo+json":"application/json";
        response=new Response("x",{headers:{...headers,"content-type":type,"X-AED-Record-Count":"0"}});
        await assert.rejects(downloadExport(f,"public",["source:a"],new AbortController().signal,["CC0-1.0"]),ExportDownloadError);
      }
      for(const [count,type] of [["","application/zip"],["-1","application/zip"],["abc","application/zip"],["0.5","application/zip"],["0","application/json"],["0","application/x-zip-compressed"]]){
        response=new Response("PK",{headers:{...zh,"content-type":type!,"X-AED-Record-Count":count!}});
        await assert.rejects(downloadExport("zip","public",["source:a"],new AbortController().signal,["CC0-1.0"]),ExportDownloadError);
      }
      const noCount=new Headers(zh);noCount.delete("X-AED-Record-Count");response=new Response("PK",{headers:noCount});
      await assert.rejects(downloadExport("zip","public",["source:a"],new AbortController().signal,["CC0-1.0"]),ExportDownloadError);
      assert.equal(clicks.length,before+1);
    });
    await t.test("an empty provider selection is rejected before a request",async()=>{
      const before=request;
      await assert.rejects(downloadExport("csv","public",[],new AbortController().signal),ExportDownloadError);
      assert.equal(request,before);
    });
  }finally{
    if(oldDocument)Object.defineProperty(globalThis,"document",oldDocument);else delete(globalThis as any).document;
    mock.restoreAll();
  }
});
