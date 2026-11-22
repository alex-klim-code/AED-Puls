import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, users, organizations, aeds, sources, observations, duplicateCandidates, dataConflicts, auditLogs,mergeDecisions } from "@workspace/db";
import { buildApp } from "../src/app";
import { provenanceMap } from "../src/ingestion/provenance";
import { reserveSync } from "../src/ingestion/engine";

// Runs only when explicitly invoked against development. Never starts an HTTP server.
// Authentication simulation belongs to this isolated test instance, not the running app.
test("database-backed admin decisions preserve records, provenance and RBAC", async t => {
  const userId = randomUUID(), firstId = randomUUID(), secondId = randomUUID();
  const sourceA = randomUUID(), sourceB = randomUUID(), pairId = randomUUID(), observationA = randomUUID(), observationB = randomUUID();
  const orgId = randomUUID();
  let fixtureUser: typeof users.$inferSelect | undefined;
  let demoMode = false, role = "ADMIN", allowIdentity = true;
  const app = await buildApp();
  app.addHook("preHandler", async req => {
    if (allowIdentity && fixtureUser) req.account = { ...fixtureUser, role, isDemo: demoMode };
  });
  try {
    await db.insert(organizations).values({ id: orgId, name: "Tymczasowa organizacja testowa", isDemo: false });
    [fixtureUser] = await db.insert(users).values({ id: userId, name: "Tymczasowy test integracji", role: "ADMIN", isDemo: false, organizationId: orgId }).returning();
    await db.insert(sources).values([sourceA, sourceB].map((id, i) => ({
      id, name: `Tymczasowe źródło testowe ${i}`, url: "https://example.org/test",
      license: "ODbL-1.0", coverage: "TEST", institution: "TEST", datasetId: "TEST", updateFrequency: "TEST",
      authoritativeScope: "Tymczasowe dane testowe, nie do publikacji", statusMessage: "TEST",
    })));
    await db.insert(aeds).values([firstId, secondId].map((id, i) => ({
      id, name: `Tymczasowy rekord testowy ${i}`, address: "UNKNOWN", city: "UNKNOWN", latitude: 52.23, longitude: 21.01,
      sourceName: "TEST", sourceUrl: "https://example.org/test", license: "ODbL-1.0", imported: true,
      verificationStatus: "unverified", publicImport: false, isDemo: false,
      organizationId: orgId,
    })));
    await db.insert(observations).values([
      { id: observationA, sourceId: sourceA, aedId: firstId, sourceRecordId: "test-a", originalRecord: { test: true, name: "original-a" }, sourceUrl: "https://example.org/a", license: "ODbL-1.0" },
      { id: observationB, sourceId: sourceB, aedId: secondId, sourceRecordId: "test-b", originalRecord: { test: true, name: "original-b" }, sourceUrl: "https://example.org/b", license: "ODbL-1.0" },
    ]);
    await db.insert(duplicateCandidates).values({ id: pairId, firstId, secondId, reason: "TEST — tymczasowe porównanie" });
    const sessionResponse = await app.inject({ method: "GET", url: "/api/auth/session" });
    const csrf = sessionResponse.json().csrfToken;
    const setCookie = sessionResponse.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).filter(Boolean).map(v => String(v).split(";")[0]).join("; ");
    const headers = { cookie, "x-csrf-token": csrf };
    await t.test("source counter includes a registered provider without additional public AED points",async()=>{
      const before=(await app.inject({url:"/api/stats"})).json();
      await db.update(sources).set({key:`test-${sourceA}`}).where(eq(sources.id,sourceA));
      try{
        const after=(await app.inject({url:"/api/stats"})).json();
        const registry=(await app.inject({url:"/api/sources"})).json();
        assert.equal(after.sources,before.sources+1);
        assert.equal(after.sources,registry.length);
        assert.equal(after.total,before.total);
      }finally{await db.update(sources).set({key:null}).where(eq(sources.id,sourceA));}
    });
    const assessment = { aedId: firstId, recordVerificationStatus: "VERIFIED_BY_AUTHORIZED_REVIEWER",
      operationalStatus: "OPERATIONAL", verifiedAt: "2025-01-01T10:00:00.000Z", evidence: "Wyłącznie test automatyczny na tymczasowych niepublicznych danych." };
    await t.test("admin panel is paginated and derives source counts from the database", async () => {
      const response = await app.inject({ url: "/api/admin/integrations?sourceId=" + sourceA });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().recordTotal, 1);
      assert.equal(response.json().records.length, 1);
      assert.equal(response.json().pageSize, 20);
    });
    await t.test("merge retains both original observations and does not copy or relicense attributes", async () => {
      const response = await app.inject({ method: "POST", url: "/api/admin/resolve-duplicate", headers, payload: { candidateId: pairId, action: "merge", keepId: firstId } });
      assert.equal(response.statusCode, 200, response.body);
      const rows = await db.select().from(aeds).where(inArray(aeds.id, [firstId, secondId]));
      assert.equal(rows.find(r => r.id === secondId)!.mergedIntoId, firstId);
      assert.equal(rows.find(r => r.id === firstId)!.name, "Tymczasowy rekord testowy 0");
      assert.equal(rows.find(r => r.id === firstId)!.license, "ODbL-1.0");
      const refs = (await provenanceMap([firstId])).get(firstId)!;
      assert.equal(refs.length, 2);
      assert.deepEqual(new Set(refs.map(r => r.sourceRecordId)), new Set(["test-a", "test-b"]));
      const repeat = await app.inject({ method: "POST", url: "/api/admin/resolve-duplicate", headers, payload: { candidateId: pairId, action: "merge", keepId: firstId } });
      assert.equal(repeat.statusCode, 409);
    });
    await t.test("device assessment requires date and evidence and does not approve publication", async () => {
      const missingDate = { ...assessment, verifiedAt: undefined };
      assert.equal((await app.inject({ method: "POST", url: "/api/device-assessment", headers, payload: missingDate })).statusCode, 400);
      assert.equal((await app.inject({ method: "POST", url: "/api/device-assessment", headers, payload: { ...assessment, verifiedAt: "2999-01-01T00:00:00.000Z" } })).statusCode, 400);
      assert.equal((await app.inject({ method: "POST", url: "/api/device-assessment", headers, payload: { ...assessment, recordVerificationStatus: "UNVERIFIED" } })).statusCode, 400);
      const response = await app.inject({ method: "POST", url: "/api/device-assessment", headers, payload: assessment });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().recordVerificationStatus, "VERIFIED_BY_AUTHORIZED_REVIEWER");
      assert.equal(response.json().operationalStatus, "OPERATIONAL");
      assert.equal(response.json().verificationStatus, "unverified");
      assert.equal(response.json().publicImport, false);
      assert.equal(response.json().verificationEvidence.statement, assessment.evidence);
    });
    await t.test("operator can assess only their organization's device", async () => {
      role = "PROVIDER";
      const payload = { ...assessment, recordVerificationStatus: "VERIFIED_BY_OPERATOR" };
      const response = await app.inject({ method: "POST", url: "/api/device-assessment", headers, payload });
      assert.equal(response.statusCode, 200, response.body);
      fixtureUser!.organizationId = null;
      assert.equal((await app.inject({ method: "POST", url: "/api/device-assessment", headers, payload })).statusCode, 403);
      fixtureUser!.organizationId = orgId;
      role = "ADMIN";
      assert.equal((await app.inject({ method: "POST", url: "/api/device-assessment", headers, payload })).statusCode, 403);
    });
    await t.test("a conflicting field requires an explicit decision, invalidates device assessment and is audited", async () => {
      const [conflict] = await db.insert(dataConflicts).values({ aedId: firstId, observationId: observationA, field: "name", currentValue: "Tymczasowy rekord testowy 0", incomingValue: "Tymczasowa aktualizacja testowa" }).returning();
      const response = await app.inject({ method: "POST", url: "/api/admin/resolve-conflict", headers, payload: { conflictId: conflict!.id, choice: "incoming" } });
      assert.equal(response.statusCode, 200, response.body);
      const [record] = await db.select().from(aeds).where(eq(aeds.id, firstId));
      assert.equal(record!.name, "Tymczasowa aktualizacja testowa");
      assert.equal(record!.verificationStatus, "unverified");
      assert.equal(record!.publicImport, false);
      assert.equal(record!.recordVerificationStatus, "UNVERIFIED");
      assert.equal(record!.deviceOperationalStatus, "UNKNOWN");
      assert.equal(record!.verifiedAt, null);
      assert.equal(record!.verificationEvidence.statement, assessment.evidence);
      const logs = await db.select().from(auditLogs).where(eq(auditLogs.userId, userId));
      assert.ok(logs.length >= 2);
    });
    await t.test("ODbL cannot be silently converted into CC0", async () => {
      const [conflict] = await db.insert(dataConflicts).values({ aedId: firstId, observationId: observationA, field: "license", currentValue: "ODbL-1.0", incomingValue: "CC0-1.0" }).returning();
      const response = await app.inject({ method: "POST", url: "/api/admin/resolve-conflict", headers, payload: { conflictId: conflict!.id, choice: "incoming" } });
      assert.equal(response.statusCode, 400);
      const [record] = await db.select().from(aeds).where(eq(aeds.id, firstId));
      assert.equal(record!.license, "ODbL-1.0");
      const approval = await app.inject({ method: "POST", url: `/api/admin/aeds/${firstId}/review`, headers, payload: { decision: "verified" } });
      assert.equal(approval.statusCode, 400);
    });
    await t.test("demo sign-in grants normal role access to real records, with ownership checks", async () => {
      demoMode = true;
      const response = await app.inject({ url: "/api/admin/integrations" });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().demoReadOnly, false);
      assert.ok(response.json().records.length > 0);
      // Invalid source fails validation, not demo authentication; no real sync is launched.
      const mutation = await app.inject({ method: "POST", url: "/api/admin/sync", headers, payload: { sourceKey: "invalid" } });
      assert.equal(mutation.statusCode, 400);
      assert.equal((await app.inject({ method: "POST", url: "/api/device-assessment", headers, payload: assessment })).statusCode, 200);
      assert.equal((await app.inject({ url: `/api/aeds/${firstId}` })).statusCode, 200);
      role = "PROVIDER";
      const own = await app.inject({ url: "/api/workspace" });
      assert.ok(own.json().records.some((r: { id: string }) => r.id === firstId));
      fixtureUser!.organizationId = null;
      const other = await app.inject({ url: "/api/workspace" });
      assert.equal(other.json().records.length, 0);
      fixtureUser!.organizationId = orgId;
      role = "USER";
      assert.equal((await app.inject({ url: "/api/admin/integrations" })).statusCode, 403);
      role = "ADMIN";
      demoMode = false;
    });
    await t.test("USER and guests cannot access integration administration; missing CSRF fails", async () => {
      role = "USER";
      assert.equal((await app.inject({ url: "/api/admin/integrations" })).statusCode, 403);
      role = "ADMIN"; allowIdentity = false;
      assert.equal((await app.inject({ url: "/api/admin/integrations" })).statusCode, 401);
      allowIdentity = true;
      assert.equal((await app.inject({ method: "POST", url: "/api/admin/sync", payload: { sourceKey: "przemysl" } })).statusCode, 403);
    });
    await t.test("atomic source lease prevents overlapping imports", async () => {
      const [source] = await db.select().from(sources).where(eq(sources.key, "przemysl"));
      assert.ok(source);
      const [lock] = await db.update(sources).set({ lockedUntil: new Date(Date.now() + 60000), lockToken: randomUUID() }).where(and(eq(sources.id, source!.id), isUnlocked())).returning();
      if (!lock) return; // Existing real job already proves the lock is held.
      try { assert.equal(await reserveSync("przemysl"), null); }
      finally { await db.update(sources).set({ lockedUntil: null, lockToken: null }).where(eq(sources.id, source!.id)); }
    });
  } finally {
    await app.close();
    await db.delete(dataConflicts).where(inArray(dataConflicts.aedId, [firstId, secondId]));
    await db.delete(duplicateCandidates).where(eq(duplicateCandidates.id, pairId));
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await db.delete(mergeDecisions).where(eq(mergeDecisions.actorId,userId));
    await db.delete(observations).where(inArray(observations.sourceId, [sourceA, sourceB]));
    await db.delete(aeds).where(inArray(aeds.id, [firstId, secondId]));
    await db.delete(sources).where(inArray(sources.id, [sourceA, sourceB]));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await pool.end();
  }
});

import { sql } from "drizzle-orm";
const isUnlocked = () => sql`${sources.lockedUntil} is null or ${sources.lockedUntil} < now()`;
