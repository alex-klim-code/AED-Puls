import { isNotNull, sql } from "drizzle-orm";
import { db, sources, observations } from "@workspace/db";

type RegisteredSource = typeof sources.$inferSelect;
type Section = "aed" | "catalogue" | "auxiliary";
type Endpoint = { sourceId: string | null; url: string | null };
const warsawCatalogue = "https://dane.um.warszawa.pl/pl/catalogue/7bc32ffc-c2ac-4d32-83c9-b6f7a0b38de8";
const text = (value: unknown) => typeof value === "string" ? value : "";
const officialDataset = (value: unknown) => text(value).match(/^https:\/\/api\.dane\.gov\.pl\/1\.4\/datasets\/(\d+)(?:[,/?#]|$)/)?.[1];
const httpUrl = (value: unknown) => {
  try { const url = new URL(text(value)); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
};
function identity(source: RegisteredSource) {
  if (section(source) !== "aed") return { key: `source:${source.id}`, publisher: null, reason: "" };
  const evidence = source.provenanceEvidence;
  const dataset = officialDataset(evidence.datasetApiUrl);
  if (dataset && dataset === text(evidence.datasetId) &&
      ["official_api_dataset_resource_institution", "municipal_metadata_official_catalogue_cross_reference"].includes(text(evidence.method))) {
    return { key: `gov:${dataset}`, publisher: text(evidence.publisherId) ? `gov:${evidence.publisherId}` : null,
      reason: `Potwierdzone powiązanie z katalogiem: ${evidence.datasetApiUrl}.` };
  }
  if (source.key === `dane-gov:${source.datasetId}` && /^\d+$/.test(source.datasetId) &&
      source.datasetUrl === `https://dane.gov.pl/pl/dataset/${source.datasetId}`) {
    return { key: `gov:${source.datasetId}`, publisher: source.publisherId ? `gov:${source.publisherId}` : null,
      reason: `Zbiór ${source.datasetId} oryginalnego wydawcy, odnaleziony przez dane.gov.pl.` };
  }
  // Reviewed 2026-11-21 against resource 2512040: both link and file_url point to this exact city catalogue.
  if (source.key === "warszawa" && source.url === warsawCatalogue) {
    return { key: "gov:39512", publisher: "gov:7621",
      reason: "https://api.dane.gov.pl/1.4/resources/2512040 wskazuje ten sam katalog Warszawy. To jeden zbiór, a nie dwa niezależne źródła." };
  }
  return { key: `source:${source.id}`, publisher: null, reason: "" };
}
function section(source: RegisteredSource): Section {
  if (source.key === "geoportal" || source.sourceType === "wms") return "auxiliary";
  if (source.key === "dane-gov" || (source.sourceType === "catalogue" && source.key !== "warszawa")) return "catalogue";
  return "aed";
}
function serialize(source: RegisteredSource) {
  return { ...source, lastCheckedAt: source.lastCheckedAt?.toISOString() ?? null };
}
export function buildSourceDirectory(registered: RegisteredSource[], observedEndpoints: Endpoint[] = []) {
  const groups = new Map<string, RegisteredSource[]>();
  for (const source of registered) {
    const key = `${section(source)}:${identity(source).key}`;
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  const publishers = new Set<string>();
  const entries = [...groups.values()].map(members => {
    // Prefer the original publisher's catalogue metadata, not an alias or discovery service.
    const primary = members.find(s => s.sourceType === "catalogue_dataset") ?? members[0]!;
    const category = section(primary);
    if (category === "aed" && members.some(s => s.status !== "requires_configuration")) {
      const publisher = members.some(s => s.key === "openaedmap" || s.key === "openaed-eu") ? "osm" :
        members.map(s => identity(s).publisher).find(Boolean) ??
        (primary.institution.trim() && primary.institution !== "UNKNOWN" ? `publisher:${primary.institution.trim().toLocaleLowerCase("pl-PL")}` : null);
      if (publisher) publishers.add(publisher);
    }
    const endpoints = new Set<string>();
    const add = (value: unknown) => {
      const url = httpUrl(value);
      if (!url) return;
      const parsed = new URL(url);
      // Per-device provenance pages are not integration endpoints (OSM has thousands of them).
      if (/(^|\.)openstreetmap\.org$/.test(parsed.hostname) && /^\/(?:api\/0\.6\/)?(?:node|way|relation)\/\d+/.test(parsed.pathname)) return;
      endpoints.add(url);
    };
    for (const s of members) {
      add(s.url); add(s.datasetUrl);
      if (category === "aed") for (const key of ["datasetApiUrl", "resourceApiUrl", "distributionUrl", "sharedDistributionUrl", "municipalDatasetMetadata", "municipalResourceMetadata"]) add(s.provenanceEvidence[key]);
      if (s.key === "warszawa") { add("https://api.dane.gov.pl/1.4/datasets/39512"); add("https://api.dane.gov.pl/1.4/resources/2512040"); }
    }
    const memberIds = new Set(members.map(s => s.id));
    for (const endpoint of observedEndpoints) if (endpoint.sourceId && memberIds.has(endpoint.sourceId)) add(endpoint.url);
    const healthy = new Set(["succeeded", "connected", "ready"]);
    const hasHealthy = members.some(s => healthy.has(s.status));
    const hasProblem = members.some(s => !healthy.has(s.status));
    const status = members.some(s => s.status === "running") ? "running" :
      members.some(s => s.status === "partial") || (members.length > 1 && hasHealthy && hasProblem) ? "partial" :
      members.every(s => healthy.has(s.status)) ? (members.some(s => s.status === "succeeded") ? "succeeded" : primary.status) : primary.status;
    const dates = members.flatMap(s => s.lastCheckedAt ? [s.lastCheckedAt.getTime()] : []);
    return { ...serialize(primary), id: `${category}:${identity(primary).key}`, section: category, status,
      lastCheckedAt: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
      license: [...new Set(members.map(s => s.license))].join("; "),
      statusMessage: category === "auxiliary" ? "Warstwa WMS oparta na OSM. Nie importujemy obrazów ani rekordów; nie jest niezależnym wydawcą AED." :
        category === "catalogue" ? "Katalog wyszukuje zbiory. Wydawcami rekordów są instytucje poszczególnych zbiorów, pokazane w sekcji źródeł AED." :
        members.length > 1 ? "Jeden zbiór dostępny przez kilka kanałów. Szczegółowe statusy i historie importów zachowano osobno." : primary.statusMessage,
      endpoints: [...endpoints].sort(), memberSources: members.map(serialize),
      groupingEvidence: [...new Set(members.map(s => identity(s).reason).filter(Boolean))] };
  }).sort((a, b) => a.name.localeCompare(b.name, "pl"));
  return {
    entries,
    integrationCount: registered.filter(s => s.sourceType !== "catalogue_dataset" && !s.provenanceEvidence.parentSourceId).length,
    independentPublisherCount: publishers.size,
  };
}
export async function sourceDirectory() {
  const registered = await db.select().from(sources).where(isNotNull(sources.key));
  const endpoints = await db.execute<{ sourceId: string; url: string }>(sql`
    select distinct o.source_id as "sourceId", endpoint.url from ${observations} o
    cross join lateral (values (o.original_record#>>'{context,url}'), (o.dataset_url),
      (o.provenance_evidence->>'downloadUrl'),
      (o.provenance_evidence->>'resourceApiUrl'), (o.provenance_evidence->>'distributionUrl'),
      (o.provenance_evidence->>'sharedDistributionUrl')) endpoint(url)
    where o.source_id is not null and endpoint.url is not null`);
  const directory=buildSourceDirectory(registered,endpoints.rows);
  return directory;
}
