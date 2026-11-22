export const API_ROOT = "https://api.dane.gov.pl/1.4";
export function officialEntityUrl(url: string, collection: string, id: string) {
  const u = new URL(url);
  if (!/^\d+$/.test(id) || u.origin !== "https://api.dane.gov.pl"
    || !(u.pathname === `/1.4/${collection}/${id}` || u.pathname.startsWith(`/1.4/${collection}/${id},`))
    || u.username || u.password) throw new Error("Brak zgodnego odnośnika do encji oficjalnego API.");
  return url;
}
export function governmentEvidence(dataset: any, resource: any, institution: any) {
  const publisherId = String(dataset.relationships?.institution?.data?.id ?? "");
  const datasetId = String(dataset.id ?? ""), resourceId = String(resource.id ?? "");
  if (dataset.type !== "dataset" || resource.type !== "resource" || institution?.type !== "institution"
    || !/^\d+$/.test(datasetId) || !/^\d+$/.test(resourceId) || !publisherId || String(institution.id) !== publisherId
    || !institution.attributes?.title
    || (resource.relationships?.dataset?.data?.id && String(resource.relationships.dataset.data.id) !== datasetId)) {
    throw new Error("Nie potwierdzono tożsamości wydawcy, zbioru lub zasobu w oficjalnym API.");
  }
  return { method: "official_api_dataset_resource_institution", datasetId, resourceId, publisherId,
    datasetApiUrl: `${API_ROOT}/datasets/${datasetId}`, resourceApiUrl: `${API_ROOT}/resources/${resourceId}`,
    publisherApiUrl: `${API_ROOT}/institutions/${publisherId}`, publisherName: String(institution.attributes.title),
    publisherType: institution.attributes.institution_type ?? "UNKNOWN",
  };
}
