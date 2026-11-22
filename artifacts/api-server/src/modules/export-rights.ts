import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { ExportContext, ExportOptions, ExportRow } from "./export-dataset";

export const rightsPolicyVersion = "aed-rights-2026-11-21-record-lineage";
export const legalDisclaimer = "Kontrola techniczna dowodów i znanych warunków, nie opinia prawna ani gwarancja praw osób trzecich. Nierozstrzygnięte prawa są blokowane.";
export const licenseTerms = {
  "CC0-1.0": {
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    text: "CC0 1.0: zrzeczenie się praw w dopuszczalnym zakresie; nie obejmuje cudzych praw, znaków, patentów ani prywatności. Zachowaj pochodzenie i dostarczone oznaczenia. Brak gwarancji.",
  },
  "CC-BY-4.0": {
    url: "https://creativecommons.org/licenses/by/4.0/",
    text: "CC BY 4.0: zachowaj twórców i inne wskazane podmioty, źródła, odnośnik do licencji, dostarczone informacje o prawach i wyłączeniu gwarancji. Oznacz zmiany oraz wcześniejsze modyfikacje. Nie nakładaj dodatkowych ograniczeń. Brak gwarancji; nie sugeruj poparcia wydawcy.",
  },
  "ODbL-1.0": {
    url: "https://opendatacommons.org/licenses/odbl/1-0/",
    text: "ODbL 1.0: zachowaj oznaczenia i odnośnik do licencji (§4.2), atrybucję publicznych produktów (§4.3) oraz share-alike bazy pochodnej (§4.4). Przy publicznym użyciu udostępnij maszynowo czytelną bazę pochodną lub pełne zmiany (§4.6), bez dodatkowych ograniczeń (§4.7). Ten CSV jest normalizacją/wyciągiem bazy; nie zakładaj wyjątku dla kolekcji niezależnych baz. Prawa do poszczególnych treści mogą być odrębne (§2.4).",
  },
} as const;
export type KnownLicense = keyof typeof licenseTerms;
export const modificationNotice = "AED Puls: normalizacja pól i współrzędnych, filtrowanie i grupowanie po kanonicznym AED; oryginalne deklaracje źródeł zachowano w publikacjach. Import nie potwierdza sprawności urządzenia.";
const http = (v: unknown): v is string => typeof v === "string" && /^https?:\/\/[^\s]+$/i.test(v);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const messages = {
  license_not_selected: "Publikacja poza wybranymi licencjami.",
  unknown_license: "Nieznana lub nieobsługiwana licencja.",
  unverified_license: "Brak zweryfikowanej podstawy licencji związanej z tym źródłem i zasobem.",
  missing_attribution: "Brakuje obowiązkowej atrybucji, autora/wydawcy lub adresu źródła.",
  unavailable_lineage: "Nie można publicznie udostępnić pełnego pochodzenia praw do scalonego rekordu.",
  conflicting_license: "Nierozstrzygnięty konflikt licencji rekordu lub jego źródeł.",
  manual_review_required: "Pochodzenie lub zgodność warunków połączenia danych tego AED wymaga udokumentowanej oceny. Wstrzymano tylko ten rekord, nie niezależne rekordy w paczce.",
  invalid_record: "Nieprawidłowe współrzędne lub brak znormalizowanej publikacji.",
  unverified_geocoding_rights: "Lokalizacja została uzupełniona przez Geoapify. Prawa i obowiązki tego dodatkowego pochodzenia nie zostały jeszcze zatwierdzone; rekord wstrzymano w eksporcie.",
} as const;
export type SkipCode = keyof typeof messages;
export type Attribution = {
  publicationId: string; providerId: string; sourceName: string; authors: string[];
  sourceUrl: string; datasetUrl: string; license: KnownLicense; licenseUrl: string;
  attribution: string; modificationNotice: string; copyrightNotice: string;
  evidenceUrl: string; evidenceSha256: string; verifiedAt: string;
  originalConditions: Record<string, unknown>;
};
export function publicationRelationship(lineage: ExportRow[]) {
  if (lineage.some(r => r.ref?.provenanceEvidence.derivedFrom || r.ref?.provenanceEvidence.derivativeOf)) return "DERIVED_OR_UNRESOLVED" as const;
  if (lineage.length <= 1) return "SINGLE_SOURCE" as const;
  const datasets = lineage.map(r => {
    const evidence = r.ref?.provenanceEvidence;
    if (evidence && ["official_api_dataset_resource_institution", "municipal_metadata_official_catalogue_cross_reference"].includes(String(evidence.method))
      && /^https:\/\/api\.dane\.gov\.pl\/1\.4\/datasets\/\d+$/.test(String(evidence.datasetApiUrl))) return String(evidence.datasetApiUrl);
    return `${r.ref?.sourceId ?? r.original.id}/${r.ref?.datasetId ?? r.original.id}`;
  });
  return new Set(datasets).size === 1 ? "REPUBLICATION" as const : "SEPARATE_PUBLICATIONS" as const;
}
type Verdict = { attribution: Attribution } | { code: SkipCode };

