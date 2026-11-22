import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { keyOf } from "./normalize";

const MAX_ROWS = 100000;
export function jsonRows(input: unknown): Record<string, any>[] {
  const value = input as any;
  const rows = Array.isArray(value) ? value : value?.type === "FeatureCollection" ? value.features : value?.data ?? value?.results ?? value?.items ?? value?.result?.records ?? (Array.isArray(value?.result)?value.result:undefined);
  if (!Array.isArray(rows)) throw new Error("Nieobsługiwana struktura JSON: oczekiwano tablicy lub GeoJSON FeatureCollection.");
  if (rows.length > MAX_ROWS) throw new Error("Zasób przekracza limit 100 000 rekordów.");
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return {_aedPulsUnprocessable:true,_aedPulsOriginalValue:row};
    return row;
  });
}
function decode(buffer: Buffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { return new TextDecoder("windows-1250").decode(buffer); }
}
function unwrapEmbeddedCsv(rows:Record<string,any>[]){
  if(!rows.length)return rows;
  const keys=Object.keys(rows[0]!);if(keys.length!==1)return rows;
  const header=keys[0]!,delimiter=[",",";","\t"].sort((a,b)=>header.split(b).length-header.split(a).length)[0]!;
  let fields:string[];
  try{fields=(parse(header,{delimiter,trim:true,max_record_size:256000})[0]??[]) as string[];}catch{return rows;}
  const names=fields.map(keyOf);
  // Some real municipal CSV/XLSX files put an entire CSV row in one cell.
  // Address-only municipal rows are genuine records too; GPS is not a parsing requirement.
  const coordinateHeaders=names.some(k=>["latitude","lat","szerokoscgeograficzna"].includes(k))&&
    names.some(k=>["longitude","lon","lng","dlugoscgeograficzna"].includes(k));
  const addressHeaders=names.some(k=>["name","nazwa"].includes(k))&&names.some(k=>["address","adres","street","ulica"].includes(k));
  if(!coordinateHeaders&&!addressHeaders)return rows;
  if(rows.some(r=>Object.keys(r).length!==1||typeof r[header]!=="string"))throw new Error("Niespójne opakowanie wierszy CSV w jednej komórce.");
  const inner=parse([header,...rows.map(r=>r[header])].join("\n"),{
    delimiter,bom:true,columns:(h:string[])=>h.map(s=>s.trim()),skip_empty_lines:true,relax_column_count_less:true,max_record_size:256000,
  }) as Record<string,any>[];
  if(inner.length!==rows.length)throw new Error("Niespójna liczba wierszy zagnieżdżonego CSV.");
  return inner.map((r,i)=>({...r,_aedPulsOriginalRow:rows[i]}));
}
function validateZip(buffer: Buffer) {
  let total = 0, count = 0;
  for (let i = 0; i < buffer.length - 46; i++) {
    if (buffer.readUInt32LE(i) !== 0x02014b50) continue;
    count++;
    const size = buffer.readUInt32LE(i + 24);
    if (size === 0xffffffff || count > 1000) throw new Error("Nieobsługiwany lub zbyt duży XLSX.");
    total += size;
    if (total > 80 * 1024 * 1024) throw new Error("Rozpakowany XLSX przekracza limit 80 MiB.");
    i += 45 + buffer.readUInt16LE(i + 28) + buffer.readUInt16LE(i + 30) + buffer.readUInt16LE(i + 32);
  }
  if (!count) throw new Error("Nieprawidłowe archiwum XLSX.");
}
export async function parseResource(buffer: Buffer, format: string): Promise<Record<string, any>[]> {
  if (["json", "geojson"].includes(format)) {
    let parsed:unknown;
    try{parsed=JSON.parse(decode(buffer));}catch{throw new Error("Nieprawidłowy JSON/GeoJSON; adres może wskazywać katalog HTML zamiast danych.");}
    return jsonRows(parsed);
  }
  if (format === "csv") {
    const text = decode(buffer);
    const first = text.split(/\r?\n/, 1)[0] ?? "";
    const delimiters = [",", ";", "\t"];
    const delimiter = delimiters.sort((a, b) => first.split(b).length - first.split(a).length)[0]!;
    const rows = parse(text, { columns: (headers: string[]) => headers.map(h => h.trim()), bom: true, delimiter, skip_empty_lines: true, relax_column_count_less:true,max_record_size: 256000 }) as Record<string, any>[];
    if (rows.length > MAX_ROWS) throw new Error("CSV przekracza limit 100 000 rekordów.");
    return unwrapEmbeddedCsv(rows);
  }
  if (format === "xlsx") {
    validateZip(buffer);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const rows: Record<string, any>[] = [];
    for (const sheet of workbook.worksheets) {
      let headers: string[] = [];
      sheet.eachRow((row, number) => {
        if (rows.length >= MAX_ROWS) throw new Error("XLSX przekracza limit 100 000 rekordów.");
        const vals = (row.values as ExcelJS.CellValue[]).slice(1).map(v =>
          v && typeof v === "object" ? "text" in v ? v.text : "result" in v ? v.result : "" : v);
        if (number === 1) headers = vals.map(v => String(v ?? "").trim());
        else rows.push(Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? null]).filter(([h]) => h)));
      });
    }
    return unwrapEmbeddedCsv(rows);
  }
  throw new Error(`Nieobsługiwany format: ${format || "nieznany"}. Obsługiwane: CSV, JSON, GeoJSON, XLSX.`);
}
