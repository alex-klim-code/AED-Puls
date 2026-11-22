import test from "node:test";
import assert from "node:assert/strict";
import { buildSourceDirectory } from "../src/modules/source-directory";
import { GetSourceDirectoryResponse } from "@workspace/api-zod";

type Row = Parameters<typeof buildSourceDirectory>[0][number];
let id = 0;
function source(overrides: Partial<Row> = {}): Row {
  const key = `fixture-${++id}`;
  return { id: key, key, name: key, url: `https://example.org/${key}`, license: "UNKNOWN",
    coverage: "Polska", institution: "Wydawca", datasetId: key, updateFrequency: "Codziennie",
    authoritativeScope: "Metadane wydawcy", status: "succeeded", statusMessage: "Odczytano",
    lastCheckedAt: new Date("2026-11-21T16:07:00Z"), lastSuccessAt: null, lockedUntil: null,
    lockToken: null, officialProvenance: "UNKNOWN", sourceType: "api", publisherId: null,
    datasetUrl: null, resourceId: null, provenanceEvidence: {}, lastUpdatedAt: null, lastSyncedAt: null, ...overrides };
}
function government(dataset: string, publisher: string) {
  return source({ key: `dane-gov:${dataset}`, datasetId: dataset, publisherId: publisher,
    datasetUrl: `https://dane.gov.pl/pl/dataset/${dataset}`, sourceType: "catalogue_dataset",
    institution: `Wydawca ${publisher}`, provenanceEvidence: { parentSourceId: "catalogue" } });
}
test("Warsaw city catalogue and official resource form one entry with every known endpoint", () => {
  const city = source({ key: "warszawa", sourceType: "catalogue", datasetId: "7bc32ffc-c2ac-4d32-83c9-b6f7a0b38de8",
    url: "https://dane.um.warszawa.pl/pl/catalogue/7bc32ffc-c2ac-4d32-83c9-b6f7a0b38de8", status: "unavailable" });
  const portal = government("39512", "7621");
  portal.status = "unavailable";
  const result = buildSourceDirectory([city, portal], [{ sourceId: portal.id, url: "https://example.org/historical-endpoint" }]);
  assert.equal(result.entries.length, 1); assert.equal(result.entries[0]!.memberSources.length, 2);
  assert.equal(result.entries[0]!.section, "aed"); assert.equal(result.independentPublisherCount, 1);
  assert.equal(result.integrationCount, 1); assert.equal(result.entries[0]!.status, "unavailable");
  assert.ok(result.entries[0]!.endpoints.includes(city.url));
  assert.ok(result.entries[0]!.endpoints.includes("https://api.dane.gov.pl/1.4/resources/2512040"));
  assert.ok(result.entries[0]!.endpoints.includes("https://example.org/historical-endpoint"));
  GetSourceDirectoryResponse.parse(result);
});
test("Przemysl cross-reference counts the city and its municipal unit as one publisher of the same dataset", () => {
  const city = source({ key: "przemysl", institution: "Straż Miejska w Przemyślu", datasetId: "13",
    provenanceEvidence: { method: "municipal_metadata_official_catalogue_cross_reference",
      datasetId: "4581", publisherId: "145", datasetApiUrl: "https://api.dane.gov.pl/1.4/datasets/4581",
      sharedDistributionUrl: "https://przemysl.skycms.com.pl/open-data/20/1730818801_b50R6UVxPgoVdBbq/geojson" } });
  const result = buildSourceDirectory([city, government("4581", "145")]);
  assert.equal(result.entries.length, 1); assert.equal(result.independentPublisherCount, 1);
  assert.equal(result.entries[0]!.memberSources.length, 2);
});
test("Krosno, Marki and any different official datasets remain separate entries", () => {
  const result = buildSourceDirectory([government("3624", "229"), government("4955", "537"), government("999", "229")]);
  assert.equal(result.entries.length, 3); assert.equal(result.independentPublisherCount, 2);
  assert.equal(result.integrationCount, 0);
});
test("a matching city name or copied AEDs alone never merges independent publications", () => {
  const one = source({ name: "AED Warszawa", institution: "Wydawca A" });
  const two = source({ name: "AED Warszawa", institution: "Wydawca B" });
  const result = buildSourceDirectory([one, two]);
  assert.equal(result.entries.length, 2); assert.equal(result.independentPublisherCount, 2);
});
test("catalogue and WMS stay outside publisher and AED dataset counts; OpenAED requires configuration", () => {
  const catalogue = source({ key: "dane-gov", sourceType: "catalogue" });
  const wms = source({ key: "geoportal", sourceType: "wms", status: "dependent" });
  const optional = source({ key: "openaed-eu", status: "requires_configuration" });
  const result = buildSourceDirectory([catalogue, wms, optional]);
  assert.equal(result.integrationCount, 3); assert.equal(result.independentPublisherCount, 0);
  assert.deepEqual(result.entries.map(s => s.section).sort(), ["aed", "auxiliary", "catalogue"]);
  assert.equal(result.entries.find(s => s.memberSources[0]!.id === optional.id)!.status, "requires_configuration");
});
test("a failed alternate endpoint cannot hide a successful channel or lose its separate diagnostic", () => {
  const one = government("4581", "145"), two = government("4581", "145");
  two.status = "unavailable"; two.statusMessage = "Błąd endpointu"; two.lastCheckedAt = new Date("2026-11-21T17:08:00Z");
  const result = buildSourceDirectory([one, two]);
  assert.equal(result.entries[0]!.status, "partial");
  assert.equal(result.entries[0]!.lastCheckedAt, "2026-11-21T17:08:00.000Z");
  assert.equal(result.entries[0]!.memberSources[1]!.statusMessage, "Błąd endpointu");
});
test("presentation does not mutate source identities, diagnostics, licenses or historical endpoints", () => {
  const input = [government("4581", "145"), government("4581", "145")];
  const before = JSON.stringify(input);
  buildSourceDirectory(input);
  assert.equal(JSON.stringify(input), before);
});
test("OpenAED derived from OSM is not an additional independent publisher", () => {
  const result = buildSourceDirectory([source({ key: "openaedmap" }), source({ key: "openaed-eu", status: "connected" })]);
  assert.equal(result.independentPublisherCount, 1); assert.equal(result.entries.length, 2);
});
test("catalogue diagnostics from its last discovery do not turn it into that dataset or duplicate a group ID", () => {
  const catalogue = source({ key: "dane-gov", sourceType: "catalogue", provenanceEvidence: {
    method: "official_api_dataset_resource_institution", datasetApiUrl: "https://api.dane.gov.pl/1.4/datasets/4955",
    datasetId: "4955", publisherId: "537", resourceApiUrl: "https://api.dane.gov.pl/1.4/resources/68355" } });
  const result = buildSourceDirectory([catalogue, government("4955", "537")]);
  assert.equal(result.entries.length, 2); assert.equal(new Set(result.entries.map(s => s.id)).size, 2);
  assert.equal(result.independentPublisherCount, 1);
  assert.ok(!result.entries.find(s => s.section === "catalogue")!.endpoints.some(url => url.includes("/resources/68355")));
});
test("individual OSM device pages are not rendered as thousands of integration endpoints", () => {
  const osm = source({ key: "openaedmap", url: "https://openaedmap.org/api/v1/countries/PL.geojson" });
  const result = buildSourceDirectory([osm], [
    { sourceId: osm.id, url: "https://www.openstreetmap.org/node/10000112225" },
    { sourceId: osm.id, url: "https://www.openstreetmap.org/way/123" },
    { sourceId: osm.id, url: "https://aed.openstreetmap.org.pl/aed_poland.geojson" },
  ]);
  assert.deepEqual(result.entries[0]!.endpoints, [
    "https://aed.openstreetmap.org.pl/aed_poland.geojson",
    "https://openaedmap.org/api/v1/countries/PL.geojson",
  ]);
});
