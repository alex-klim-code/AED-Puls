import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import { eq,inArray } from "drizzle-orm";
import { db,pool,aeds,auditLogs,sessions } from "@workspace/db";
import { buildApp } from "../src/app";

test("incomplete AEDs persist, stay off maps, can be enriched with exact revisions and keep history",async()=>{
  const app=await buildApp(),id=randomUUID(),ownedSessions=new Set<string>();
  let cookie="",csrf="";
  const absorb=(response:any)=>{
    const value=response.cookies.find((c:any)=>c.name==="aed_session")?.value;
    if(value){cookie=value;const raw=app.unsignCookie(value).value;if(raw)ownedSessions.add(createHash("sha256").update(raw).digest("hex"));}
    const body=response.json();if(body.csrfToken)csrf=body.csrfToken;return body;
  };
  const request=(method:"GET"|"PATCH",url:string,payload?:unknown)=>app.inject({method,url,cookies:{aed_session:cookie},headers:{"x-csrf-token":csrf},...(payload?{payload}:{})});
  try{
    await db.insert(aeds).values({id,name:"",address:"",city:"",latitude:null,longitude:null,
      sourceName:"TEST — niepubliczny",sourceUrl:"https://example.org/test",license:"CC0-1.0",
      verificationStatus:"NOT_VERIFIED",publicImport:false,isDemo:false,imported:false});
    assert.equal((await app.inject({url:"/api/admin/records"})).statusCode,401);
    absorb(await app.inject({url:"/api/auth/session"}));
    const login=await app.inject({method:"POST",url:"/api/auth/demo",cookies:{aed_session:cookie},headers:{"x-csrf-token":csrf},payload:{role:"ADMIN"}});
    assert.equal(login.statusCode,200);absorb(login);
    const list=await request("GET",`/api/admin/records?missingLocation=true&search=${id}`);
    assert.equal(list.statusCode,200);assert.equal(list.json().total,1);
    const initial=list.json().records[0];
    assert.equal(initial.latitude,null);assert.equal(initial.longitude,null);assert.equal(initial.completenessStatus,"INCOMPLETE");
    assert.equal(initial.verificationStatus,"NOT_VERIFIED");assert.ok(initial.revision);
    const first=await request("PATCH",`/api/admin/aeds/${id}`,{city:"Warszawa",expectedUpdatedAt:initial.revision});
    assert.equal(first.statusCode,200);assert.equal(first.json().latitude,null);assert.equal(first.json().completenessStatus,"INCOMPLETE");
    const stale=await request("PATCH",`/api/admin/aeds/${id}`,{city:"NIE NADPISUJ",expectedUpdatedAt:initial.revision});
    assert.equal(stale.statusCode,409);
    const second=await request("PATCH",`/api/admin/aeds/${id}`,{name:"TEST — niepubliczny",address:"TEST — niepubliczny",
      latitude:52.23,longitude:21.01,expectedUpdatedAt:first.json().revision});
    assert.equal(second.statusCode,200);assert.equal(second.json().completenessStatus,"COMPLETE");
    assert.equal(second.json().verificationStatus,"NOT_VERIFIED");
    assert.equal((await request("GET",`/api/admin/records?missingLocation=true&search=${id}`)).json().total,0);
    const map=await app.inject({url:"/api/map-points"});assert.equal(map.statusCode,200);
    assert.equal(map.json().some((point:any)=>point.id===id),false);
    const history=await request("GET",`/api/admin/aeds/${id}/history`);
    assert.equal(history.statusCode,200);assert.equal(history.json().length,2);
    assert.equal(history.json()[0].details.before.latitude,null);
    assert.equal(history.json()[0].details.after.latitude,52.23);
    const[stored]=await db.select().from(aeds).where(eq(aeds.id,id));assert.equal(stored!.city,"Warszawa");
  }finally{
    await app.close();await db.delete(auditLogs).where(eq(auditLogs.entityId,id));await db.delete(aeds).where(eq(aeds.id,id));
    if(ownedSessions.size)await db.delete(sessions).where(inArray(sessions.id,[...ownedSessions]));
    await pool.end();
  }
});