// Source-level reviews are trusted server-owned configuration, never declarations from AED forms.
// A review is bound to the exact metadata/conditions; changing them invalidates it.
const reviewSchema = z.object({
  status: z.literal("verified"), license: z.enum(["CC0-1.0", "CC-BY-4.0", "ODbL-1.0"]),
  sourceUrl: z.url().refine(http), recordSourceUrlPrefix:z.url().refine(http),
  datasetId: z.string().min(1), datasetUrl: z.url().refine(http), publisher: z.string().min(1),
  licenseUrl: z.url(), authors: z.array(z.string().min(1)).min(1), attribution: z.string().min(1),
  evidenceUrl: z.url().refine(http), evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reviewedAt: z.iso.datetime(), conditionsSha256: z.string().regex(/^[a-f0-9]{64}$/),
  additionalTermsReviewed: z.literal(true),
});

export function verifyPublication(row: ExportRow, context: ExportContext): Verdict {
  const ref = row.ref, license = ref?.license ?? row.original.license;
  if (!Object.hasOwn(licenseTerms,license)) return { code: "unknown_license" };
  const sourceUrl = ref?.sourceUrl ?? row.original.sourceUrl;
  if (!http(sourceUrl)) return { code: "missing_attribution" };
  const source = context.sourceRows.find(s => s.id === ref?.sourceId);
  if (!source || !ref) return { code: "unverified_license" };
  const base = {
    publicationId: ref.id, providerId: `source:${source.id}`, sourceName: source.name,
    sourceUrl, datasetUrl: ref.datasetUrl ?? source.datasetUrl ?? source.url,
    license: license as KnownLicense, licenseUrl: licenseTerms[license as KnownLicense].url,
    modificationNotice, copyrightNotice: "Zachowaj oznaczenia źródła i wyłączenie gwarancji; dane w stanie takim, w jakim są.",
    verifiedAt: "2026-11-21", originalConditions: ref.reuseConditions,
  };
  if (source.key === "openaedmap" && source.url === "https://openaedmap.org/api/v1/countries/PL.geojson"
      && license === "ODbL-1.0" && ref.datasetId === "PL" && ref.resourceId === "openaedmap"
      && ref.publisher === "Współtwórcy OpenStreetMap / OpenAEDMap"
      && ref.provenanceEvidence.method === "community_osm_export"
      && (/^https:\/\/(www\.)?openstreetmap\.org\/(node|way|relation)\/\d+$/.test(sourceUrl)
        || ["https://openaedmap.org/api/v1/countries/PL.geojson","https://aed.openstreetmap.org.pl/aed_poland.geojson"].includes(sourceUrl))
      && ["https://openaedmap.org/api/v1/countries/PL.geojson","https://aed.openstreetmap.org.pl/aed_poland.geojson"].includes(base.datasetUrl)
      && Object.keys(ref.reuseConditions).length === 0) {
    const proof = source.provenanceEvidence.licenseEvidence as { evidenceUrl?: string; evidenceSha256?: string; checkedAt?: string } | undefined;
    return { attribution: { ...base, authors: ["Współtwórcy OpenStreetMap"],
      attribution: "© współtwórcy OpenStreetMap; dane OpenStreetMap dostępne na ODbL 1.0; https://www.openstreetmap.org/copyright",
      evidenceUrl: proof?.evidenceUrl ?? "https://www.openstreetmap.org/copyright",
      evidenceSha256: proof?.evidenceSha256 ?? "7050846b685ca9c158083cd776772677813128390293ce4db3d40292448d6f77",
      verifiedAt: proof?.checkedAt ?? base.verifiedAt } };
  }
  if (source.key === "przemysl" && source.url === "https://dane.przemysl.eu/wp-json/sod/v1/resources/15/data?format=geojson"
      && license === "CC-BY-4.0" && ref.datasetId === "13" && ref.resourceId === "15"
      && ref.publisher === "Straż Miejska w Przemyślu" && sourceUrl === source.url
      && base.datasetUrl === "https://dane.przemysl.eu/zbiory-danych/defibrylatory-aed-na-terenie-miasta-przemysla/"
      && ref.reuseConditions.licenseUrl === "https://dane.przemysl.eu/creative-commons-cc-by-4-0/"
      && Object.keys(ref.reuseConditions).every(k => k === "licenseUrl")) {
    const proof = source.provenanceEvidence.licenseEvidence as { evidenceUrl?: string; evidenceSha256?: string; checkedAt?: string } | undefined;
    return { attribution: { ...base, authors: ["Miasto Przemyśl", "Straż Miejska w Przemyślu"],
      attribution: `Źródło: Miasto Przemyśl — Portal Otwartych Danych; wydawca: Straż Miejska w Przemyślu; Defibrylatory AED na terenie miasta Przemyśla; CC BY 4.0; ${base.datasetUrl}`,
      evidenceUrl: proof?.evidenceUrl ?? "https://dane.przemysl.eu/creative-commons-cc-by-4-0/",
      evidenceSha256: proof?.evidenceSha256 ?? "05db2879583d39ac955135dd1195346c3db83d9de9c6ec00044c5a95140bdbd0",
      verifiedAt: proof?.checkedAt ?? base.verifiedAt } };
  }
  const reviews = source.provenanceEvidence.licenseReviews as Record<string, unknown> | undefined;
  const result = reviewSchema.safeParse(reviews?.[ref.resourceId ?? ""] ?? source.provenanceEvidence.licenseReview);
  if (result.success) {
    const review = result.data;
    if (review.license === license && review.sourceUrl === source.url && review.datasetId === ref.datasetId
      && new URL(sourceUrl).origin===new URL(review.recordSourceUrlPrefix).origin
      && sourceUrl.startsWith(review.recordSourceUrlPrefix)
      && review.datasetUrl === base.datasetUrl && review.publisher === ref.publisher
      && review.licenseUrl === base.licenseUrl && review.conditionsSha256 === hash(ref.reuseConditions)
      && Date.parse(review.reviewedAt) <= Date.now()) {
      return { attribution: { ...base, authors: review.authors, attribution: review.attribution,
        evidenceUrl: review.evidenceUrl, evidenceSha256: review.evidenceSha256, verifiedAt: review.reviewedAt } };
    }
  }
  return { code: "unverified_license" };
}

