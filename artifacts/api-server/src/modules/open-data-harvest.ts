import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { exportContext, knownLicenses, type ExportOptions } from "./export-dataset";
import { assessExport, legalDisclaimer, licenseTerms, modificationNotice, type KnownLicense } from "./export-rights";

// Public canonical origin verified against the existing deployment; never derive it from request Host.
const publicOrigin = "https://aedpuls.org";
const namespace = "urn:otwarte-dane:harvester:1.13";
const xsd = "https://dane.gov.pl/static/xml/otwarte_dane_latest.xsd";
const options: ExportOptions = { scope: "public", providerIds: undefined, license: undefined, licenses: [...knownLicenses] };
export const harvestCsvUrl = `${publicOrigin}/api/exports/csv?${new URLSearchParams({ scope: options.scope, licenses: options.licenses.join(",") })}`;
const escapeXml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const bilingual = (name: string, pl: string, en: string) =>
  `<${name}><polish>${escapeXml(pl)}</polish><english>${escapeXml(en)}</english></${name}>`;

export function buildHarvestXml(updatedAt: string | null, licenses: KnownLicense[]) {
  const title = bilingual("title", "Lokalizacje defibrylatorów AED w Polsce – AED Puls", "AED locations in Poland – AED Puls");
  const description = bilingual("description",
    "Publiczne dane AED w Polsce dopuszczone przez istniejącą politykę publikacji AED Puls. CSV zachowuje źródła, autorów, licencje i wymagane atrybucje każdego rekordu, także scalonego. Brak wspólnej licencji całego pliku. Aktualizacja nieregularna po zmianach dopuszczonych danych. Import nie potwierdza sprawności ani dostępności AED; w nagłym wypadku dzwoń 112.",
    "Public AED data in Poland admitted by the existing AED Puls publication policy. The CSV preserves each record's sources, authors, licences and mandatory attributions, including merged records. No single licence is assigned to the entire file. Updated irregularly when eligible data change. Import does not confirm device operation or availability; call 112 in an emergency.");
  const terms = [
    "Brak jednej wspólnej licencji / No single licence for the entire export. Licencje i obowiązki każdego źródła są zapisane w polach licenses, sources oraz sources.reuseConditions.mandatoryAttributions w CSV. Stosuj warunki właściwe dla wykorzystywanych danych; zachowaj wymagane oznaczenia twórców, źródeł, URL i zmian. Filtrowanie nie usuwa praw pochodzenia.",
    ...licenses.map(license => `${license}: ${licenseTerms[license].url} — ${licenseTerms[license].text}`),
    "Scalenie nie usuwa obowiązków ODbL (w tym share-alike i udostępnienia bazy pochodnej, gdy mają zastosowanie). Nierozstrzygnięte prawa i rekordy wykluczone przez politykę nie są udostępniane.",
  ].join("\n");
  // The current XSD has no ODbL value in dbOrCopyrightedLicenseChosen. Its optional free-text
  // conditions field carries the actual source-specific terms instead of a false global CC licence.
  if (terms.length > 4000) throw new Error("Warunki harvestera przekraczają limit XSD.");
  const modified = updatedAt ? `<lastUpdateDate>${escapeXml(updatedAt)}</lastUpdateDate>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<od:datasets xmlns:od="${namespace}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${namespace} ${xsd}">
  <dataset status="published">
    <extIdent>aed-puls-poland-aed</extIdent>
    ${title}
    ${description}
    <url>${publicOrigin}/data</url>
    <updateFrequency>irregular</updateFrequency>
    <categories><category>HEAL</category></categories>
    <conditions>
      <source>true</source>
      <modification>true</modification>
      <responsibilities>${escapeXml(`${legalDisclaimer} ${modificationNotice} Dane nie stanowią gwarancji dostępności ani sprawności AED.`)}</responsibilities>
      <dbOrCopyrighted>${escapeXml(terms)}</dbOrCopyrighted>
    </conditions>
    <resources>
      <resource status="published">
        <extIdent>aed-puls-poland-aed-csv</extIdent>
        <url>${escapeXml(harvestCsvUrl)}</url>
        ${bilingual("title", "Lokalizacje AED w Polsce — aktualny eksport CSV", "AED locations in Poland — current CSV export")}
        ${description}
        <availability>remote</availability>
        ${modified}
      </resource>
    </resources>
    <tags><tag lang="pl">AED</tag><tag lang="pl">defibrylator</tag><tag lang="pl">ratownictwo</tag><tag lang="en">AED</tag><tag lang="en">defibrillator</tag><tag lang="en">rescue</tag></tags>
    ${modified}
  </dataset>
</od:datasets>
`;
}

async function currentHarvestXml() {
  const context = await exportContext(options.scope, options.providerIds);
  const assessment = assessExport(context, options);
  let latest = 0;
  // Only actual database timestamps, never the current request time or a made-up observation date.
  for (const row of assessment.rows) for (const date of [
    row.original.updatedAt, row.ref?.lastSyncedAt, row.ref?.sourceModifiedAt,
  ]) if (date && Number.isFinite(date.getTime())) latest = Math.max(latest, date.getTime());
  const licenses = [...new Set([...assessment.accepted.values()].flatMap(group => group.attributions.map(a => a.license)))].sort();
  return buildHarvestXml(latest ? new Date(latest).toISOString() : null, licenses);
}

export function registerOpenDataHarvest(app: FastifyInstance) {
  let inFlight: Promise<Buffer> | null = null;
  const currentXmlBytes = () => {
    // Both endpoints use the same UTF-8 bytes, without trimming, BOMs or newline changes.
    inFlight ??= currentHarvestXml().then(xml => Buffer.from(xml, "utf8")).finally(() => { inFlight = null; });
    return inFlight;
  };
  app.get("/api/open-data/harvest.xml", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (_req, reply) => {
    // Share only concurrent work; subsequent fetches assess the current publication rights afresh.
    return reply.type("application/xml; charset=utf-8").send(await currentXmlBytes());
  });
  app.get("/api/open-data/harvest.md5", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (_req, reply) => {
    const hash = createHash("md5").update(await currentXmlBytes()).digest("hex");
    return reply.type("text/plain; charset=utf-8").send(hash);
  });
}
