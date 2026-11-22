import { download } from "./http";
import { normalizeRow,type SourceContext } from "./normalize";
import { jsonRows } from "./parsers";
import type { ConnectorBatch } from "./connectors";

export function openAedConfiguration(env:Record<string,string|undefined>=process.env){
  const base=env.OPENAED_API_BASE_URL,evidence=env.OPENAED_PL_EVIDENCE_URL;
  const missing="Wymaga konfiguracji: OPENAED_API_TOKEN w Replit Secrets, OPENAED_API_BASE_URL, OPENAED_PL_CONFIRMED=true i OPENAED_PL_EVIDENCE_URL z potwierdzeniem operatora dla Polski. Oficjalna dokumentacja obecnie wymienia tylko NL.";
  if(!env.OPENAED_API_TOKEN||!base||env.OPENAED_PL_CONFIRMED!=="true"||!evidence)return{ready:false,message:missing};
  try{
    const url=new URL(base),proof=new URL(evidence);
    if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||proof.protocol!=="https:"||proof.username||proof.password||proof.search)throw Error();
    if(url.hostname==="nl.api.openaed.eu")return{ready:false,message:"Potwierdzona instancja NL nie jest źródłem dla Polski. Wymagane potwierdzenie polskiego zakresu od operatora."};
    return{ready:true,baseUrl:url.href.replace(/\/$/,""),evidenceUrl:proof.href,message:"Instancja dla Polski skonfigurowana przez operatora; dostęp wymaga próby połączenia."};
  }catch{return{ready:false,message:"Nieprawidłowy adres instancji lub dowodu dostępu: wymagane publiczne HTTPS, bez danych logowania i tokenów w URL."};}
}
export async function* openAedBatches(base:SourceContext,probe=false):AsyncGenerator<ConnectorBatch>{
  const config=openAedConfiguration();
  if(!config.ready||!config.baseUrl){
    yield{context:base,rows:[],issue:{severity:"error",rule:"requires_configuration",message:config.message}};return;
  }
  const context:SourceContext={...base,datasetId:"openaed-pl",datasetUrl:config.baseUrl,
    sourceCategory:"COMMUNITY_OPEN_DATA",resourceFormat:"json",
    provenanceEvidence:{method:"operator_confirmed_instance",polandEvidenceUrl:config.evidenceUrl,dataOrigin:"osm_derived"}};
  let next:string|null=`${config.baseUrl}/api/defibrillators`;
  const seen=new Set<string>();
  for(let page=1;next&&page<=100;page++){
    const url:URL=new URL(next);
    if(url.origin!==new URL(config.baseUrl).origin||seen.has(url.href))throw new Error("Zablokowano nieprawidłową paginację OpenAED.");
    seen.add(url.href);context.url=url.href;
    const body=await download(url.href,{bearerToken:process.env.OPENAED_API_TOKEN,attempts:probe?1:2,timeoutMs:probe?6000:20000});
    let doc:any;
    try{doc=JSON.parse(body.toString("utf8"));}catch{throw new Error("OpenAED nie zwrócił poprawnego JSON. Treści odpowiedzi nie zapisano w komunikacie.");}
    const rows=jsonRows(doc);
    if(!rows.length&&page===1)throw new Error("Instancja nie dostarczyła rekordów; nie potwierdzono zakresu Polski.");
    if(rows.length&&!rows.some(original=>normalizeRow({original,context}).data))throw new Error("Zasób nie zawiera poprawnych lokalizacji w Polsce; nie potwierdzono polskiego zakresu instancji.");
    yield{context:{...context},rows};
    const link=doc.links?.next??doc.next_page_url;
    next=typeof link==="string"?new URL(link,url).href:null;
  }
  if(next)throw new Error("Nie ukończono paginacji OpenAED; dotychczasowych danych nie wycofano.");
}