export function rowProviderId(row: ExportRow) {
  if(row.ref?.catalogueProvider)return row.ref.catalogueProvider;
  return row.ref?.sourceId ? `source:${row.ref.sourceId}` : row.original.organizationId ? `organization:${row.original.organizationId}` : "aed-puls";
}
function validData(row: ExportRow) {
  const data = (row.original.imported || row.ref?.sourceId) ? row.ref?.normalizedRecord : row.original;
  return data && ((data.latitude==null||data.longitude==null)||(typeof data.latitude === "number" && typeof data.longitude === "number"
    && Number.isFinite(data.latitude) && Number.isFinite(data.longitude) && Math.abs(data.latitude) <= 90 && Math.abs(data.longitude) <= 180));
}
export function assessExport(context: ExportContext, options: ExportOptions) {
  if(!context.rightsLoaded)throw new Error("Nie wczytano pełnego pochodzenia praw do eksportu.");
  const selected = options.providerIds ?? context.providers.map(p => p.id), wanted = new Set(selected);
  const candidates = context.rows.filter(r => wanted.has(rowProviderId(r)));
  const groups = new Map<string, ExportRow[]>();
  for (const row of candidates) {
    const group = groups.get(row.canonical.id) ?? []; group.push(row); groups.set(row.canonical.id, group);
  }
  const accepted = new Map<string, { rows: ExportRow[]; attributions: Attribution[] }>();
  const publicationChecks = new Map<string, {publicationId:string;license:string;verified:boolean;reason:string;evidenceUrl?:string;evidenceSha256?:string}[]>();
  const skipped = new Map<string, Set<SkipCode>>();
  const omitted: { aedId: string; code: SkipCode; publicationId: string | null }[] = [];
  for (const [id, rows] of groups) {
    const codes = new Set<SkipCode>();
    const filteredCodes=new Set<SkipCode>();
    const picked = rows.filter(r => {
      if (options.licenses.includes(r.ref?.license ?? r.original.license)) return true;
      const code=Object.hasOwn(licenseTerms,r.ref?.license??r.original.license)?"license_not_selected":"unknown_license";
      filteredCodes.add(code);
      omitted.push({ aedId: id, code, publicationId: r.ref?.id ?? null }); return false;
    });
    if (!picked.length) { skipped.set(id, filteredCodes); continue; }
    if (picked.some(r => !validData(r))) codes.add("invalid_record");
    const lineage = context.lineage.get(id) ?? [];
    if(lineage.some(origin=>origin.original.locationEvidence?.geocodingDependency||origin.canonical.locationEvidence?.geocodingDependency))
      codes.add("unverified_geocoding_rights");
    if(!lineage.length)codes.add("unavailable_lineage");
    const attributions: Attribution[] = [];
    const checks: NonNullable<ReturnType<typeof publicationChecks.get>> = [];
    publicationChecks.set(id,checks);
    if (context.licenseConflicts.has(id)) codes.add("conflicting_license");
    for (const origin of lineage) {
      if (options.scope !== "review" && !origin.original.imported && !["verified","VERIFIED"].includes(origin.original.verificationStatus)) {
        checks.push({publicationId:"WITHHELD",license:"WITHHELD",verified:false,reason:"unavailable_lineage"});
        codes.add("unavailable_lineage"); continue;
      }
      const verdict = verifyPublication(origin, context);
      checks.push({publicationId:origin.ref?.id ?? `aed:${origin.original.id}`,license:origin.ref?.license ?? origin.original.license,
        verified:"attribution" in verdict,reason:"code" in verdict ? verdict.code : "source_evidence_and_conditions_verified",
        ...("attribution" in verdict ? {evidenceUrl:verdict.attribution.evidenceUrl,evidenceSha256:verdict.attribution.evidenceSha256} : {})});
      if ("code" in verdict) codes.add(verdict.code);
      else attributions.push(verdict.attribution);
    }
    const obligationLicenses = new Set(attributions.map(a => a.license));
    // Multiple licenses in a file do not establish derivation. Mixed rights within one
    // canonical AED need a real combination review, never a blanket decision for the database.
    if ((obligationLicenses.has("ODbL-1.0") && obligationLicenses.has("CC-BY-4.0"))
      || publicationRelationship(lineage) === "DERIVED_OR_UNRESOLVED") codes.add("manual_review_required");
    if (codes.size) skipped.set(id, codes);
    else accepted.set(id, { rows: picked, attributions });
  }
  const decisions = [...groups].map(([aedId, rows]) => {
    const codes = [...(skipped.get(aedId) ?? [])];
    const decision = accepted.has(aedId) ? "EXPORTED" as const :
      codes.some(c => ["manual_review_required", "conflicting_license", "unverified_license", "unknown_license", "unverified_geocoding_rights"].includes(c))
        ? "MANUAL_REVIEW" as const : "SKIPPED" as const;
    return { aedId, decision, reasons: codes.length ? codes : ["verified_publications_with_mandatory_attribution"],
      licenses: [...new Set(accepted.has(aedId) ? accepted.get(aedId)!.attributions.map(a => a.license) : rows.map(r => r.ref?.license ?? r.original.license))],
      publicationIds: rows.map(r => r.ref?.id ?? `aed:${r.original.id}`),
      publicationChecks: publicationChecks.get(aedId) ?? [],
      relationship: publicationRelationship(context.lineage.get(aedId) ?? []) };
  });
  const reasons = (Object.keys(messages) as SkipCode[]).map(code => {
    const recordIds = new Set([...skipped.entries()].filter(([,codes])=>codes.has(code)).map(([id])=>id));
    const publications = omitted.filter(o=>o.code===code);
    for (const p of publications) recordIds.add(p.aedId);
    return { code, message: messages[code], recordCount: recordIds.size,
      publicationCount: code === "license_not_selected" ? publications.length
        : [...skipped.entries()].filter(([,codes])=>codes.has(code)).reduce((sum,[id])=>sum+(groups.get(id)?.length??0),0) };
  }).filter(r => r.recordCount > 0);
  return { accepted, skipped, omitted, candidates, selected, reasons, decisions,
    manualReviewCount: decisions.filter(d => d.decision === "MANUAL_REVIEW").length,
    rows: [...accepted.values()].flatMap(g=>g.rows),
    candidateRecordCount: groups.size, recordCount: accepted.size, skippedRecordCount: skipped.size,
    skippedPublicationCount: candidates.length - [...accepted.values()].reduce((sum,g)=>sum+g.rows.length,0) };
}
