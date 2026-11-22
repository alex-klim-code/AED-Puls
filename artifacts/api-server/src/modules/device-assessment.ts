import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { db, aeds, auditLogs } from "@workspace/db";
import { AssessDeviceBody } from "@workspace/api-zod";
import { fail, requireUser } from "./auth";
import { serializeAed } from "./aeds";

export function registerDeviceAssessment(app: FastifyInstance) {
  app.post("/api/device-assessment", async req => {
    const user = requireUser(req, ["ADMIN", "PROVIDER"]);
    const input = AssessDeviceBody.parse(req.body);
    const verified = ["VERIFIED_BY_OPERATOR", "VERIFIED_BY_AUTHORIZED_REVIEWER"].includes(input.recordVerificationStatus);
    if (input.evidence.trim().length < 10) fail(400, "Opisz konkretny dowód oceny urządzenia.");
    if (input.evidenceUrl && !/^https?:\/\/[^\s]+$/i.test(input.evidenceUrl)) fail(400, "Dowód musi wskazywać adres HTTP lub HTTPS.");
    const date = input.verifiedAt ? new Date(input.verifiedAt) : null;
    if (verified && (!date || !Number.isFinite(date.getTime()) || date.getTime() > Date.now())) fail(400, "Podaj rzeczywistą, nieprzyszłą datę weryfikacji.");
    if (!verified && input.operationalStatus !== "UNKNOWN") fail(400, "Sprawność wymaga oceny uprawnionego weryfikującego i dowodu.");
    if (input.recordVerificationStatus === "VERIFIED_BY_OPERATOR" && user.role !== "PROVIDER") fail(403, "Tylko operator własnego urządzenia może wybrać tę kategorię.");
    if (input.recordVerificationStatus === "VERIFIED_BY_AUTHORIZED_REVIEWER" && user.role !== "ADMIN") fail(403, "Ta ocena wymaga roli uprawnionego administratora.");
    const result = await db.transaction(async tx => {
      const [record] = await tx.select().from(aeds).where(and(eq(aeds.id, input.aedId), eq(aeds.isDemo, false))).for("update");
      if (!record || record.mergedIntoId) fail(404, "Nie znaleziono urządzenia w Twoim środowisku.");
      if (user.role === "PROVIDER" && (!user.organizationId || user.organizationId !== record.organizationId)) fail(403, "Operator może oceniać wyłącznie urządzenia własnej organizacji.");
      const [updated] = await tx.update(aeds).set({
        recordVerificationStatus: input.recordVerificationStatus, deviceOperationalStatus: input.operationalStatus,
        verifiedAt: verified ? date : null, updatedAt: new Date(),
        verificationEvidence: { statement: input.evidence.trim(), url: input.evidenceUrl || null, reviewerRole: user.role, registeredAt: new Date().toISOString() },
      }).where(eq(aeds.id, record.id)).returning();
      await tx.insert(auditLogs).values({ userId: user.id, entityId: record.id, isDemo: user.isDemo,
        action: "Zapisano ocenę urządzenia z dowodem", details: { previous: { recordVerificationStatus: record.recordVerificationStatus, operationalStatus: record.deviceOperationalStatus, verifiedAt: record.verifiedAt, evidence: record.verificationEvidence }, assessment: input } });
      return updated!;
    });
    return serializeAed(result);
  });
}
