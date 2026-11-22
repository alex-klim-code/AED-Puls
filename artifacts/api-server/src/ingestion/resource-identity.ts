import { digest,stableDigest } from "./normalize";
// Distribution identity is evidence of identical source data, not another device check.
export function resourceFingerprint(rows:Record<string,any>[]){
  return digest(rows.map(r=>stableDigest(r.type==="Feature"?{geometry:r.geometry,properties:r.properties}:r)).sort());
}
