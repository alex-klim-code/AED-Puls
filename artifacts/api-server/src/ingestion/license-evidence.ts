import { createHash } from "node:crypto";
import { eq, isNotNull, sql } from "drizzle-orm";
import { db, sources, observations, auditLogs } from "@workspace/db";
import { canonicalLicense } from "./normalize";
import { logger } from "../lib/logger";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v);
export function supportedGovernmentConditions(conditions: Record<string, unknown>) {
  const allowed = new Set(["license_name", "license_chosen", "license_condition_default_cc40"]);
  const chosen = conditions.license_chosen;
  const declared = canonicalLicense(conditions.license_name || (conditions.license_condition_default_cc40 === true ? "CC BY 4.0" : ""));
  return (!chosen || canonicalLicense(chosen) === declared) &&
    Object.entries(conditions).every(([key,value]) => allowed.has(key) || value === null || value === "" || value === false);
}
async function document(url: string) {
  // URLs come exclusively from the fixed official origins below, never request parameters.
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
  if (!response.ok) throw new Error(`Metadane licencji: HTTP ${response.status}.`);
  const body = await response.text();
  if (Buffer.byteLength(body) > 512_000) throw new Error("Dokument licencji przekracza limit.");
  return { url, body, sha256: sha(body), retrievedAt: new Date().toISOString(), status: response.status };
}
export async function refreshLicenseEvidence() {
  const registered = await db.select().from(sources).where(isNotNull(sources.key));
  let verified = 0;
  for (const source of registered) {
    if (!["openaedmap","przemysl"].includes(source.key ?? "") && !/^dane-gov:\d+$/.test(source.key ?? "")) continue;
    const old = source.provenanceEvidence.licenseEvidence as { checkedAt?: string } | undefined;
    if (old?.checkedAt && Date.now() - Date.parse(old.checkedAt) < 86_400_000 &&
      (!source.lastSyncedAt || source.lastSyncedAt.getTime() <= Date.parse(old.checkedAt))) continue;
    try {
      const docs: Awaited<ReturnType<typeof document>>[] = [];
      const reviews: Record<string, unknown> = {};
      let evidenceLicense: string;
      if (source.key === "openaedmap") {
        const doc = await document("https://osmfoundation.org/wiki/Licence");
        if (!/Open Database Licen[cs]e|ODbL/i.test(doc.body)) throw new Error("Nie potwierdzono deklaracji ODbL.");
        docs.push(doc); evidenceLicense = "ODbL-1.0";
      } else if (source.key === "przemysl") {
        const [dataset, resource, license] = await Promise.all([
          document("https://dane.przemysl.eu/wp-json/sod/v1/datasets/13"),
          document("https://dane.przemysl.eu/wp-json/sod/v1/resources/15"),
          document("https://dane.przemysl.eu/creative-commons-cc-by-4-0/"),
        ]);
        const d = JSON.parse(dataset.body), r = JSON.parse(resource.body);
        if (d.publisher !== "Straż Miejska w Przemyślu" || Number(r.dataset_id) !== 13 ||
          d.license_uri !== license.url || !license.body.includes("creativecommons.org/licenses/by/4.0")) throw new Error("Niezgodne metadane licencji Przemyśla.");
        docs.push(license, dataset, resource); evidenceLicense = "CC-BY-4.0";
      } else {
        const datasetId = source.key!.slice(9);
        const dataset = await document(`https://api.dane.gov.pl/1.4/datasets/${datasetId}`);
        const d = JSON.parse(dataset.body).data, a = d?.attributes;
        const publisherId = String(d?.relationships?.institution?.data?.id ?? "");
        if (d?.type !== "dataset" || String(d.id) !== datasetId || !/^\d+$/.test(publisherId) || publisherId !== source.publisherId) throw new Error("Niezgodna tożsamość wydawcy.");
        const institution = await document(`https://api.dane.gov.pl/1.4/institutions/${publisherId}`);
        const publisher = JSON.parse(institution.body).data;
        if (String(publisher?.id) !== publisherId || publisher.type !== "institution") throw new Error("Nie potwierdzono wydawcy.");
        const conditions = Object.fromEntries(Object.entries(a).filter(([key]) => /license|reuse/.test(key)));
        evidenceLicense = canonicalLicense(a.license_name || (a.license_condition_default_cc40 === true ? "CC BY 4.0" : ""));
        if (!["CC0-1.0","CC-BY-4.0","ODbL-1.0"].includes(evidenceLicense) || !supportedGovernmentConditions(conditions)) throw new Error("Warunki niestandardowe wymagają ręcznej oceny.");
        const refs = await db.selectDistinct({ resourceId: observations.resourceId, sourceUrl: observations.sourceUrl,
          publisher: observations.publisher, license: observations.license, conditions: observations.reuseConditions,
          datasetUrl: observations.datasetUrl }).from(observations).where(eq(observations.sourceId, source.id));
        docs.push(dataset, institution);
        for (const ref of refs) {
          if (!ref.resourceId || !/^\d+$/.test(ref.resourceId)) continue;
          const resource = await document(`https://api.dane.gov.pl/1.4/resources/${ref.resourceId}`);
          const r = JSON.parse(resource.body).data;
          if (String(r?.relationships?.dataset?.data?.id) !== datasetId || r?.type !== "resource" ||
            ![r.attributes?.file_url, r.attributes?.link, r.attributes?.download_url].includes(ref.sourceUrl) ||
            ref.license !== evidenceLicense || ref.publisher !== publisher.attributes?.title ||
            canonical(ref.conditions) !== canonical(conditions)) {
            reviews[ref.resourceId] = { status: "requires_review", reason: "Niezgodność deklaracji rekordu z metadanymi.", checkedAt: resource.retrievedAt };
            docs.push(resource); continue;
          }
          docs.push(resource);
          const licenseUrl = evidenceLicense === "CC0-1.0" ? "https://creativecommons.org/publicdomain/zero/1.0/" :
            evidenceLicense === "CC-BY-4.0" ? "https://creativecommons.org/licenses/by/4.0/" : "https://opendatacommons.org/licenses/odbl/1-0/";
          reviews[ref.resourceId] = { status: "verified", license: evidenceLicense, sourceUrl: source.url,
            recordSourceUrlPrefix: ref.sourceUrl, datasetId, datasetUrl: ref.datasetUrl, publisher: ref.publisher,
            licenseUrl, authors: [ref.publisher], attribution: `Źródło: ${ref.publisher}; ${a.title}; ${evidenceLicense}; ${ref.datasetUrl}`,
            evidenceUrl: dataset.url, evidenceSha256: dataset.sha256, reviewedAt: dataset.retrievedAt,
            conditionsSha256: sha(JSON.stringify(ref.conditions)), additionalTermsReviewed: true };
        }
      }
      const first = docs[0]!;
      const evidence = { status: "verified", license: evidenceLicense, checkedAt: first.retrievedAt,
        evidenceUrl: first.url, evidenceSha256: first.sha256, documents: docs };
      await db.transaction(async tx => {
        await tx.update(sources).set({ provenanceEvidence: sql`${sources.provenanceEvidence} ||
          ${JSON.stringify({licenseEvidence: evidence, licenseReviews: reviews})}::jsonb` }).where(eq(sources.id, source.id));
        await tx.insert(auditLogs).values({ action: "source_license_evidence", entityId: source.id,
          details: { entityType: "source", before: source.provenanceEvidence.licenseEvidence ?? null, after: evidence, reviews } });
      });
      verified++;
    } catch (error) {
      logger.warn({ sourceKey: source.key, message: error instanceof Error ? error.message : "Nieznany błąd" }, "Nie potwierdzono nowych dowodów licencji; brak automatycznego nadania praw.");
    }
  }
  return { verified };
}
export function startLicenseEvidenceScheduler() {
  const refresh = () => { void refreshLicenseEvidence().catch(error => logger.error({ error }, "Kontrola dowodów licencji nie powiodła się.")); };
  const initial = setTimeout(refresh, 1000), daily = setInterval(refresh, 86_400_000);
  initial.unref(); daily.unref();
  return () => { clearTimeout(initial); clearInterval(daily); };
}
