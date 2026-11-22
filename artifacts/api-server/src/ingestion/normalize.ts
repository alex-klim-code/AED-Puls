import { createHash } from "node:crypto";
import type { SourceCategory } from "@workspace/api-zod";
import polandBorder from "./data/poland-border.json";

export type SourceContext = {
  name: string; publisher: string; license: string; url: string; datasetUrl: string;
  resourceId: string; datasetId: string; modified: string | null; coverage: string;
  sourceCategory?: SourceCategory; provenanceEvidence?: Record<string, unknown>; publisherId?: string | null;
  datasetTitle?: string; resourceFormat?: string; published?: string | null; referenceScope?: string;
  reuseConditions?: Record<string, unknown>; provenanceWarning?: string;
  coordinateHoldReason?:string;
};
export type ImportRow = { original: Record<string, any>; context: SourceContext };
export type Issue = { severity: "error" | "warning" | "info"; rule: string; message: string };
export type Normalized = {
  name: string; address: string; city: string; postalCode: string | null; description: string | null;
  latitude: number | null; longitude: number | null; placement: "indoor" | "outdoor" | "unknown";
  accessibility: "24/7" | "limited" | "unknown"; openingHours: string | null;
  operationalStatus: string; sourceName: string; sourceUrl: string; license: string;
  country: string; responsibleOrganization: string | null; lastVerifiedAt: Date | null;
  qualityScore: number; qualityIssues: string[];
  sourceCategory: SourceCategory;
  deviceIdentifier: string | null;
};
export const digest = (raw: unknown) => createHash("sha256").update(JSON.stringify(raw)).digest("hex");
const stableDocument=(v:unknown):unknown=>Array.isArray(v)?v.map(stableDocument):v&&typeof v==="object"
  ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,stableDocument(x)])):v;
export const stableDigest=(raw:unknown)=>digest(stableDocument(raw));
export function legacyStableId(input:unknown):string|null{
  try{
    if(!input||typeof input!=="object")return null;
    const raw=input as Record<string,unknown>;
    const document=(raw.encoding==="json-string"&&typeof raw.payload==="string"?JSON.parse(raw.payload):raw);
    return document.record&&document.context?.datasetId?normalizeRow({original:document.record,context:document.context}).id:null;
  }catch{return null;}
}
const brokenUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|\u0000/g;
export const clean = (s: unknown) => String(s ?? "").replace(brokenUnicode, "\uFFFD").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
// String.slice can split an emoji, producing JSON that PostgreSQL correctly rejects.
const truncate = (s: string, limit: number) => s.slice(0, limit).replace(/[\uD800-\uDBFF]$/, "");
export function preserveOriginal(document: Record<string, unknown>): Record<string, unknown> {
  const unsafe = (v: unknown): boolean => {
    if (typeof v === "string") { brokenUnicode.lastIndex = 0; return brokenUnicode.test(v); }
    return !!v && typeof v === "object" && Object.entries(v).some(([k, value]) => unsafe(k) || unsafe(value));
  };
  return unsafe(document) ? { encoding: "json-string", payload: JSON.stringify(document) } : document;
}
export const keyOf = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").toLowerCase().replace(/[^a-z0-9]/g, "");
export function canonicalLicense(raw: unknown) {
  const s = clean(raw).toLowerCase();
  if (/odbl/.test(s)) return "ODbL-1.0";
  if (/cc.?by.?4|creativecommons\.org\/licenses\/by\/4/.test(s)) return "CC-BY-4.0";
  if (/cc0|publicdomain\/zero/.test(s)) return "CC0-1.0";
  return "UNKNOWN";
}

// Public-domain Natural Earth scale 1:10,000,000 screening, not a cadastral boundary or physical verification.
function inRing(lat:number,lon:number,ring:number[][]){
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i]!, [px, py] = ring[j]!;
    if ((y! > lat) !== (py! > lat) && lon < (px! - x!) * (lat - y!) / (py! - y!) + x!) inside = !inside;
  }
  return inside;
}
export function withinPoland(lat:number,lon:number){
  const rings=polandBorder.geometry.coordinates;
  return Number.isFinite(lat)&&Number.isFinite(lon)&&inRing(lat,lon,rings[0]!)&&!rings.slice(1).some(r=>inRing(lat,lon,r));
}

