/** Pure, conservative identity scoring. Coordinate proximity alone never merges AEDs. */
export type MatchRecord = {
  latitude: number|null; longitude: number|null; address: string; name: string;
  description?: string | null; responsibleOrganization?: string | null;
  deviceIdentifier?: string | null; openingHours?: string | null;
  deviceOperationalStatus?: string; recordVerificationStatus?: string;
  license?: string;
  sourceOperationalClaims?: string[];
};
export function operationalClaim(value:unknown) {
  const s=String(value??"").trim().toLowerCase();
  if(["operational","working","yes","czynny","sprawny"].includes(s))return "OPERATIONAL";
  if(["out_of_service","broken","no","nieczynny","niesprawny"].includes(s))return "OUT_OF_SERVICE";
  return null;
}
const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "")
  .toLowerCase().replace(/\b(ulica|ul|aleja|al|aed|defibrylator|unknown|brak danych)\b/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const known = (s: string | null | undefined) => !!norm(s);
const equal = (a: string | null | undefined, b: string | null | undefined) => known(a) && norm(a) === norm(b);
export function meters(a: MatchRecord, b: MatchRecord) {
  if(a.latitude==null||a.longitude==null||b.latitude==null||b.longitude==null)return Infinity;
  const r = Math.PI / 180, h = Math.sin((b.latitude-a.latitude)*r/2)**2
    + Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin((b.longitude-a.longitude)*r/2)**2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0,1-h)));
}
export function similarity(a: string | null | undefined, b: string | null | undefined) {
  const x = new Set(norm(a).split(" ").filter(Boolean)), y = new Set(norm(b).split(" ").filter(Boolean));
  return x.size && y.size ? [...x].filter(v => y.has(v)).length / new Set([...x,...y]).size : 0;
}
export function matchRecords(a: MatchRecord, b: MatchRecord) {
  const identifier = (s:string|null|undefined)=>{
    const v=(s??"").trim().toUpperCase().replace(/\s+/g,"");
    return /^(UNKNOWN|BRAK|NONE|N\/A|0+)$/.test(v)?"":v;
  };
  const distance = meters(a,b), serial = !!identifier(a.deviceIdentifier) && identifier(a.deviceIdentifier)===identifier(b.deviceIdentifier);
  const reasons: string[] = [], conflicts: string[] = [];
  if(a.recordVerificationStatus==="DISPUTED"||b.recordVerificationStatus==="DISPUTED")conflicts.push("Ocena urządzenia jest sporna");
  const claims=new Set([...(a.sourceOperationalClaims??[]),...(b.sourceOperationalClaims??[])].map(operationalClaim).filter(Boolean));
  if(claims.size>1)conflicts.push("Źródła podają sprzeczne deklaracje sprawności");
  if (identifier(a.deviceIdentifier) && identifier(b.deviceIdentifier) && !serial) conflicts.push("Różne wiarygodne identyfikatory urządzenia");
  if (known(a.openingHours) && known(b.openingHours) && !equal(a.openingHours,b.openingHours)) conflicts.push("Sprzeczne godziny dostępności");
  if (a.deviceOperationalStatus && b.deviceOperationalStatus && a.deviceOperationalStatus !== "UNKNOWN"
    && b.deviceOperationalStatus !== "UNKNOWN" && a.deviceOperationalStatus !== b.deviceOperationalStatus) conflicts.push("Sprzeczne oceny sprawności");
  // Do not combine licenses implicitly, even when physical identity is certain.
  if (a.license !== b.license || a.license === "UNKNOWN") conflicts.push("Różne lub nieustalone licencje — wymagana decyzja prawna");
  const address = equal(a.address,b.address), name = similarity(a.name,b.name), location = similarity(a.description,b.description);
  let score = serial ? 95 : distance <= 10 ? 35 : distance <= 30 ? 20 : distance <= 100 ? 5 : 0;
  if (serial) reasons.push("Zgodny identyfikator urządzenia");
  if (distance <= 100) reasons.push(`Odległość ${Math.round(distance)} m`);
  if (address) { score += 20; reasons.push("Zgodny adres"); }
  if (name >= 0.8) { score += 15; reasons.push("Zgodna nazwa obiektu"); }
  else if (name >= 0.5) score += 5;
  if (location >= 0.8) { score += 20; reasons.push("Zgodny szczegółowy opis położenia"); }
  if (equal(a.responsibleOrganization,b.responsibleOrganization)) { score += 10; reasons.push("Zgodny operator"); }
  // Different floor/room/entrance numbers are strong evidence against a same-device assumption.
  const place = (s?: string | null) => norm(s).match(/\b(?:pietro|floor|pokoj|room|wejscie)\s+[\p{L}\p{N}]+/gu)?.sort().join("|");
  if (place(a.description) && place(b.description) && place(a.description) !== place(b.description)) conflicts.push("Różne piętra, pomieszczenia lub wejścia");
  const autoThreshold = Math.min(100, Math.max(90, Number(process.env.AED_AUTO_MERGE_SCORE) || 95));
  const reviewThreshold = Math.min(autoThreshold-1, Math.max(60, Number(process.env.AED_REVIEW_SCORE) || 70));
  score = Math.min(100, score);
  const strong = serial && String(a.deviceIdentifier).length>=5;
  const eligible = (distance <= 30 && (address || location >= 0.8 || serial)) || serial
    || (distance <= 100 && address && name >= 0.8 && location >= 0.8);
  return { score, distance, reasons, conflicts, blockingConflict: conflicts.length > 0,
    candidate: eligible && score >= reviewThreshold,
    autoMerge: eligible && strong && score >= autoThreshold && conflicts.length === 0 };
}

/** A catalogue is a distribution channel, not a new independent observer. */
export function primarySource(input: { sourceCategory?: string; provenanceEvidence?: Record<string,unknown>; publisherId?: string|null; publisher?: string|null; sourceName?: string }) {
  const e = input.provenanceEvidence ?? {};
  if (input.sourceCategory === "COMMUNITY_OPEN_DATA" && /openstreetmap|openaedmap/i.test(input.sourceName ?? "")) return "osm";
  if (e.publisherId && /^official_api_|^municipal_metadata_/.test(String(e.method))) return `gov-publisher:${e.publisherId}`;
  // Unconfirmed organizations cannot increase a count of independently established publishers.
  return null;
}
