import { db, pool, users, auditLogs, adminBootstrap } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

// Run only by the app owner in a trusted shell after their first Google login.
// No HTTP bootstrap endpoint and no email-based role assignment.
const subject = process.argv[2];
if (!subject || !/^\d{5,40}$/.test(subject)) throw new Error("Podaj zweryfikowany identyfikator Google sub jako argument.");
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(8424519)`);
    const [used] = await tx.select().from(adminBootstrap).where(eq(adminBootstrap.id, "initial-admin"));
    if (used) throw new Error("Jednorazowy bootstrap został już wykorzystany.");
    const existing = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "ADMIN"), eq(users.isDemo, false))).limit(1);
    if (existing.length) throw new Error("Administrator już istnieje. Jednorazowy bootstrap jest zablokowany.");
    const [account] = await tx.select().from(users).where(and(eq(users.googleSubject, subject), eq(users.isDemo, false))).for("update");
    if (!account) throw new Error("Brak konta z tym Google sub. Najpierw zaloguj się przez Google.");
    await tx.update(users).set({ role: "ADMIN" }).where(eq(users.id, account.id));
    await tx.insert(adminBootstrap).values({ id: "initial-admin", userId: account.id });
    await tx.insert(auditLogs).values({ userId: account.id, entityId: account.id, action: "Jednorazowe ustanowienie administratora", isDemo: false });
  });
  console.info("Ustanowiono pierwszego administratora. Następne wywołania będą odrzucane.");
} finally {
  await pool.end();
}
