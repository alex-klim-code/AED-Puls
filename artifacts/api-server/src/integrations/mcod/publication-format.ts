import { createHash } from "node:crypto";

export type SnapshotRow=Record<string,unknown>&{id:string;license:string;sourceRevision:string};
export const columns=["id","name","address","city","postalCode","voivodeship","latitude","longitude","description","placement",
  "accessibility","openingHours","publicAccess","deviceOperationalStatus","lastVerifiedAt","sourceOperationalClaim","declaredCheckDate","responsibleOrganization","notes",
  "completenessStatus","sourceName","sourceUrl","license","requiredAttribution","sourceRevision"] as const;
export const validCoordinates=(r:Record<string,unknown>)=>typeof r.latitude==="number"&&Number.isFinite(r.latitude)&&r.latitude>=-90&&r.latitude<=90&&
  typeof r.longitude==="number"&&Number.isFinite(r.longitude)&&r.longitude>=-180&&r.longitude<=180;
export function planKey(datasetId:string,format:string,snapshot:SnapshotRow[],validation:unknown){
  return createHash("sha256").update(JSON.stringify({datasetId,format,snapshot,validation})).digest("hex");
}
export function renderPublication(rows:Record<string,unknown>[],format:"csv"|"geojson"){
  if(format==="geojson")return JSON.stringify({type:"FeatureCollection",features:rows.map(row=>({
    type:"Feature",id:row.id,geometry:validCoordinates(row)?{type:"Point",coordinates:[row.longitude,row.latitude]}:null,
    properties:Object.fromEntries(columns.map(key=>[key,row[key]??null])),
  }))},null,2);
  const cell=(value:unknown)=>{
    let text=value===null||value===undefined?"":String(value);
    // A spreadsheet must not execute text supplied in an AED name or address.
    if(typeof value==="string"&&(/^[\s]*[=+\-@]/.test(text)||/^[\t\r]/.test(text)))text=`'${text}`;
    return `"${text.replace(/"/g,'""')}"`;
  };
  return "\ufeff"+[columns.join(","),...rows.map(row=>columns.map(key=>cell(row[key])).join(","))].join("\r\n")+"\r\n";
}
export function assessPublication(rows:SnapshotRow[],evidence:Map<string,{consent:boolean;externalProvenance:boolean;geocodingUnreviewed:boolean}>){
  const issues:{id:string;reason:string}[]=[],fingerprints=new Map<string,string>();
  const decisions:{id:string;status:"INCLUDED"|"BLOCKED";reasons:string[]}[]=[];
  const notices:{id:string;reason:string}[]=[];
  for(const row of rows){
    const reasons:string[]=[],proof=evidence.get(row.id);
    if(!["CC0-1.0","CC-BY-4.0","ODbL-1.0"].includes(row.license))reasons.push("UNKNOWN_LICENSE");
    if(!proof?.consent)reasons.push("NO_MATCHING_PUBLICATION_CONSENT");
    if(proof?.externalProvenance)reasons.push("IMPORTED_OR_MIXED_PROVENANCE_REQUIRES_REVIEW");
    if(proof?.geocodingUnreviewed)reasons.push("GEOCODING_RIGHTS_NOT_REVIEWED");
    if(!row.name||!row.sourceName||!row.requiredAttribution)reasons.push("MISSING_NAME_OR_ATTRIBUTION");
    if(!validCoordinates(row))notices.push({id:row.id,reason:"INCOMPLETE_LOCATION_GEOMETRY_NULL"});
    const fingerprint=JSON.stringify([row.name,row.address,row.latitude,row.longitude,row.placement,row.deviceIdentifier||""]);
    const other=fingerprints.get(fingerprint);
    if(other){
      reasons.push("POTENTIAL_DUPLICATE");
      if(!issues.some(i=>i.id===other&&i.reason==="POTENTIAL_DUPLICATE")){
        issues.push({id:other,reason:"POTENTIAL_DUPLICATE"});
        const first=decisions.find(d=>d.id===other);
        if(first){first.status="BLOCKED";first.reasons.push("POTENTIAL_DUPLICATE");}
      }
    }else fingerprints.set(fingerprint,row.id);
    for(const reason of reasons)issues.push({id:row.id,reason});
    decisions.push({id:row.id,status:reasons.length?"BLOCKED":"INCLUDED",reasons});
  }
  if(!rows.length)issues.push({id:"dataset",reason:"NO_APPROVED_OWN_AED"});
  const omitted=decisions.filter(d=>d.status==="BLOCKED").length;
  return {exported:rows.length-omitted,omitted,issues,notices,decisions,
    obligations:[...new Set(rows.map(row=>row.license))].map(license=>({
      license,notice:license==="ODbL-1.0"?"Zachowaj atrybucję i sprawdź obowiązki share-alike dla pochodnej bazy ODbL; nie przypisano tej licencji całemu mieszanemu plikowi.":
        license==="CC-BY-4.0"?"Podaj autora, źródło, licencję CC BY 4.0 oraz informację o zmianach.":"CC0 1.0; zachowano pochodzenie danych.",
    }))};
}
