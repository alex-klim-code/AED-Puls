export type GeocodeAddress = { address: string; city: string; postalCode?: string | null };
const known = (value: string) => value.trim().length >= 2 && !/^(unknown|brak(?: danych)?)$/i.test(value.trim());
const comparable = (value: string) => value.normalize("NFD").replace(/\p{M}/gu,"").replace(/ł/gi,"l").toLocaleLowerCase("pl").replace(/\s+/g," ").trim();
const tidyStreet = (value: string) => value.trim().replace(/^(al|ul|pl)\.+\s*/i,"$1. ").replace(/\s+/g," ");

/** Extract only an explicit locality, never infer one from a publisher or map center. */
export function geocodingAddress(input: GeocodeAddress): GeocodeAddress | null {
  if(!known(input.address))return null;
  let street=input.address.trim(),city=input.city.trim(),postalCode=input.postalCode?.trim()||null;
  const full=street.match(/^(.+?)\s*,\s*(?:(\d{2}-\d{3})\s+)?([\p{L}][\p{L}\s.'’-]+)$/u);
  if(full){
    const embeddedCity=full[3]!.trim(),embeddedPostal=full[2]||null;
    if(known(city)&&comparable(city)!==comparable(embeddedCity))return null;
    if(postalCode&&embeddedPostal&&postalCode!==embeddedPostal)return null;
    street=full[1]!;city=embeddedCity;postalCode??=embeddedPostal;
  }
  street=tidyStreet(street);
  if(!known(city)||!/^(.*?)\s+(\d+[\p{L}]?(?:[/-]\d+[\p{L}]?)?)$/u.test(street))return null;
  return {address:street,city,postalCode};
}
