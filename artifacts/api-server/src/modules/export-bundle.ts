import JSZip from "jszip";
import { createHash } from "node:crypto";
import { csvCell, exportRecords, exportPreview, formatExport } from "./export-dataset";
import type { ExportContext, ExportOptions } from "./export-dataset";
import { assessExport, legalDisclaimer, licenseTerms, modificationNotice, rightsPolicyVersion } from "./export-rights";
import type { Attribution } from "./export-rights";

export function exportBundleContent(context: ExportContext, options: ExportOptions, assessment=assessExport(context,options)) {
  const records=exportRecords(context,options,assessment),preview=exportPreview(context,options,assessment);
  const rows=[...assessment.accepted.entries()].flatMap(([aedId,group])=>group.attributions.map(a=>({
    aedId,selectedDataPublication:group.rows.some(r=>r.ref?.id===a.publicationId),...a,
  })));
  const columns=["aedId","publicationId","selectedDataPublication","providerId","sourceName","authors",
    "sourceUrl","datasetUrl","license","licenseUrl","attribution","copyrightNotice","modificationNotice",
    "evidenceUrl","evidenceSha256","verifiedAt","originalConditions"] as const;
  const sourcesCsv="\uFEFF"+[
    columns.map(c=>csvCell(c)).join(","),
    ...rows.map(r=>columns.map(c=>csvCell(r[c])).join(",")),
  ].join("\r\n");
  const grouped=new Map<string,Attribution>();
  for(const row of rows)grouped.set(JSON.stringify([row.providerId,row.datasetUrl,row.license,row.attribution,row.authors]),row);
  const used=[...new Set(rows.map(r=>r.license))].sort();
  const licensesText=[
    "AED Puls — warunki i obowiązkowa atrybucja",
    `Polityka: ${rightsPolicyVersion}`,
    "Brak jednej wspólnej licencji całego archiwum. Nie przelicencjonowano danych innych podmiotów.",
    `Wybrane filtry: ${options.licenses.join(", ")}. Licencje rzeczywiście wyeksportowanych publikacji i zależności: ${used.join(", ")||"brak"}.`,
    "Nie usuwaj źródeł, autorów, oznaczeń praw ani historii zmian. Zachowaj sources.csv i metadane publikacji z aed_data.csv przy dalszym przekazywaniu.",
    "sources.csv wskazuje także obowiązkowe zależności prawne niebędące wybranymi dostawcami treści (selectedDataPublication=false). Filtr licencji ich nie usuwa.",
    modificationNotice,legalDisclaimer,"",
    "WARUNKI LICENCJI (odnośniki do pełnych tekstów; nie zastępują licencji):",
    ...[...new Set([...used,...options.licenses])].filter((id):id is keyof typeof licenseTerms=>Object.hasOwn(licenseTerms,id))
      .flatMap(id=>[`${id}: ${licenseTerms[id].url}`,licenseTerms[id].text,""]),
    "WYMAGANE OZNACZENIA WYEKSPORTOWANYCH ŹRÓDEŁ:",
    ...[...grouped.values()].flatMap(a=>[
      a.sourceName,`Twórcy/podmioty do oznaczenia: ${a.authors.join("; ")}`,a.attribution,
      `Zbiór: ${a.datasetUrl}`,`Licencja: ${a.license}; ${a.licenseUrl}`,
      `Dowód: ${a.evidenceUrl}; kontrola ${a.verifiedAt}; SHA-256 tekstu dowodu odczytanego podczas kontroli: ${a.evidenceSha256}`,
      a.copyrightNotice,`Oryginalne warunki: ${JSON.stringify(a.originalConditions)}`,
      "Adresy poszczególnych publikacji i powiązania AED: sources.csv.","",
    ]),
    ...(rows.length?[]:["Brak rekordów dopuszczonych do eksportu. To paczka raportowa, nie udzielenie praw do pominiętych danych."]),
    "ZASADY ZGODNOŚCI:",
    "Różne licencje niezależnych rekordów nie blokują całego eksportu. Zachowano granice publikacji w sources, źródło każdego pola w fieldProvenance i licencje każdego rekordu.",
    "Samo współwystępowanie rekordów nie nadaje całemu plikowi jednej licencji. Dalsze łączenie danych może utworzyć bazę pochodną i uruchomić obowiązki ODbL; nie zakładaj automatycznie wyjątku dla kolekcji.",
    "Nierozstrzygnięte połączenia ODbL i CC BY w obrębie jednego AED oraz nieudokumentowane zależności pochodne skierowano do ręcznej oceny bez blokowania pozostałych rekordów.",
    "ODbL + zweryfikowane CC0 nie usuwa ODbL ani obowiązku share-alike/udostępnienia bazy pochodnej. CC0 nie nadaje praw do cudzych treści.",
    "Filtrowanie nie usuwa źródeł pochodzenia z historii scalenia. Nierozstrzygnięte konflikty, niezweryfikowane prawa i niedostępne pochodzenie blokują rekord.",
    "Nie sugeruj poparcia wydawcy. Brak gwarancji aktualności, dostępności i sprawności AED.",
  ].join("\n");
  const files:Record<string,string>={"aed_data.csv":formatExport(records,"csv"),"sources.csv":sourcesCsv,"LICENSES.txt":licensesText};
  const report={
    schemaVersion:preview.schemaVersion,policyVersion:rightsPolicyVersion,generatedAt:new Date().toISOString(),
    scope:options.scope,selectedProviderIds:assessment.selected,selectedLicenses:options.licenses,
    candidateRecordCount:assessment.candidateRecordCount,exportedRecordCount:records.length,
    skippedRecordCount:assessment.skippedRecordCount,candidatePublicationCount:assessment.candidates.length,
    exportedPublicationCount:assessment.rows.length,skippedPublicationCount:assessment.skippedPublicationCount,
    requiredLineagePublicationCount:rows.length,applicableLicenses:used,
    attributionRequired:true,blanketLicense:null,legalDisclaimer,warnings:preview.warnings,
    reasonCounts:assessment.reasons,reasonCountsMayOverlap:true,sources:preview.sources,
    skippedRecords:[...assessment.skipped].map(([aedId,codes])=>({aedId,reasons:[...codes].sort()})),
    manualReviewCount: assessment.manualReviewCount,
    recordDecisions: assessment.decisions,
    fieldProvenance: records.map(record => ({aedId:record.id,fields:record.fieldProvenance})),
    omittedPublications:assessment.omitted,
    files:Object.fromEntries(Object.entries(files).map(([name,text])=>[name,{
      bytes:Buffer.byteLength(text,"utf8"),sha256:createHash("sha256").update(text,"utf8").digest("hex"),
    }])),
  };
  files["validation_report.json"]=JSON.stringify(report,null,2);
  return{records,report,files,sourceRows:rows,sourceColumns:columns,licensesText};
}
export async function buildExportBundle(context: ExportContext, options: ExportOptions, assessment=assessExport(context,options)) {
  const{records,report,files}=exportBundleContent(context,options,assessment);
  const zip=new JSZip();
  for(const [name,text] of Object.entries(files))zip.file(name,text);
  return {buffer:await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE",compressionOptions:{level:6}}),records,report};
}
