import { download,downloadJson,type DownloadOptions } from "./http";
import { parseResource } from "./parsers";
import { canonicalLicense,clean,type SourceContext } from "./normalize";
import { API_ROOT,officialEntityUrl,governmentEvidence } from "./official";
import { resourceFingerprint } from "./resource-identity";
import { coordinateLayoutHold } from "./geographic-quality";
import type { ConnectorBatch } from "./connectors";

const keywords=["AED","defibrylator","defibrylatory","defibryzator","automatyczny defibrylator"];
export const relevantAedTitle=(d:any)=>/\baed\b|defibryl|defibryz/i.test(clean(d.attributes?.title).replace(/<[^>]*>/g,""));
const relevant=relevantAedTitle;
const formats=["geojson","json","csv","xlsx"];
export async function* cataloguePages(input:string,options:DownloadOptions={},get=downloadJson):AsyncGenerator<any[]>{
  let next:string|null=input,received=0;
  const visited=new Set<string>(),pageIdentities=new Set<string>();
  for(let page=1;next&&page<=1000;page++){
    const url:URL=new URL(next);
    if(url.origin!=="https://api.dane.gov.pl"||!url.pathname.startsWith("/1.4/"))throw new Error("Nieprawidłowy odnośnik paginacji API.");
    url.searchParams.set("per_page","100");
    if(!url.searchParams.has("page"))url.searchParams.set("page","1");
    if(visited.has(url.href))throw new Error("Zapętlona paginacja katalogu.");
    visited.add(url.href);
    const body=await get(url.href,options);
    if(!Array.isArray(body.data))throw new Error("Nieprawidłowa odpowiedź JSON:API dane.gov.pl.");
    if(body.data.length&&body.data.every((item:any)=>item.id!=null)){
      const identity=body.data.map((item:any)=>String(item.id)).join(",");
      if(pageIdentities.has(identity))throw new Error("Katalog powtórzył stronę; nie potwierdzono kompletności pobierania.");
      pageIdentities.add(identity);
    }
    if(!body.data.length&&body.links?.next)throw new Error("Katalog zwrócił pustą stronę z kontynuacją.");
    received+=body.data.length;
    yield body.data;
    const link=body.links?.next;
    if(link){next=new URL(typeof link==="string"?link:link.href,url).href;continue;}
    if(body.meta?.count!=null&&received<Number(body.meta.count)){
      if(!body.data.length)throw new Error("Katalog zakończył paginację przed pobraniem wszystkich wyników.");
      url.searchParams.set("page",String(Number(url.searchParams.get("page"))+1));next=url.href;continue;
    }
    return;
  }
  throw new Error("Przekroczono limit stron; nie potwierdzono kompletności katalogu.");
}
export async function pages(input:string,options:DownloadOptions={},get=downloadJson):Promise<any[]>{
  const items:any[]=[];
  for await(const page of cataloguePages(input,options,get))items.push(...page);
  return items;
}
export async function* governmentBatches(base:SourceContext,options:{datasetId?:string;probe?:boolean;io?:{json:typeof downloadJson;bytes:typeof download}}={}):AsyncGenerator<ConnectorBatch>{
  const get=options.io?.json??downloadJson,getBytes=options.io?.bytes??download;
  const network={attempts:options.probe?1:2,timeoutMs:options.probe?6000:12000};
  const datasets=new Map<string,any>();
  const discoveredResources=new Map<string,Set<string>>();
  if(options.datasetId)datasets.set(options.datasetId,{id:options.datasetId});
  else for(const keyword of keywords)try{
    for(const d of await pages(`${API_ROOT}/datasets?q=${encodeURIComponent(keyword)}`,network,get))if(relevant(d))datasets.set(String(d.id),d);
  }catch(e){yield{context:base,rows:[],issue:{severity:"error",rule:"discovery_failed",message:`Wyszukiwanie „${keyword}”: ${(e as Error).message}`}};}
  // A resource can describe AEDs even if its dataset is titled e.g. "Zdrowie".
  // Stream pages: fuzzy "AED" searches include thousands of unrelated resources.
  // Retain only explicitly AED-titled resource IDs, not their unrelated siblings.
  if(!options.datasetId)for(const keyword of options.probe?["defibrylator"]:["defibrylator","defibryzator","AED"])try{
    for await(const page of cataloguePages(`${API_ROOT}/resources?q=${encodeURIComponent(keyword)}`,network,get)){
      for(const resource of page){
        if(!relevant(resource))continue;
        const id=String(resource.relationships?.dataset?.data?.id??"");
        if(!/^\d+$/.test(id))continue;
        const ids=discoveredResources.get(id)??new Set<string>();
        ids.add(String(resource.id));discoveredResources.set(id,ids);
        if(!datasets.has(id))datasets.set(id,{id});
      }
    }
  }catch(e){yield{context:base,rows:[],issue:{severity:"error",rule:"discovery_failed",message:`Wyszukiwanie zasobów „${keyword}”: ${(e as Error).message}`}};}
  if(!datasets.size)throw new Error("Nie znaleziono zbiorów AED albo katalog wyszukiwania jest niedostępny.");
  for(const id of datasets.keys()){
    let context:SourceContext={...base,datasetId:id,datasetUrl:`https://dane.gov.pl/pl/dataset/${id}`};
    try{
      const dataset=(await get(officialEntityUrl(`${API_ROOT}/datasets/${id}`,"datasets",id),network)).data;
      if(!dataset||(!relevant(dataset)&&!discoveredResources.has(id)&&!options.datasetId))continue;
      const a=dataset.attributes,publisherId=String(dataset.relationships?.institution?.data?.id??"");
      const institution=(await get(officialEntityUrl(`${API_ROOT}/institutions/${publisherId}`,"institutions",publisherId),network)).data;
      context={...context,publisher:clean(institution?.attributes?.title),publisherId,
        license:canonicalLicense(a.license_name||(a.license_condition_default_cc40===true?"CC BY 4.0":"")),
        modified:clean(a.resource_modified||a.modified)||null,published:clean(a.created)||null,datasetTitle:clean(a.title),
        referenceScope:clean(a.notes||a.description).slice(0,2000),
        reuseConditions:Object.fromEntries(Object.entries(a).filter(([k])=>/license|reuse/.test(k))),
        coverage:(a.regions??[]).map((r:any)=>clean(r.name)).join(", ")||"UNKNOWN"};
      yield{context,rows:[],issue:{severity:"info",rule:"dataset_discovered",message:`Znaleziono rzeczywisty zbiór ${id}: ${context.datasetTitle}; wydawca: ${context.publisher}.`}};
      const resources=(await pages(`${API_ROOT}/datasets/${id}/resources`,network,get))
        .filter(r=>relevant(dataset)||relevant(r)||discoveredResources.get(id)?.has(String(r.id)));
      if(!resources.length)yield{context,rows:[],issue:{severity:"error",rule:"missing_resources",message:`Katalog nie udostępnia zasobów zbioru ${id}.`}};
      resources.sort((a,b)=>formats.indexOf(clean(a.attributes?.format).toLowerCase())-formats.indexOf(clean(b.attributes?.format).toLowerCase()));
      const seen=new Map<string,string>();
      for(const r of resources){
        const attr=r.attributes??{},format=clean(attr.format).toLowerCase().replace(/^\./,"");
        const rc:SourceContext={...context,resourceId:String(r.id),resourceFormat:format,
          url:clean(attr.file_url||attr.link||attr.download_url),modified:clean(attr.modified||context.modified)||null};
        if(!formats.includes(format)){yield{context:rc,rows:[],issue:{severity:"info",rule:"unsupported_format",message:`TODO: zasób ${r.id}, format ${format||"nieznany"} — pominięto nieobsługiwany format; obsługiwane CSV, JSON, GeoJSON, XLSX.`}};continue;}
        try{
          rc.provenanceEvidence=governmentEvidence(dataset,r,institution);rc.sourceCategory="OFFICIAL_GOV_PL";
          const urls=[...new Set([attr.file_url,attr.link,attr.download_url].map(clean).filter(Boolean))];
          let rows:Record<string,any>[]|undefined,last="Brak adresu pliku.";
          for(const url of urls)try{
            const body=await getBytes(url,network);
            if(/^\s*</.test(body.toString("utf8",0,200)))throw new Error("Adres zwraca stronę HTML/katalog, a nie plik danych.");
            rows=await parseResource(body,format);rc.url=url;break;
          }catch(e){last=(e as Error).message;}
          if(!rows) {
            // Some tabular resources expose the data API instead of a working file URL.
            // Keep the original API row as provenance; do not invent missing fields.
            const dataUrl = `${API_ROOT}/resources/${r.id}/data`;
            try {
              rows = [];
              for await (const page of cataloguePages(dataUrl, network, get)) {
                if (rows.length + page.length > 100000) throw new Error("Zasób przekracza limit 100 000 rekordów.");
                for (const row of page) rows.push(row?.attributes && typeof row.attributes === "object"
                  ? { ...row.attributes, _aedPulsOriginalRow: row } : row);
              }
              rc.url = dataUrl; rc.resourceFormat = "json";
            } catch (error) {
              throw new Error(`${last} API danych: ${error instanceof Error ? error.message : "brak dostępnej zawartości"}`);
            }
          }
          if(!rows.length)throw new Error("Pusty zasób danych.");
          rc.coordinateHoldReason=coordinateLayoutHold(rows);
          const fingerprint=resourceFingerprint(rows);
          rc.provenanceEvidence={...rc.provenanceEvidence,resourceFingerprint:fingerprint,distributionUrl:rc.url};
          if(seen.has(fingerprint)){
            rc.provenanceEvidence={...rc.provenanceEvidence,replicaOfResourceId:seen.get(fingerprint)};
            yield{context:rc,rows:[],metadata:{duplicateRows:rows.length,resource:r},
              issue:{severity:"info",rule:"resource_copy",message:`Zasób ${r.id} zawiera identyczne rekordy jak ${seen.get(fingerprint)}; nie tworzono kolejnych AED.`}};
            continue;
          }
          seen.set(fingerprint,String(r.id));
          yield{context:rc,rows,metadata:{dataset,resource:r}};
        }catch(e){yield{context:rc,rows:[],issue:{severity:"error",rule:"resource_failed",message:`Zasób ${r.id} (${format}): ${(e as Error).message}`}};}
      }
    }catch(e){yield{context,rows:[],issue:{severity:"error",rule:"dataset_failed",message:`Zbiór ${id}: ${(e as Error).message}`}};}
  }
}
