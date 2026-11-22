import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/** User-approved removal of the retired synthetic dataset, including on production startup.
 * Authentication identities and their organization are retained; new submissions are real.
 */
export async function removeDemoRecords() {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(78214123)`);
    const count = await tx.execute(sql`select count(*)::int as n from aed_records where is_demo=true`);
    const removed = Number(count.rows[0]?.n ?? 0);
    const cross = await tx.execute(sql`select id from aed_records where is_demo=false and merged_into_id in
      (select id from aed_records where is_demo=true) limit 1`);
    if (cross.rows.length) throw new Error("Przerwano usuwanie: rzeczywisty rekord odwołuje się do demonstracyjnego.");
    await tx.execute(sql`delete from data_conflicts where aed_id in (select id from aed_records where is_demo=true)
      or observation_id in (select id from source_observations where aed_id in (select id from aed_records where is_demo=true))`);
    await tx.execute(sql`delete from duplicate_candidates where first_id in (select id from aed_records where is_demo=true)
      or second_id in (select id from aed_records where is_demo=true)`);
    await tx.execute(sql`delete from validation_issues where aed_id in (select id from aed_records where is_demo=true)`);
    await tx.execute(sql`delete from submissions where aed_id in (select id from aed_records where is_demo=true)`);
    await tx.execute(sql`delete from conflict_reports where aed_id in (select id from aed_records where is_demo=true)`);
    await tx.execute(sql`delete from observation_versions where observation_id in (select id from source_observations where aed_id in (select id from aed_records where is_demo=true))`);
    await tx.execute(sql`delete from source_observations where aed_id in (select id from aed_records where is_demo=true)`);
    await tx.execute(sql`delete from audit_logs where entity_id in (select id from aed_records where is_demo=true)`);
    await tx.execute(sql`delete from aed_records where is_demo=true`);
    await tx.execute(sql`delete from import_errors where job_id in (select id from import_jobs where is_demo=true)`);
    await tx.execute(sql`delete from import_jobs where is_demo=true`);
    await tx.execute(sql`delete from data_sources where key is null and id in
      ('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000003')
      and not exists (select 1 from source_observations o where o.source_id=data_sources.id)
      and not exists (select 1 from import_jobs j where j.source_id=data_sources.id)
      and not exists (select 1 from import_errors e where e.source_id=data_sources.id)`);
    return removed;
  });
}
