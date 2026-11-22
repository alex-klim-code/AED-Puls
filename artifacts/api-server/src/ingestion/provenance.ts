import { eq, inArray } from "drizzle-orm";
import { db, aeds, observations, sources } from "@workspace/db";

export async function provenanceMap(ids: string[]) {
  const result = new Map<string, {
    sourceName: string; sourceRecordId: string; sourceUrl: string; publisher: string | null; license: string;
    datasetUrl: string | null; resourceId: string | null; importedAt: string; lastSyncedAt: string; sourceModifiedAt: string | null;
    sourceCategory: string; provenanceEvidence: Record<string, unknown>; publisherId: string | null;
    datasetId: string | null; datasetTitle: string | null; resourceFormat: string | null; publishedAt: string | null;
    geographicScope: string | null; referenceScope: string | null; reuseConditions: Record<string, unknown>;
    attributes: Record<string,unknown>; primarySourceKey: string|null; removedAt:string|null;
  }[]>();
  if (!ids.length) return result;
  const family = await db.select({ id: aeds.id, mergedIntoId: aeds.mergedIntoId }).from(aeds);
  const links = new Map(family.map(a => [a.id, a.mergedIntoId]));
  const wanted = new Set(ids);
  const roots = new Map<string, string>();
  for (const row of family) {
    let root = row.id;
    for (let depth = 0; links.get(root) && depth < 100; depth++) root = links.get(root)!;
    if (wanted.has(root)) roots.set(row.id, root);
  }
  if (!roots.size) return result;
  const records = await db.select({
    aedId: observations.aedId, sourceName: sources.name, fallbackName: aeds.sourceName,
    sourceRecordId: observations.sourceRecordId, sourceUrl: observations.sourceUrl,
    publisher: observations.publisher, license: observations.license, datasetUrl: observations.datasetUrl,
    resourceId: observations.resourceId, importedAt: observations.importedAt, lastSyncedAt: observations.lastSyncedAt,
    sourceModifiedAt: observations.sourceModifiedAt,
    sourceCategory: observations.officialProvenance, provenanceEvidence: observations.provenanceEvidence,
    publisherId: observations.publisherId, datasetId: observations.datasetId, datasetTitle: observations.datasetTitle,
    resourceFormat: observations.resourceFormat, publishedAt: observations.publishedAt, geographicScope: observations.geographicScope,
    referenceScope: observations.referenceScope, reuseConditions: observations.reuseConditions,
    attributes:observations.normalizedRecord,primarySourceKey:observations.primarySourceKey,removedAt:observations.removedAt,
  }).from(observations).leftJoin(sources, eq(observations.sourceId, sources.id)).leftJoin(aeds, eq(observations.aedId, aeds.id))
    .where(inArray(observations.aedId, [...roots.keys()]));
  for (const row of records) {
    const id = roots.get(row.aedId!)!;
    const items = result.get(id) ?? [];
    items.push({
      sourceName: row.sourceName ?? row.fallbackName ?? "UNKNOWN", sourceRecordId: row.sourceRecordId, sourceUrl: row.sourceUrl,
      publisher: row.publisher, license: row.license, datasetUrl: row.datasetUrl, resourceId: row.resourceId,
      importedAt: row.importedAt.toISOString(), lastSyncedAt: row.lastSyncedAt.toISOString(), sourceModifiedAt: row.sourceModifiedAt?.toISOString() ?? null,
      sourceCategory: row.sourceCategory, provenanceEvidence: row.provenanceEvidence, publisherId: row.publisherId,
      datasetId: row.datasetId, datasetTitle: row.datasetTitle, resourceFormat: row.resourceFormat, publishedAt: row.publishedAt?.toISOString() ?? null,
      geographicScope: row.geographicScope, referenceScope: row.referenceScope, reuseConditions: row.reuseConditions,
      attributes:row.attributes??{},primarySourceKey:row.primarySourceKey,removedAt:row.removedAt?.toISOString()??null,
    });
    result.set(id, items);
  }
  return result;
}
