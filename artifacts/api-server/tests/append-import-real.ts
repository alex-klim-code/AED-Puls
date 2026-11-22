// Explicit opt-in development verification with real catalogue data; no synthetic AEDs.
import assert from "node:assert/strict";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ensureSources, reserveSync } from "../src/ingestion/engine";
import { executeAppendImport } from "../src/ingestion/append-import";
import { buildApp } from "../src/app";
import { writeFile, mkdir } from "node:fs/promises";

const tables = ["aed_records", "source_observations", "observation_versions", "duplicate_candidates", "merge_decisions", "data_conflicts"];
async function snapshot() {
  const result: Record<string, Record<string, string>> = {};
  for (const table of tables) {
    const rows = await db.execute(sql.raw(`select id, md5(to_jsonb(t)::text) as hash from ${table} t`));
    result[table] = Object.fromEntries(rows.rows.map(r => [String(r.id), String(r.hash)]));
  }
  return result;
}
function unchanged(before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>) {
  for (const table of tables) for (const [id, hash] of Object.entries(before[table]!))
    assert.equal(after[table]![id], hash, `Zmiana istniejących danych: ${table}/${id}`);
}
async function run(datasetId?: string) {
  const reservation = await reserveSync("dane-gov");
  assert.ok(reservation, "Import lub synchronizacja już trwa.");
  return executeAppendImport(reservation, { datasetId });
}
try {
  await ensureSources();
  const before = await snapshot();
  const datasetId = process.argv[2] === "national" ? undefined : process.argv[2] ?? "3624";
  const first = await run(datasetId);
  console.log("REAL_IMPORT", JSON.stringify(first));
  assert.notEqual(first.status, "failed");
  const after = await snapshot();
  unchanged(before, after);
  const result: Record<string, unknown> = { first, preservedExisting: true };
  if (datasetId) {
    const second = await run(datasetId);
    assert.equal(second.imported, 0);
    assert.equal(second.updated, 0);
    unchanged(after, await snapshot());
    console.log("REPEAT", JSON.stringify(second));
    result.repeat = second;
  }
  const totals = await db.execute(sql`select count(*)::int as aeds,
    count(*) filter(where a.public_import and a.latitude is not null and a.longitude is not null and a.merged_into_id is null)::int as public_located
    from aed_records a where not a.is_demo`);
  const app = await buildApp();
  try {
    const response = await app.inject({ url: "/api/map-points?limit=20000" });
    assert.equal(response.statusCode, 200);
    const points = response.json();
    assert.ok(points.length > 0);
    const linked = await db.execute(sql`select a.id from aed_records a join source_observations o on o.aed_id=a.id
      where a.public_import and a.latitude is not null and a.longitude is not null and a.merged_into_id is null
      ${datasetId ? sql`and o.dataset_id=${datasetId}` : sql``}`);
    const ids = new Set(points.map((p: { id: string }) => p.id));
    assert.ok(linked.rows.length > 0, "Brak publicznych punktów importowanego zbioru.");
    assert.ok(linked.rows.every(r => ids.has(r.id)));
    result.database = totals.rows[0];
    result.mapPoints = points.length;
    result.confirmedDatasetPoints = linked.rows.length;
    result.newAeds = Object.keys(after.aed_records!).length - Object.keys(before.aed_records!).length;
    console.log("DATABASE_AND_MAP", JSON.stringify(result));
  } finally { await app.close(); }
  const output = new URL("../../../generated-artifacts/", import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL(`append-${datasetId ?? "national"}.json`, output), JSON.stringify(result, null, 2));
} finally { await pool.end(); }
