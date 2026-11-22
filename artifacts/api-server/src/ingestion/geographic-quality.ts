import { clean,keyOf,withinPoland } from "./normalize";

export function coordinateLayoutHold(rows:Record<string,any>[]){
  let checked=0,swapped=0;
  for(const row of rows){
    // GeoJSON specifies its own axis order; never reinterpret it using a flat-file heuristic.
    if(row.geometry)continue;
    const fields=new Map(Object.entries(row.properties??row).map(([k,v])=>[keyOf(k),v]));
    const number=(keys:string[])=>{
      const raw=keys.map(k=>fields.get(k)).find(v=>v!=null&&clean(v)!=="");
      return raw==null?NaN:Number(clean(raw).replace(",","."));
    };
    const lat=number(["latitude","lat","szerokoscgeograficzna","szerokosc"]);
    const lon=number(["longitude","lon","lng","dlugoscgeograficzna","dlugosc"]);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    checked++;
    if(!withinPoland(lat,lon)&&withinPoland(lon,lat))swapped++;
  }
  return checked>=2&&swapped>=checked/2
    ?`Niespójny porządek osi w zbiorze: ${swapped} z ${checked} par pasuje do Polski dopiero po zamianie osi. Wstrzymano publikację do wyjaśnienia przez wydawcę; nie zamieniamy współrzędnych automatycznie.`
    :undefined;
}
