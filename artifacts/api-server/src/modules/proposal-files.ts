import ExcelJS from "exceljs";
import JSZip from "jszip";
import { parse } from "csv-parse/sync";
import { fail } from "./auth";
import { normalizeProposalLicense } from "./proposal-service";

const columns=[
  ["name","Nazwa",160],["address","Adres",240],["city","Miejscowość",120],["postalCode","Kod pocztowy",10],
  ["voivodeship","Województwo",100],["latitude","Szerokość geograficzna",100],["longitude","Długość geograficzna",100],
  ["description","Opis miejsca",2000],["placement","Umiejscowienie",30],["accessibility","Dostępność",30],
  ["openingHours","Godziny dostępności",200],["sourceUrl","URL źródła",1000],["license","Licencja",200],
] as const;
const normalize=(s:string)=>s.normalize("NFD").toLowerCase().replace(/[\u0300-\u036f]/g,"").replace(/ł/g,"l").replace(/[^a-z0-9]/g,"");
const headers=new Map(columns.flatMap(([key,label])=>[[normalize(key),key],[normalize(label),key]] as [string,string][]));
function validateHeaders(values:string[]){
  const keys=values.map(v=>headers.get(normalize(v))??v);
  if(values.length>25||!values.some(v=>headers.has(normalize(v)))||new Set(keys).size!==keys.length||
    values.some(v=>["__proto__","prototype","constructor"].includes(v.trim())))
    fail(400,"Nagłówki są nieprawidłowe lub powtórzone. Pobierz niezmieniony wzór XLSX.");
  return values;
}
export async function proposalTemplate(){
  const book=new ExcelJS.Workbook();book.creator="AED Puls";
  const sheet=book.addWorksheet("AED");sheet.addRow(columns.map(c=>c[1]));sheet.getRow(1).font={bold:true};
  sheet.columns.forEach(c=>{c.width=25;});sheet.views=[{state:"frozen",ySplit:1}];
  const help=book.addWorksheet("Instrukcja");
  help.addRows([
    ["AED Puls — wzór zgłoszeń organizacji","Wypełnij arkusz AED. Każdy niepusty wiersz jest osobnym zgłoszeniem do ADMINA, nie rekordem opublikowanym."],
    ["Limit","500 wierszy danych, 5 MiB. Nie zmieniaj nagłówków. Braki pozostaw puste; nie wymyślaj adresów ani współrzędnych."],
    ["Współrzędne","Liczby dziesiętne WGS84, np. z dokumentacji lokalizacji. Brak danych = puste komórki. Nie używaj formuł."],
    ["Umiejscowienie","indoor / outdoor / unknown"],["Dostępność","24/7 / limited / unknown"],
    ["CC0-1.0","Dane otwarte, zrzeczenie się praw w dozwolonym prawem zakresie; bez obowiązku atrybucji wynikającego z CC0."],
    ["CC-BY-4.0","Dane otwarte z obowiązkiem podania autorstwa, źródła i informacji o zmianach."],
    ["ODbL-1.0","Otwarta baza danych: uznanie źródła i obowiązek udostępniania pochodnych baz na tych samych warunkach."],
    ["Pusta licencja / UNKNOWN","Wymaga wyjaśnienia przed publikacją. Wybór licencji nie usuwa praw i atrybucji innych źródeł."],
    ["Źródło","Organizacja przypisana do zalogowanego konta. Nie jest pobierane z pliku."],
    ["Weryfikacja","Akceptacja przez administratora dotyczy danych, nie potwierdza sprawności medycznej urządzenia."],
  ]);
  help.getColumn(1).width=28;help.getColumn(2).width=110;help.getColumn(2).alignment={wrapText:true,vertical:"top"};
  help.eachRow(r=>{r.height=42;});
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function readProposalFile(filename:string,base64:string,fallbackLicense:string){
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))fail(400,"Nieprawidłowa zawartość pliku.");
  const bytes=Buffer.from(base64,"base64");
  if(!bytes.length||bytes.length>5*1024*1024)fail(400,"Plik musi mieć od 1 bajta do 5 MiB.");
  let rawRows:{row:number;raw:Record<string,unknown>}[]=[];
  const extension=filename.toLowerCase().split(".").pop();
  if(extension==="xlsx"){
    try{
      const zip=await JSZip.loadAsync(bytes);
      const entries=Object.values(zip.files).filter(f=>!f.dir);
      const expanded=entries.reduce((n,f)=>n+((f as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize??25*1024*1024),0);
      if(entries.length>200||expanded>25*1024*1024)fail(400,"Arkusz ma zbyt dużą zawartość po rozpakowaniu.");
      const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as unknown as Parameters<typeof book.xlsx.load>[0]);
      const sheet=book.getWorksheet("AED")??book.worksheets[0];
      if(!sheet||sheet.columnCount>25||sheet.rowCount>501)fail(400,"Wzór może zawierać najwyżej 500 wierszy i 25 kolumn.");
      const header=(sheet.getRow(1).values as unknown[]).slice(1).map(v=>String(v??"").trim());
      validateHeaders(header);
      sheet.eachRow((row,n)=>{if(n===1)return;const raw:Record<string,unknown>={};
        header.forEach((h,i)=>{raw[h]=row.getCell(i+1).value??"";});
        if(Object.values(raw).some(v=>String(v).trim()))rawRows.push({row:n,raw});
      });
    }catch(error){if((error as {statusCode?:number}).statusCode)throw error;fail(400,"Nie można odczytać XLSX. Użyj pustego wzoru AED Puls, bez haseł i makr.");}
  }else if(extension==="csv"){
    try{
      const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
      const delimiter=text.split(/\r?\n/,1)[0]!.includes(";")?";":",";
      const rows=parse(text,{bom:true,delimiter,skip_empty_lines:true,max_record_size:32000,to:501,
        columns:validateHeaders}) as Record<string,unknown>[];
      if(rows.length>500)fail(400,"Maksymalnie 500 wierszy danych w jednym pliku.");
      rawRows=rows.map((raw,i)=>({row:i+2,raw})).filter(r=>Object.values(r.raw).some(v=>String(v).trim()));
    }catch(error){if((error as {statusCode?:number}).statusCode)throw error;fail(400,"Nieprawidłowy CSV UTF-8. Zachowaj nagłówki wzoru i jednakową liczbę kolumn.");}
  }else fail(400,"Dozwolone pliki: XLSX i CSV.");
  if(!rawRows.length)fail(400,"Plik nie zawiera niepustych wierszy AED.");
  return rawRows.map(({row,raw})=>{
    const warnings:string[]=[];const fields:Record<string,string>={};
    for(const [h,v]of Object.entries(raw)){
      const key=headers.get(normalize(h));if(!key)continue;
      if(v&&typeof v==="object"){warnings.push(`Pole ${key} zawiera formułę lub złożoną wartość. Oryginał zachowano; administrator uzupełni pole.`);fields[key]="";}
      else fields[key]=String(v??"").trim();
    }
    for(const [key,,limit]of columns)if((fields[key]?.length??0)>limit){warnings.push(`Pole ${key} jest za długie; oryginał zachowano do oceny.`);fields[key]=fields[key]!.slice(0,limit);}
    const number=(key:string,min:number,max:number)=>{
      const s=fields[key];if(!s)return null;const n=Number(s.replace(",","."));
      if(!Number.isFinite(n)||n<min||n>max){warnings.push(`Nieprawidłowe ${key}; oryginał zachowano, lokalizacja wymaga uzupełnienia.`);return null;}return n;
    };
    const license=normalizeProposalLicense(fields.license||fallbackLicense);
    if(fields.sourceUrl&&!/^https?:\/\/[^\s]+$/i.test(fields.sourceUrl)){
      warnings.push("Nieprawidłowy URL źródła zachowano w oryginale do wyjaśnienia.");fields.sourceUrl="";
    }
    return {row,raw,warnings,input:{name:fields.name??"",address:fields.address??"",city:fields.city??"",
      postalCode:fields.postalCode??"",voivodeship:fields.voivodeship??"",description:fields.description??"",
      latitude:number("latitude",-90,90),longitude:number("longitude",-180,180),
      placement:["indoor","outdoor"].includes(fields.placement??"")?fields.placement:"unknown",
      accessibility:["24/7","limited"].includes(fields.accessibility??"")?fields.accessibility:"unknown",
      openingHours:fields.openingHours??"",sourceName:"",sourceUrl:fields.sourceUrl??"",license,submissionMethod:"FILE"}};
  });
}
