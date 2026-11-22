import type { RunDiagnostics } from "./sync-diagnostics";

// Validation failures describe retained data, not missing downloads. Unknown errors
// remain transport failures when interpreting historical summaries.
export const retainedDataRules = new Set([
  "outside_poland","border_review","inconsistent_coordinate_axes","missing_license","missing_attribution","unparseable_record",
]);
export function childCompletionStatus(processed:number,transportFailures:number,interrupted=false) {
  return interrupted?"interrupted":!processed?"unavailable":transportFailures?"partial":"succeeded";
}
export function sourceCompletionMessage(run:RunDiagnostics,status:string,includeRecordStatuses=true) {
  const errors=[...run.issues.values()].filter(i=>i.severity==="error");
  const transport=errors.filter(i=>!retainedDataRules.has(i.rule));
  const validation=errors.filter(i=>retainedDataRules.has(i.rule)).reduce((sum,i)=>sum+i.count,0);
  const transportCount=Math.max(run.transportFailures,transport.reduce((sum,i)=>sum+i.count,0));
  const label=status==="succeeded"?"Pobrano i zachowano dane.":status==="partial"?"Pobieranie niepełne.":
    status==="unavailable"?"Nie pobrano rekordów.":status==="interrupted"?"Pobieranie przerwane.":"Pobieranie nie powiodło się.";
  const s=run.recordStatuses;
  return `${label} Przetworzono ${run.counts.processed}; nowe AED: ${run.counts.imported}; aktualizacje: ${run.counts.updated}; powtórzenia: ${run.duplicates}. `+
    (includeRecordStatuses?`Kompletne: ${s.complete}; niekompletne: ${s.incomplete}; do oceny lokalizacji przez administratora: ${s.locationReview}; nieprzetwarzalne oryginały zachowane: ${s.unparseable}. `:"")+
    `Problemy walidacji danych: ${validation} (liczba zdarzeń, nie rekordów); błędy pobierania lub zapisu: ${transportCount}.`+
    (transport.length?` Problem pobierania: ${transport[0]!.message}`:"")+
    (validation?" Dane wymagające oceny pozostają w bazie; nie zatwierdzamy ich automatycznie.":"");
}
