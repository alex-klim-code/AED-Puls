import type { FastifyInstance } from "fastify";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { z } from "zod/v4";
import { fail } from "./auth";
import { dataStandard } from "./data-standard";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { exportOptions, exportPreview, exportRecords, formatExport, exportSchemaVersion, exportFields, selectedRows } from "./export-dataset";
import { exportContext } from "./export-dataset";
import { GetExportPreviewResponse, ListExportProvidersResponse } from "@workspace/api-zod";
import { assessExport } from "./export-rights";
import { buildExportBundle } from "./export-bundle";
import { buildXlsxExport,xlsxMime } from "./export-xlsx";
import { registerOpenDataHarvest } from "./open-data-harvest";
const gzipAsync=promisify(gzip);
let activeDownloads=0;

export function registerOpenData(app: FastifyInstance) {
  registerOpenDataHarvest(app);
  app.get("/api/export-providers", async (req,reply) => {
    reply.header("Cache-Control","private, no-store");
    const options=exportOptions(req,"public");
    return ListExportProvidersResponse.parse((await exportContext(options.scope,options.providerIds,false)).providers);
  });
  app.get("/api/export-preview", async (req,reply) => {
    reply.header("Cache-Control","private, no-store");
    const options=exportOptions(req,"public");
    return GetExportPreviewResponse.parse(exportPreview(await exportContext(options.scope,options.providerIds),options));
  });
  app.get("/api/exports/:format", {config:{rateLimit:{max:30,timeWindow:"1 minute"}}}, async (req, reply) => {
    if(activeDownloads>=2)fail(429,"Trwa przygotowywanie innych eksportów. Spróbuj ponownie za chwilę.");
    activeDownloads++;
    try{
    reply.header("Cache-Control","private, no-store");
    const format = z.enum(["json", "csv", "geojson", "zip", "xlsx"]).parse((req.params as { format: string }).format);
    const options=exportOptions(req,format==="zip"?"public":"approved");
    const context=await exportContext(options.scope,options.providerIds),assessment=assessExport(context,options);
    if(format==="zip"){
      const bundle=await buildExportBundle(context,options,assessment);
      return reply.type("application/zip")
        .header("Content-Disposition",`attachment; filename="aed_puls_${options.scope}_${new Date().toISOString().slice(0,10)}.zip"`)
        .header("X-AED-Record-Count",String(bundle.records.length)).header("X-AED-Schema-Version",exportSchemaVersion)
        .header("X-AED-Skipped-Record-Count",String(assessment.skippedRecordCount))
        .header("X-AED-Review-Only",String(options.scope==="review")).send(bundle.buffer);
    }
    if(format==="xlsx"){
      if(!assessment.accepted.size)fail(422,"Brak rekordów dopuszczonych do eksportu XLSX dla wybranych źródeł i licencji. Zmień wybór lub pobierz ZIP z raportem.");
      const workbook=await buildXlsxExport(context,options,assessment);
      return reply.type(xlsxMime)
        .header("Content-Disposition",`attachment; filename="aed_puls_${options.scope}_${new Date().toISOString().slice(0,10)}.xlsx"`)
        .header("X-AED-Record-Count",String(workbook.records.length)).header("X-AED-Schema-Version",exportSchemaVersion)
        .header("X-AED-Data-Mode",options.scope).header("X-AED-Review-Only",String(options.scope==="review"))
        .header("X-AED-Skipped-Record-Count",String(assessment.skippedRecordCount)).send(workbook.buffer);
    }
    const records=exportRecords(context,options,assessment);
    if(options.providerIds&&!records.length)fail(422,"Brak rekordów do pobrania dla wybranych dostawców i zakresu. Zmień wybór.");
    // Build the entire document before sending headers/body: generation errors cannot become partial downloads.
    const bytes=Buffer.from(formatExport(records,format),"utf8");
    const acceptsGzip=(req.headers["accept-encoding"]??"").split(",").some(part=>{
      const [encoding,...params]=part.trim().toLowerCase().split(";");
      const q=params.find(p=>p.trim().startsWith("q="));
      return encoding==="gzip"&&(!q||Number(q.split("=")[1])>0);
    });
    const compressed=bytes.length>4096&&acceptsGzip;
    const output=compressed?await gzipAsync(bytes):bytes;
    reply.header("Content-Disposition",`attachment; filename="aed_puls_${options.scope}_${new Date().toISOString().slice(0,10)}.${format}"`);
    reply.header("X-AED-Review-Only",String(options.scope==="review"));
    reply.header("X-AED-Schema-Version",exportSchemaVersion);
    reply.header("X-AED-Record-Count",String(records.length));
    reply.header("X-AED-Data-Mode",options.scope);
    reply.header("Vary","Accept-Encoding");
    reply.type(format==="csv"?"text/csv; charset=utf-8":format==="geojson"?"application/geo+json; charset=utf-8":"application/json; charset=utf-8");
    if(compressed)reply.header("Content-Encoding","gzip");
    return reply.send(output);
    }finally{activeDownloads--;}
  });
  app.get("/api/metadata", async (req,reply) => {
    reply.header("Cache-Control","private, no-store");
    const options=exportOptions(req,"approved"),context=await exportContext(options.scope,options.providerIds);
    const preview=exportPreview(context,options),{rows,selected}=selectedRows(context,options);
    const query=new URLSearchParams({scope:options.scope,providerIds:selected.join(",")});
    query.set("licenses",options.licenses.join(","));
    return {
      title: "AED Puls — rekordy AED wybranych dostawców",
      ...preview,reviewOnly:options.scope==="review",scope:options.scope,
      description: "Znormalizowane dane lokalizacyjne AED. Zatwierdzenie informacji nie gwarantuje sprawności urządzenia ani jego dostępności.",
      publisher: "AED Puls — prototyp; uprawniony wydawca do wskazania przed publikacją",
      geographicCoverage: "Polska", updateFrequency: "Na żądanie, po weryfikacji zgłoszeń",
      isDemo:false,
      providers:context.providers.filter(p=>selected.includes(p.id)),
      lastUpdated:rows.length?new Date(Math.max(...rows.map(r=>r.ref?.lastSyncedAt?.getTime()??r.original.updatedAt.getTime()))).toISOString():null,
      sourceReferences:[...new Set(rows.map(r=>r.ref?.sourceUrl??r.original.sourceUrl))],
      licensing:"Pola główne pochodzą z jednej wybranej publikacji. Pozostałe publikacje są oddzielnie w sources i zachowują własną licencję. Brak wspólnego przelicencjonowania; przy ponownym użyciu przestrzegaj także ODbL.",
      resources:["xlsx","csv","json","geojson","zip"].map(format=>({format,encoding:format==="xlsx"||format==="zip"?"binary":"UTF-8",url:`/api/exports/${format}?${query}`})),
      publicationStatus: "Nie opublikowano na dane.gov.pl. Wymagana weryfikacja metadanych przez uprawnionego dostawcę.",
      limitations: [
        "Nie zweryfikowano jeszcze zgodności z aktualnymi wymaganiami technicznymi dane.gov.pl.",
        "Zakres public zawiera także widoczne niezweryfikowane importy; zakres approved tylko zatwierdzone. Żaden eksport nie zatwierdza urządzenia.",
        "Kontrola współrzędnych używa zakresu i uproszczonego obrysu Polski; punkty sporne wymagają oceny administratora.",
      ],
    };
  });
  app.get("/api/standard.xlsx", async (_req, reply) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "AED Puls";
    const fields = workbook.addWorksheet("Standard danych");
    fields.addRow(["Nazwa pola", "Opis po polsku", "Typ danych", "Wymagalność", "Reguły walidacji", "Dozwolone wartości", "Przykład", "Pochodzenie i wymagania"]);
    exportFields.forEach(key=>{
      const existing=dataStandard.find(row=>row[0]===key);
      fields.addRow(existing??[key,`Pole wspólnego rekordu eksportowego: ${key}`,"Zgodnie z ExportRecord w OpenAPI","wymagane, wartość może być null","Stały zestaw pól we wszystkich formatach","Zgodnie z API","",key==="sources"?"Wyłącznie publikacje wybranych dostawców; każda z pełnym znormalizowanym data":"Wspólny schemat eksportu"]);
    });
    fields.columns.forEach((column, i) => { column.width = i === 0 ? 24 : 38; });
    fields.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    fields.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    fields.views = [{ state: "frozen", ySplit: 1 }];
    fields.autoFilter = { from: "A1", to: "H1" };
    fields.eachRow(row => { row.alignment = { vertical: "top", wrapText: true }; if (row.number > 1) row.height = 60; });
    const instructions = workbook.addWorksheet("Wersja i instrukcja");
    [
      ["Wersja", exportSchemaVersion],
      ["Status", "Projekt standardu MVP — nie jest urzędowym standardem ani potwierdzeniem zgodności dane.gov.pl."],
      ["Zastosowanie", "Zachowuj oryginały w obserwacjach źródłowych; normalizuj kopię do rekordu kanonicznego."],
      ["Układ współrzędnych", "WGS84 / EPSG:4326; GeoJSON kolejność długość, szerokość."],
      ["Braki danych", "Użyj unknown dla nieznanych wartości słownikowych; nie zakładaj dostępności 24/7."],
      ["Ocena jakości", "Kompletność i pewność danych, nie niezawodność ani sprawność AED."],
      ["Licencje", "Każda publikacja w sources zachowuje licencję. Pola główne pochodzą z jednej wybranej publikacji, nigdy z mieszaniny dostawców. Nieznane licencje są wykluczone. Przy ponownym użyciu przestrzegaj obowiązków ODbL i atrybucji."],
      ["XLSX / CSV / JSON / GeoJSON", "Te same pola i wartości. W XLSX i CSV tablice i obiekty są JSON-em wewnątrz komórki. XLSX zawiera także źródła, warunki licencji, standard danych i raport walidacji. GeoJSON zawiera te same pola w properties oraz geometrię [longitude, latitude]."],
      ["Wybór dostawców", "Jeden wiersz na kanoniczne AED. sources i providerIds zawierają tylko wybranych dostawców. Oryginały w bazie nie są usuwane ani nadpisywane eksportem."],
      ["Logowanie demonstracyjne", "Udostępnia rzeczywiste dane i pełne uprawnienia wybranej roli. Nie utrzymujemy syntetycznych punktów AED. Zmiany są trwałe."],
      ["Publikacja", "Uprawniony dostawca powinien sprawdzić aktualne wytyczne dane.gov.pl, licencję, wydawcę, metadane i zasoby, następnie opublikować je swoim uprawnionym kanałem. Odczyt API nie daje uprawnień publikacji."],
      ["Konflikty", "Panel /admin/duplicates: ręcznie potwierdź wspólne urządzenie, porównaj oryginały i rozstrzygnij pola. Połączenie zachowuje źródła i nie zmienia licencji. Nie kopiuj treści między różnymi licencjami."],
    ].forEach(row => instructions.addRow(row));
    instructions.columns = [{ width: 28 }, { width: 110 }];
    instructions.eachRow(row => { row.alignment = { wrapText: true, vertical: "top" }; row.height = 48; });
    const buffer = await workbook.xlsx.writeBuffer();
    return reply.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", 'attachment; filename="aed_data_standard.xlsx"').send(Buffer.from(buffer));
  });
  app.get("/api/openapi.json", async () => {
    const text = await readFile(new URL("./openapi.yaml", import.meta.url), "utf8");
    return YAML.parse(text);
  });
}
