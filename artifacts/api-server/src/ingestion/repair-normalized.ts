import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, sources, observations, observationVersions, auditLogs } from "@workspace/db";
import { normalizeRow, type ImportRow } from "./normalize";

// Repair old, linked publications that lost their normalized snapshot solely because
// the old normalizer rejected missing fields. Never copy another provider's canonical data.
export async function repairNormalizedPublications(sourceIds?: string[]) {
  if (sourceIds && !sourceIds.length) return {repaired:0};
  const groups = await db.selectDistinct({sourceId:observations.sourceId}).from(observations)
    .where(and(isNull(observations.normalizedRecord),isNotNull(observations.aedId),isNull(observations.removedAt),
      sourceIds ? inArray(observations.sourceId,sourceIds) : undefined));
  let repaired = 0;
  for (const group of groups) {
    if (!group.sourceId) continue;
    repaired += await db.transaction(async tx => {
      const [source] = await tx.select().from(sources).where(eq(sources.id,group.sourceId!)).for("update");
      if (!source || (source.lockedUntil && source.lockedUntil > new Date())) return 0;
      const rows = await tx.select().from(observations).where(and(eq(observations.sourceId,source.id),
        isNull(observations.normalizedRecord),isNotNull(observations.aedId),isNull(observations.removedAt))).for("update");
      let count = 0;
      for (const observation of rows) {
        let normalized: ReturnType<typeof normalizeRow>;
        try {
          const original = observation.originalRecord as Record<string,any>;
          const packet = original.encoding === "json-string" ? JSON.parse(String(original.payload)) : original;
          if (!packet.record || !packet.context || typeof packet.context.url !== "string" ||
            packet.context.license !== observation.license) continue;
          normalized = normalizeRow({original:packet.record,context:packet.context} as ImportRow);
        } catch (error) {
          if (!(error instanceof SyntaxError || error instanceof TypeError)) throw error;
          continue;
        }
        if (!normalized.data) continue;
        const contentHash = createHash("sha256").update(JSON.stringify(["export-normalization",observation.originalRecord,normalized.data])).digest("hex");
          await tx.insert(observationVersions).values({observationId:observation.id,contentHash,
            document:{kind:"normalized_snapshot_repair",original:observation.originalRecord,before:null,after:normalized.data,issues:normalized.issues}}).onConflictDoNothing();
          await tx.update(observations).set({normalizedRecord:normalized.data}).where(eq(observations.id,observation.id));
          await tx.insert(auditLogs).values({action:"repair_publication_normalization",entityId:observation.aedId,
            details:{observationId:observation.id,sourceId:source.id,before:null,after:normalized.data,originalPreserved:true}});
          count++;
      }
      return count;
    });
  }
  return {repaired};
}
