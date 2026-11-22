import ExcelJS from "exceljs";
import type { ExportContext,ExportOptions } from "./export-dataset";
import { exportFields } from "./export-dataset";
import { exportBundleContent } from "./export-bundle";
import { assessExport } from "./export-rights";
import { dataStandard } from "./data-standard";
import { fail } from "./auth";

export const xlsxMime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function cell(value:unknown):ExcelJS.CellValue{
  if(value==null)return null;
  if(typeof value==="number"||typeof value==="boolean")return value;
  const text=typeof value==="string"?value:JSON.stringify(value);
  if(text.length>32767)fail(422,"Metadane jednego pola przekraczają limit komórki Excel (32767 znaków). Wybierz JSON lub GeoJSON; dane nie zostały skrócone.");
  // Plain string values, never ExcelJS formula objects, including source strings beginning with '='.
  return text;
}
function style(sheet:ExcelJS.Worksheet){
  sheet.views=[{state:"frozen",ySplit:1}];
  sheet.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};
  sheet.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF0F172A"}};
  sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:sheet.columnCount}};
  sheet.columns.forEach(c=>{c.width=28;});
}
export async function buildXlsxExport(context:ExportContext,options:ExportOptions,assessment=assessExport(context,options)){
  const content=exportBundleContent(context,options,assessment),workbook=new ExcelJS.Workbook();
  workbook.creator="AED Puls";workbook.created=new Date();
  const data=workbook.addWorksheet("AED");
  data.addRow([...exportFields]);
  for(const record of content.records)data.addRow(exportFields.map(key=>cell(record[key])));
  style(data);
  const sources=workbook.addWorksheet("Źródła i licencje");
  sources.addRow([...content.sourceColumns]);
  for(const row of content.sourceRows)sources.addRow(content.sourceColumns.map(key=>cell(row[key])));
  style(sources);
  const terms=workbook.addWorksheet("Warunki");
  terms.addRow(["Warunki ponownego wykorzystania i obowiązkowa atrybucja"]);
  const text=content.licensesText.replaceAll("sources.csv","arkusz „Źródła i licencje”").replaceAll("aed_data.csv","arkusz „AED”")
    .replaceAll("całego archiwum","całego skoroszytu");
  for(const line of text.split("\n"))terms.addRow([cell(line)]);
  terms.getColumn(1).width=110;terms.getColumn(1).alignment={wrapText:true,vertical:"top"};
  const standard=workbook.addWorksheet("Standard danych");
  standard.addRow(["Pole","Opis","Typ","Wymagalność","Walidacja","Wartości","Przykład","Pochodzenie"]);
  for(const key of exportFields)standard.addRow((dataStandard.find(r=>r[0]===key)??[key,"Pole wspólnego rekordu eksportowego","Zgodnie z ExportRecord",
    "Stały zestaw pól","Takie same dane w CSV, JSON, GeoJSON i XLSX","","","Zagnieżdżone wartości jako JSON w komórce"]).map(cell));
  style(standard);
  const report=workbook.addWorksheet("Raport walidacji");
  report.addRow(["Segment","Fragment JSON — połącz fragmenty w kolejności, bez separatora"]);
  const{files:_csvFiles,...validation}=content.report;
  const json=JSON.stringify({...validation,format:"XLSX",worksheets:workbook.worksheets.map(s=>s.name)},null,2);
  let offset=0,index=1;
  while(offset<json.length){
    let end=Math.min(offset+30000,json.length);
    if(/[\uD800-\uDBFF]/.test(json[end-1]??""))end--;
    report.addRow([index++,json.slice(offset,end)]);offset=end;
  }
  style(report);report.getColumn(2).width=110;
  return{buffer:Buffer.from(await workbook.xlsx.writeBuffer()),records:content.records};
}
