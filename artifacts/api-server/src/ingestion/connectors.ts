import type { Issue, SourceContext } from "./normalize";
import { governmentBatches } from "./government";
import { download, downloadJson } from "./http";
import { parseResource } from "./parsers";
import { canonicalLicense, clean } from "./normalize";
import { API_ROOT, officialEntityUrl, governmentEvidence } from "./official";
import { pages } from "./government";
import { openAedBatches } from "./optional-connectors";
import { resourceFingerprint } from "./resource-identity";

export type SourceKey = "dane-gov" | "openaedmap" | "przemysl" | "warszawa" | "openaed-eu";
type Definition = {
  key: SourceKey; name: string; url: string; license: string; coverage: string;
  institution: string; datasetId: string; authoritativeScope: string;
};
export const SOURCE_DEFINITIONS: readonly Definition[] = [{
  key: "dane-gov", name: "dane.gov.pl — zasoby AED",
  url: "https://api.dane.gov.pl/1.4/datasets",
  license: "Różne — sprawdź licencję każdego rekordu", coverage: "Polska",
  institution: "Wydawcy poszczególnych zbiorów dane.gov.pl", datasetId: "discovery",
  authoritativeScope: "Katalog metadanych i zasoby ich wydawców",
},
  { key: "openaedmap", name: "OpenAEDMap / OpenStreetMap Polska", url: "https://openaedmap.org/api/v1/countries/PL.geojson", license: "ODbL-1.0", coverage: "Polska", institution: "Współtwórcy OpenStreetMap / OpenAEDMap", datasetId: "PL", authoritativeScope: "Dane społecznościowe, bez potwierdzenia sprawności" },
  { key: "przemysl", name: "Otwarte Dane Przemyśl — AED", url: "https://dane.przemysl.eu/wp-json/sod/v1/resources/15/data?format=geojson", license: "CC-BY-4.0", coverage: "Przemyśl", institution: "Straż Miejska w Przemyślu", datasetId: "13", authoritativeScope: "Lokalizacje wskazane przez wydawcę miejskiego" },
  { key: "warszawa", name: "Otwarte Dane Warszawa — AED", url: "https://dane.um.warszawa.pl/pl/catalogue/7bc32ffc-c2ac-4d32-83c9-b6f7a0b38de8", license: "UNKNOWN", coverage: "Warszawa", institution: "Urząd m.st. Warszawy", datasetId: "39512", authoritativeScope: "Rzeczywisty katalog AED i zasób dane.gov.pl 2512040" },
  { key: "openaed-eu", name: "OpenAED.eu", url: "https://github.com/openaed/api", license: "ODbL-1.0", coverage: "Wymaga potwierdzenia instancji dla Polski", institution: "OpenAED", datasetId: "unconfirmed-pl", authoritativeScope: "Dane pochodne OSM; brak domniemania niezależnego potwierdzenia" },
];
export const REVIEWED_SOURCES = [{
  key: "geoportal", name: "Geoportal — warstwa Defibrylatory (OSM)", url: "https://mapy.geoportal.gov.pl/wss/ext/OSM/Defibrylatory",
  license: "ODbL-1.0", coverage: "Polska", institution: "GUGiK / współtwórcy OpenStreetMap", datasetId: "OSM/Defibrylatory",
  authoritativeScope: "WMS wizualizuje dane OSM, nie jest niezależnym wydawcą lokalizacji", status: "dependent",
  statusMessage: "Warstwa pomocnicza WMS oparta na OSM — bez importowania rekordów.", sourceType: "wms",
}];
export type ConnectorBatch = {
  context: SourceContext; rows: Record<string, any>[]; issue?: Issue; metadata?: Record<string, unknown>;
};
export async function* connectSource(key: SourceKey, options: { probe?: boolean; datasetId?: string } = {}): AsyncGenerator<ConnectorBatch> {
  const d = SOURCE_DEFINITIONS.find(s => s.key === key);
  if (!d) throw new Error("Nieznana integracja danych AED.");
  const base: SourceContext = {
    name: d.name, publisher: d.institution, license: d.license, url: d.url,
    datasetUrl: d.url, datasetId: d.datasetId, resourceId: d.key, coverage: d.coverage,
    modified: null, sourceCategory: "UNKNOWN",
  };
  if (key === "openaed-eu") { yield* openAedBatches(base, options.probe); return; }
  if (key === "dane-gov" || key === "warszawa") {
    yield* governmentBatches(base, key === "warszawa" ? { ...options, datasetId: "39512" } : options); return;
  }
  if (key === "openaedmap") {
    const context: SourceContext = { ...base, sourceCategory: "COMMUNITY_OPEN_DATA", resourceFormat: "geojson",
      provenanceEvidence: { method: "community_osm_export", attribution: "© współtwórcy OpenStreetMap" } };
    let rows: Record<string, any>[];
    try {
      rows = await parseResource(await download(context.url), "geojson");
      if (!rows.length) throw new Error("Pusty eksport krajowy.");
    } catch (error) {
      yield { context, rows: [], issue: { severity: "warning", rule: "fallback_source",
        message: `OpenAEDMap: ${(error as Error).message}. Próba zapasowego eksportu OSM.` } };
      context.url = "https://aed.openstreetmap.org.pl/aed_poland.geojson";
      rows = await parseResource(await download(context.url), "geojson");
      context.provenanceEvidence = { ...context.provenanceEvidence, fallbackUsed: true, downloadUrl: context.url };
    }
    yield { context, rows, metadata: { source: "OpenAEDMap country export PL",
      attribution: "© współtwórcy OpenStreetMap", licenseUrl: "https://www.openstreetmap.org/copyright" } };
    return;
  }
  const [resource, dataset] = await Promise.all([
    downloadJson("https://dane.przemysl.eu/wp-json/sod/v1/resources/15"),
    downloadJson("https://dane.przemysl.eu/wp-json/sod/v1/datasets/13"),
  ]);
  const context: SourceContext = { ...base,
    publisher: clean(dataset.publisher), license: canonicalLicense(resource.license_url || dataset.license_uri || dataset.license),
    datasetUrl: clean(dataset.permalink), resourceId: "15", modified: clean(dataset.updated) || null,
    datasetTitle: clean(dataset.title), resourceFormat: "geojson", referenceScope: "Lokalizacje AED publikowane przez miasto",
    reuseConditions: { licenseUrl: resource.license_url || dataset.license_uri || null } };
  try {
    const [officialDataset, catalogueResources] = await Promise.all([
      downloadJson(`${API_ROOT}/datasets/4581`), pages(`${API_ROOT}/datasets/4581/resources`),
    ]);
    const pubId = String((officialDataset.data as any)?.relationships?.institution?.data?.id ?? "");
    const institution = (await downloadJson(officialEntityUrl(`${API_ROOT}/institutions/${pubId}`, "institutions", pubId))).data as any;
    const linked = catalogueResources.find(r => r.attributes?.link === resource.source_url);
    if (!linked || institution?.attributes?.institution_type !== "local"
      || !/przemysl\.pl\/?$/i.test(String(institution.attributes.website))
      || String(resource.dataset_id) !== "13" || dataset.identifier !== "PRZ-DEFIBRYLATOR"
      || new URL(context.datasetUrl).origin !== "https://dane.przemysl.eu")
      throw new Error("Brak zgodnego urzędowego powiązania portalu, wydawcy i zasobu.");
    context.provenanceEvidence = { ...governmentEvidence(officialDataset.data, linked, institution),
      method: "municipal_metadata_official_catalogue_cross_reference",
      municipalResourceMetadata: "https://dane.przemysl.eu/wp-json/sod/v1/resources/15",
      municipalDatasetMetadata: "https://dane.przemysl.eu/wp-json/sod/v1/datasets/13", sharedDistributionUrl: resource.source_url };
    context.sourceCategory = "OFFICIAL_LOCAL_GOVERNMENT";
    context.publisherId = dataset.publisher_id == null ? null : String(dataset.publisher_id);
  } catch (error) { context.provenanceWarning = `Nie potwierdzono aktualnie urzędowego pochodzenia: ${(error as Error).message}`; }
  let next: string | null = context.url;
  const visited = new Set<string>();
  for (let page = 1; next && page <= 50; page++) {
    const url: URL = new URL(next);
    if (url.origin !== "https://dane.przemysl.eu" || !url.pathname.startsWith("/wp-json/sod/v1/resources/15/data") || visited.has(url.href))
      throw new Error("Nieprawidłowy lub zapętlony odnośnik paginacji Przemyśla.");
    visited.add(url.href);
    const body = await download(url.href), document = JSON.parse(body.toString("utf8"));
    const rows = await parseResource(body, "geojson");
    context.provenanceEvidence = { ...context.provenanceEvidence, resourceFingerprint: resourceFingerprint(rows) };
    yield { context, rows, metadata: { resource, dataset, page } };
    const link = document.links?.next;
    next = typeof link === "string" ? new URL(link, url).href : link?.href ? new URL(link.href, url).href : null;
    const total = Number(document.meta?.last_page ?? document.total_pages ?? 1);
    if (!next && total > page) { url.searchParams.set("page", String(page + 1)); next = url.href; }
  }
  if (next) throw new Error("Przekroczono bezpieczny limit 50 stron Przemyśla; import nie jest pełnym snapshotem.");
}
