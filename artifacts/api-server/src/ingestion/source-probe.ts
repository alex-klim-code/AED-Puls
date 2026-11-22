import { eq,sql } from "drizzle-orm";
import { db,sources,auditLogs } from "@workspace/db";
import { connectSource, SOURCE_DEFINITIONS, type SourceKey } from "./connectors";
import { fail } from "../modules/auth";
import { download } from "./http";
import { openAedConfiguration } from "./optional-connectors";

export async function testConnection(source:typeof sources.$inferSelect,userId:string){
  if(!SOURCE_DEFINITIONS.some(s=>s.key===source.key)&&source.key!=="geoportal"&&!/^dane-gov:\d+$/.test(source.key??""))
    fail(400,"Nieznana integracja AED.");
  let status="unavailable",message="Źródło nie dostarczyło obsługiwanego pliku rekordów.",recordCount=0;
  try{
    if(source.key==="geoportal"){
      const url=new URL(source.url);url.searchParams.set("SERVICE","WMS");url.searchParams.set("REQUEST","GetCapabilities");
      const body=await download(url.href,{attempts:1,timeoutMs:6000});
      if(!/WMS_Capabilities|WMT_MS_Capabilities/.test(body.toString("utf8")))throw new Error("Odpowiedź nie jest dokumentem WMS GetCapabilities.");
      status="dependent";message="Warstwa WMS odpowiada; nie importujemy obrazów mapy jako rekordów AED.";
    }else if(source.key==="openaed-eu"&&!openAedConfiguration().ready){
      status="requires_configuration";message=openAedConfiguration().message;
    }else{
    const datasetId=source.key?.startsWith("dane-gov:")?source.key.split(":")[1]:undefined;
    let firstError:string|undefined;
    for await(const packet of connectSource(datasetId?"dane-gov":source.key as SourceKey,{probe:true,datasetId})){
      if(packet.issue?.severity==="error")firstError??=packet.issue.message;
      else if(packet.issue)message=packet.issue.message;
      if(packet.rows.length){
        recordCount=packet.rows.length;status="connected";
        message=`Pobrano i odczytano pierwszy obsługiwany zasób (${recordCount} rekordów). To próba połączenia, nie pełna synchronizacja ani weryfikacja urządzeń.`;
        break;
      }
    }
    if(status!=="connected"&&firstError)message=firstError;
    }
  }catch(e){message=e instanceof Error?e.message:"Nie udało się połączyć ze źródłem.";}
  const checkedAt=new Date().toISOString(),connectionTest={status,message,checkedAt,recordCount};
  await db.transaction(async tx=>{
    await tx.update(sources).set({provenanceEvidence:sql`${sources.provenanceEvidence} || ${JSON.stringify({connectionTest})}::jsonb`}).where(eq(sources.id,source.id));
    await tx.insert(auditLogs).values({userId,entityId:source.id,action:`Test połączenia źródła: ${status}`,details:connectionTest});
  });
  return{sourceId:source.id,...connectionTest};
}
