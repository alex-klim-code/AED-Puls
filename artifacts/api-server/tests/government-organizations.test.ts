import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, users, sessions, governmentInstitutions, governmentClaims, memberships } from "@workspace/db";

// Real cached institutions only; test accounts and approvals are rolled back.
test("organization claims require explicit admin approval before role switching", async () => {
  const oldFetch = globalThis.fetch, oldDemo = process.env.DEMO_AUTH_ENABLED;
  globalThis.fetch = async () => { throw new Error("No external calls in the authority test"); };
  process.env.DEMO_AUTH_ENABLED = "false";
  const { buildApp } = await import("../src/app");
  const app = await buildApp(); await app.ready();
  const original = Object.fromEntries(["select", "insert", "update", "delete", "execute", "transaction"].map(k => [k, (db as any)[k].bind(db)]));
  const rollback = new Error("ROLLBACK_AUTHORITY_TEST");
  try {
    await original.transaction(async (tx: any) => {
      for (const k of Object.keys(original)) (db as any)[k] = tx[k].bind(tx);
      try {
        const [institution] = await db.select().from(governmentInstitutions).limit(1);
        assert.ok(institution, "Cache a real institution through search before running this test");
        const actor = async (role: string) => {
          const [user] = await db.insert(users).values({ name: "__ROLLED_BACK_GOV_TEST__", role, isDemo: false }).returning();
          const raw = randomBytes(32).toString("hex"), csrf = randomBytes(24).toString("hex");
          await db.insert(sessions).values({ id: createHash("sha256").update(raw).digest("hex"), userId: user!.id, csrfToken: csrf, expiresAt: new Date(Date.now() + 600000) });
          return { user: user!, csrf, cookie: `aed_session=${encodeURIComponent(app.signCookie(raw))}` };
        };
        const applicant = await actor("USER"), other = await actor("USER"), admin = await actor("ADMIN");
        const call = (who: typeof applicant, method: "GET" | "POST", url: string, payload?: unknown, csrf = true) =>
          app.inject({ method, url, headers: { cookie: who.cookie, ...(csrf ? { "x-csrf-token": who.csrf } : {}) }, payload: payload as any });
        const path = `/api/organizations/${institution!.id}`;
        assert.equal((await app.inject("/api/organizations/my")).statusCode, 401);
        assert.equal((await call(applicant, "POST", `${path}/switch`)).statusCode, 403);
        const pending = await call(applicant, "POST", `${path}/claim`, { representative: "Test transakcyjny", evidence: "Wyłącznie test transakcyjny; bez rzeczywistego upoważnienia." });
        assert.equal(pending.statusCode, 200, pending.body);
        assert.equal(pending.json().status, "PENDING");
        const id = pending.json().id;
        assert.equal((await call(applicant, "POST", `${path}/switch`)).statusCode, 403);
        const [unchanged] = await db.select().from(users).where(eq(users.id, applicant.user.id));
        assert.equal(unchanged!.role, "USER"); assert.equal(unchanged!.organizationId, null);
        assert.equal((await call(applicant, "POST", `${path}/claim`, { representative: "Test", evidence: "Idempotentny test transakcyjny." })).json().id, id);
        assert.equal((await call(other, "GET", "/api/organizations/my")).json().claims.length, 0);
        const review = `/api/admin/organization-claims/${id}/approve`;
        assert.equal((await call(applicant, "POST", review, { note: "Test transakcyjny", representativeVerified: true })).statusCode, 403);
        assert.equal((await call(admin, "POST", review, { note: "Test transakcyjny", representativeVerified: false })).statusCode, 422);
        assert.equal((await call(admin, "POST", review, { note: "Test transakcyjny", representativeVerified: true }, false)).statusCode, 403);
        assert.equal((await call(admin, "POST", review, { note: "Test transakcyjny", representativeVerified: true })).statusCode, 200);
        assert.equal((await call(other, "POST", `${path}/switch`)).statusCode, 403);
        assert.equal((await call(applicant, "POST", `${path}/switch`)).statusCode, 200);
        const [switched] = await db.select().from(users).where(eq(users.id, applicant.user.id));
        assert.equal(switched!.role, "PROVIDER"); assert.ok(switched!.organizationId);
        assert.equal((await call(applicant, "GET", "/api/workspace")).statusCode, 200);
        const rejected = await call(other, "POST", `${path}/claim`, { representative: "Inny test", evidence: "Wyłącznie odrzucany test transakcyjny." });
        assert.equal((await call(admin, "POST", `/api/admin/organization-claims/${rejected.json().id}/reject`,
          { note: "Test odrzucenia w transakcji", representativeVerified: false })).statusCode, 200);
        assert.equal((await call(other, "POST", `${path}/switch`)).statusCode, 403);
        assert.equal((await db.select().from(governmentClaims).where(eq(governmentClaims.userId, applicant.user.id)))[0]!.status, "APPROVED");
        assert.ok((await db.select().from(memberships).where(eq(memberships.userId, applicant.user.id))).length);
        throw rollback;
      } finally { for (const k of Object.keys(original)) (db as any)[k] = original[k]; }
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally {
    for (const k of Object.keys(original)) (db as any)[k] = original[k];
    await app.close(); globalThis.fetch = oldFetch;
    if (oldDemo === undefined) delete process.env.DEMO_AUTH_ENABLED; else process.env.DEMO_AUTH_ENABLED = oldDemo;
  }
});
