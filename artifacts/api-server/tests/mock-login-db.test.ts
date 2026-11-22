import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool, users, organizations, memberships, sessions, aeds } from "@workspace/db";
import { buildApp } from "../src/app";
import { ensureMockAccounts, mockAccountIdentities } from "../src/modules/mock-accounts";

test("judge login uses three persistent normal accounts and real role boundaries",async t=>{
  const app=await buildApp(),ownedSessions=new Set<string>();
  type Client={cookie:string;csrf:string};
  const update=(client:Client,response:any)=>{
    const cookie=response.cookies.find((c:any)=>c.name==="aed_session");
    if(cookie){
      client.cookie=cookie.value;
      const raw=app.unsignCookie(cookie.value).value;
      assert.ok(raw);
      ownedSessions.add(createHash("sha256").update(raw!).digest("hex"));
    }
    const body=response.json();if(body.csrfToken)client.csrf=body.csrfToken;
    return body;
  };
  const fresh=async()=>{
    const client={cookie:"",csrf:""};
    const response=await app.inject({url:"/api/auth/session"});
    assert.equal(response.statusCode,200);assert.equal(update(client,response).demoEnabled,true);
    return client;
  };
  const login=async(client:Client,role:string)=>{
    const response=await app.inject({method:"POST",url:"/api/auth/demo",cookies:{aed_session:client.cookie},
      headers:{"x-csrf-token":client.csrf},payload:{role}});
    assert.equal(response.statusCode,200);
    return update(client,response).user;
  };
  const get=async(client:Client,path:string)=>app.inject({url:path,cookies:{aed_session:client.cookie}});
  try{
    await t.test("provisioning is idempotent, normal and creates no AEDs",async()=>{
      const [before]=await db.select({count:sql<number>`count(*)::int`}).from(aeds);
      const first=await ensureMockAccounts(),second=await ensureMockAccounts();
      for(const role of ["USER","PROVIDER","ADMIN"] as const){
        assert.equal(first[role].id,second[role].id);assert.equal(first[role].isDemo,false);
        assert.equal(first[role].role,role);assert.ok(!/demo|demonstr/i.test(first[role].name));
      }
      assert.notEqual(first.USER.id,first.ADMIN.id);
      const rows=await db.select().from(users).where(inArray(users.demoIdentity,Object.values(mockAccountIdentities)));
      assert.equal(rows.length,3);
      const [org]=await db.select().from(organizations).where(eq(organizations.id,first.PROVIDER.organizationId!));
      assert.equal(org!.isDemo,false);assert.equal(org!.name,"Organizacja AED Puls");
      const membership=await db.select().from(memberships).where(eq(memberships.userId,first.PROVIDER.id));
      assert.equal(membership.length,1);assert.equal(membership[0]!.organizationId,org!.id);
      const [after]=await db.select({count:sql<number>`count(*)::int`}).from(aeds);
      assert.equal(after!.count,before!.count);
    });
    const accounts:Record<string,any>={},clients:Record<string,Client>={};
    await t.test("each role signs in as a normal account and persists across session refresh",async()=>{
      for(const role of ["USER","ORGANIZATIONS","ADMIN"]){
        const client=await fresh(),account=await login(client,role);clients[role]=client;accounts[role]=account;
        assert.equal(account.isDemo,false);assert.equal(account.role,role==="ORGANIZATIONS"?"PROVIDER":role);
        const session=(await get(client,"/api/auth/session")).json();
        assert.equal(session.authenticated,true);assert.equal(session.user.id,account.id);assert.equal(session.user.isDemo,false);
      }
      assert.ok(accounts.ORGANIZATIONS.organizationId);
      assert.ok(!accounts.USER.organizationId);assert.ok(!accounts.ADMIN.organizationId);
      assert.equal(new Set(Object.values(accounts).map(u=>u.id)).size,3);
    });
    await t.test("fresh browsers return the same accounts instead of creating device-specific identities",async()=>{
      for(const role of ["USER","ORGANIZATIONS","ADMIN"]){
        const client=await fresh(),account=await login(client,role);
        assert.equal(account.id,accounts[role].id);
        assert.ok(client.cookie!==clients[role]!.cookie);
      }
    });
    await t.test("organization alias keeps the existing provider permission model",async()=>{
      const client=await fresh(),legacy=await login(client,"PROVIDER");
      assert.equal(legacy.id,accounts.ORGANIZATIONS.id);
      const workspace=await get(client,"/api/workspace");assert.equal(workspace.statusCode,200);
      assert.equal(workspace.json().role,"PROVIDER");
      assert.ok(workspace.json().records.every((r:any)=>r.organizationId===accounts.ORGANIZATIONS.organizationId));
    });
    await t.test("USER and ORGANIZATIONS cannot access administrator tools",async()=>{
      for(const role of ["USER","ORGANIZATIONS"]){
        assert.equal((await get(clients[role]!,"/api/admin/integrations")).statusCode,403);
      }
      assert.equal((await get(clients.ADMIN!,"/api/admin/integrations")).statusCode,200);
      const own=await get(clients.USER!,"/api/workspace");
      assert.equal(own.statusCode,200);assert.equal(own.json().role,"USER");
    });
    await t.test("role switching rotates the session and clears the previous role",async()=>{
      const client=await fresh();await login(client,"ADMIN");
      assert.equal((await get(client,"/api/admin/integrations")).statusCode,200);
      const user=await login(client,"USER");assert.equal(user.id,accounts.USER.id);
      assert.equal((await get(client,"/api/admin/integrations")).statusCode,403);
    });
    await t.test("CSRF protection and logout still apply to normal quick-login accounts",async()=>{
      const client=clients.USER!;
      const rejected=await app.inject({method:"POST",url:"/api/auth/demo",cookies:{aed_session:client.cookie},payload:{role:"ADMIN"}});
      assert.equal(rejected.statusCode,403);
      const response=await app.inject({method:"POST",url:"/api/auth/logout",cookies:{aed_session:client.cookie},headers:{"x-csrf-token":client.csrf}});
      assert.equal(response.statusCode,200);
      const refreshed=await get(client,"/api/auth/session");
      assert.equal(update(client,refreshed).authenticated,false);
      assert.equal((await get(clients.ADMIN!,"/api/auth/session")).json().authenticated,true);
    });
  }finally{
    await app.close();
    if(ownedSessions.size)await db.delete(sessions).where(inArray(sessions.id,[...ownedSessions]));
    // The requested default accounts and organization stay; only this test's sessions are removed.
    await pool.end();
  }
});