export function normalizeRow(row: ImportRow): { id: string; data: Normalized | null; issues: Issue[] } {
  const original = row.original;
  if(original?._aedPulsUnprocessable===true)return{
    id:`unparsed:${digest(original._aedPulsOriginalValue??null)}`,data:null,
    issues:[{rule:"unparseable_record",severity:"error",message:"Nieprawidłowy wiersz JSON zachowano w oryginale; pozostałe wpisy są przetwarzane."}],
  };
  if(!original||typeof original!=="object"||Array.isArray(original)||!Object.keys(original).length){
    return{id:`unparsed:${digest(original??null)}`,data:null,issues:[{rule:"unparseable_record",severity:"error",message:"Brak możliwego do przetworzenia obiektu. Zachowano oryginał do kontroli."}]};
  }
  const keyed=Array.isArray(original.values)&&original.values.every((v:any)=>v&&typeof v.key==="string"&&"value" in v)
    ?Object.fromEntries(original.values.map((v:any)=>[v.key,v.value])):original;
  const props = (original.properties && typeof original.properties === "object" ? original.properties : keyed) as Record<string, unknown>;
  const fields = new Map(Object.entries(props).map(([k, v]) => [keyOf(k), v]));
  const value = (...names: string[]) => names.map(n => fields.get(keyOf(n))).find(v => v != null && clean(v) !== "");
  const text = (...names: string[]) => clean(value(...names));
  const number = (v: unknown) => v == null || clean(v) === "" ? NaN : Number(clean(v).replace(",", "."));
  const coords = original.geometry?.type === "Point" ? original.geometry.coordinates : null;
  const latitude = number(coords?.[1] ?? value("latitude", "lat", "szerokość geograficzna", "szerokosc", "y"));
  const longitude = number(coords?.[0] ?? value("longitude", "lon", "lng", "długość geograficzna", "dlugosc", "x"));
  const osmId = props["@osm_id"];
  const naturalId = osmId ? `${props["@osm_type"] ?? "node"}/${osmId}` : clean(original.id ?? value("id", "numer id", "objectid", "identyfikator"));
  // Fingerprint fallback is independent of row order; missing explicit IDs are reported.
  const id = `${row.context.datasetId}/${naturalId || stableDigest(props).slice(0, 32)}`;
  const issues: Issue[] = [];
  const issue = (rule: string, message: string, severity: Issue["severity"] = "warning") => issues.push({ rule, message, severity });
  if (!naturalId) issue("missing_source_id", "Brak jawnego identyfikatora; użyto skrótu oryginalnego rekordu.");
  if(row.context.coordinateHoldReason){
    issue("inconsistent_coordinate_axes",row.context.coordinateHoldReason,"error");
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) issue("missing_coordinates", "Brak poprawnych współrzędnych WGS84; rekord zachowano bez lokalizacji.");
  else if (latitude < 49 || latitude > 55 || longitude < 14 || longitude > 24.2) issue("outside_poland", "Współrzędne poza zakresem Polski. Rekord i oryginalną parę współrzędnych zachowano do oceny administratora; punktu nie publikujemy automatycznie.", "error");
  else if (!withinPoland(latitude, longitude)) issue("border_review", "Punkt poza obrysem Polski Natural Earth 1:10 000 000. Obrys nie jest granicą ewidencyjną; wymagana kontrola punktu, nie opublikowano automatycznie.", "error");
  const located = !issues.some(i => ["missing_coordinates","outside_poland","border_review","inconsistent_coordinate_axes"].includes(i.rule));
  const streetName = text("nazwa ulicy");
  const address = text("addr:street", "street", "ulica")
    || (streetName?[text("cecha ulicy"),streetName].filter(Boolean).join(" "):"");
  const house = text("addr:housenumber", "home_number", "numer", "nr", "nr budynku", "numer budynku");
  const fullAddress = text("address", "adres") || [address, house].filter(Boolean).join(" ");
  const city = text("addr:city", "city", "miejscowość", "miasto");
  const hours = text("opening_hours", "godziny", "godziny otwarcia", "openingHours");
  const access = text("access", "dostępność", "accessibility").toLowerCase();
  const accessibility = hours === "24/7" && ["yes", "public", "tak", "24/7"].includes(access)
    ? "24/7" : (hours || ["private", "customers", "permissive", "no", "limited"].includes(access)) ? "limited" : "unknown";
  const placementRaw = text("indoor", "placement", "umiejscowienie");
  const placement = placementRaw === "yes" || placementRaw === "indoor" ? "indoor" : placementRaw === "no" || placementRaw === "outdoor" ? "outdoor" : "unknown";
  const dateRaw = text("check_date:emergency", "check_date", "last_verified_at", "data weryfikacji");
  let lastVerifiedAt: Date | null = null;
  if (dateRaw) {
    const valid = /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(dateRaw) && Number.isFinite(Date.parse(dateRaw)) && Date.parse(dateRaw) <= Date.now();
    if (valid && new Date(dateRaw).toISOString().startsWith(dateRaw.slice(0, 10))) lastVerifiedAt = new Date(dateRaw);
    else issue("invalid_date", "Nieprawidłowa lub przyszła data kontroli źródłowej.");
  }
  if (!fullAddress) issue("missing_address", "Brak adresu ulicznego w źródle.");
  if (!city) issue("missing_city", "Brak miejscowości w źródle.");
  if (accessibility === "unknown") issue("missing_access", "Brak informacji o dostępności.");
  if (!hours) issue("missing_hours", "Brak godzin dostępu.");
  if (row.context.provenanceWarning) issue("unconfirmed_official_source", row.context.provenanceWarning);
  if (row.context.modified && !Number.isFinite(Date.parse(row.context.modified))) issue("invalid_source_date", "Nieprawidłowa data aktualizacji źródła.");
  if (row.context.license === "UNKNOWN") issue("missing_license", "Nieustalona licencja; rekord wstrzymany przed publikacją.", "error");
  if (!row.context.publisher || !row.context.url) issue("missing_attribution", "Brak pełnej atrybucji źródła.", "error");
  // Source claims remain in the original record; a successful import is not evidence of device functionality.
  const operationalStatus = "unknown";
  const description = text("defibrillator:location:pl", "defibrillator:location", "location", "lokalizacja", "opis lokalizacji", "description");
  const data: Normalized = {
    deviceIdentifier: text("defibrillator:serial_number","serial_number","numer seryjny") || null,
    name: truncate(text("name", "nazwa") || description, 160),
    address: truncate(fullAddress, 240), city: truncate(city, 120),
    postalCode: truncate(text("addr:postcode", "postcode", "kod pocztowy"), 10) || null,
    description: truncate(description, 2000) || null, latitude: located ? latitude : null, longitude: located ? longitude : null, placement, accessibility,
    openingHours: truncate(hours, 200) || null, operationalStatus,
    sourceName: row.context.name, sourceUrl: osmId ? `https://www.openstreetmap.org/${props["@osm_type"] ?? "node"}/${osmId}` : row.context.url,
    license: row.context.license, country: "PL",
    sourceCategory: row.context.sourceCategory ?? "UNKNOWN",
    responsibleOrganization: text("operator", "responsible organization", "organizacja") || null,
    lastVerifiedAt, qualityScore: Math.max(0, 85 - issues.reduce((sum, i) => sum + (i.severity === "error" ? 25 : 8), 0)),
    qualityIssues: [...issues.map(i => i.message), "Ocena danych nie potwierdza sprawności AED. Kontrola źródłowa nie jest weryfikacją AED Puls."],
  };
  return { id, data, issues };
}
