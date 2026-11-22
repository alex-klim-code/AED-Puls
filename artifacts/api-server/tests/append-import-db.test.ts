import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, pool, observations, users, importErrors, importJobs, auditLogs } from "@workspace/db";
import { buildApp } from "../src/app";
import { executeAppendImport } from "../src/ingestion/append-import";
import { reserveSync } from "../src/ingestion/engine";
import type { SourceContext } from "../src/ingestion/normalize";

test("append import rejects unauthorized requests and isolates a broken row without changing real AEDs", async () => {
  const app = await buildApp();
  let jobId: string | undefined;
  try {
    const [account] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
    assert.ok(account);
    let role: string | null = null;
    app.addHook("preHandler", async req => { req.account = role ? { ...account, role } : undefined; });
    const session = await app.inject({ url: "/api/auth/session" });
    const cookies = session.cookies.map(c => `${c.name}=${c.value}`).join("; ");
    const headers = { cookie: cookies, "x-csrf-token": session.json().csrfToken };
    const request = () => app.inject({ method: "POST", url: "/api/admin/sync", headers,
      payload: { sourceKey: "dane-gov", mode: "append" } });
    assert.equal((await request()).statusCode, 401);
    for (const value of ["USER", "PROVIDER"]) { role = value; assert.equal((await request()).statusCode, 403); }
    role = "ADMIN";
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/sync", headers: { cookie: cookies },
      payload: { sourceKey: "dane-gov", mode: "append" } })).statusCode, 403);
    const [ref] = await db.select().from(observations).where(and(isNotNull(observations.aedId), eq(observations.datasetId, "3624"))).limit(1);
    assert.ok(ref);
    const doc = ref.originalRecord as { record: Record<string, unknown>; context: SourceContext };
    assert.ok(doc.record && doc.context);
    const before = await db.execute(sql`select md5(string_agg(to_jsonb(a)::text,'' order by id)) as hash from aed_records a`);
    const reservation = await reserveSync("dane-gov");
    assert.ok(reservation);
    jobId = reservation.job.id;
    assert.equal(await reserveSync("dane-gov"), null);
    // A bad provider value fails serialization before insert; no fictional AED is created.
    const broken = { toJSON() { throw new Error("Kontrolowany błąd pojedynczego wiersza"); } };
    const result = await executeAppendImport(reservation, { connector: async function* () {
      yield { context: doc.context, rows: [broken, doc.record] };
    } });
    assert.equal(result.processed, 2);
    assert.equal(result.errors, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.imported, 0);
    assert.equal(result.resourceErrors, 0);
    assert.equal(result.status, "partial");
    const after = await db.execute(sql`select md5(string_agg(to_jsonb(a)::text,'' order by id)) as hash from aed_records a`);
    assert.deepEqual(after.rows, before.rows);
    const panel = await app.inject({ url: "/api/admin/integrations", headers });
    assert.equal(panel.statusCode, 200);
    const job = panel.json().jobs.find((j: { id: string }) => j.id === result.jobId);
    assert.equal(job.summary.mode, "append");
    assert.equal(job.errors, 1);
  } finally {
    if (jobId) {
      await db.delete(importErrors).where(eq(importErrors.jobId, jobId));
      await db.delete(auditLogs).where(eq(auditLogs.entityId, jobId));
      await db.delete(importJobs).where(eq(importJobs.id, jobId));
    }
    await app.close(); await pool.end();
  }
});
