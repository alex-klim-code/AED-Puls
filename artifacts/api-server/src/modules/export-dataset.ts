import type { FastifyRequest } from "fastify";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, aeds, observations, organizations, sources, dataConflicts } from "@workspace/db";
import { z } from "zod/v4";
import { DownloadJsonDatasetResponseItem as ExportRecordSchema } from "@workspace/api-zod";
import type { ExportAedFields, ExportRecord, ExportProvider, ExportPublication } from "@workspace/api-zod";
import { fail, requireUser } from "./auth";
import { assessExport, legalDisclaimer, rightsPolicyVersion, rowProviderId } from "./export-rights";

export const exportSchemaVersion = "1.1.0";
export const knownLicenses = ["CC0-1.0", "CC-BY-4.0", "ODbL-1.0"];
export type ExportScope = "public" | "approved" | "review";
export const exportFields = [
  "id", "schemaVersion", "name", "address", "city", "postalCode", "voivodeship", "country",
  "latitude", "longitude", "completenessStatus", "fieldProvenance", "description", "placement", "accessibility", "openingHours",
  "deviceIdentifier", "responsibleOrganization", "sourceName", "sourceUrl", "license", "sourceCategory", "sourceOperationalClaim",
  "qualityScore", "qualityIssues", "providerIds", "providers", "licenses", "sources",
  "verificationStatus", "recordVerificationStatus", "operationalStatus", "verifiedAt",
  "sourceConflict", "createdAt", "updatedAt",
] as const satisfies readonly (keyof ExportRecord)[];

export function exportOptions(req: FastifyRequest, defaultScope: ExportScope) {
  const input = z.object({
    scope: z.enum(["public", "approved", "review"]).default(defaultScope),
    providerIds: z.string().min(1).max(65000).optional(),
    license: z.enum(["CC0-1.0", "CC-BY-4.0", "ODbL-1.0"]).optional(),
    licenses: z.string().min(1).max(200).optional(),
  }).parse(req.query);
  if (input.scope === "review") requireUser(req, ["ADMIN"]);
  const providerIds = input.providerIds === undefined ? undefined : [...new Set(input.providerIds.split(",").map(s => s.trim()))];
  if (providerIds?.some(id => !id) || (providerIds?.length ?? 0) > 1000) fail(400, "Wybierz od 1 do 1000 prawidłowych dostawców.");
  if(providerIds?.some(id=>id!=="dane-gov"&&id!=="aed-puls"&&(!/^(source|organization):/.test(id)||!z.uuid().safeParse(id.slice(id.indexOf(":")+1)).success)))
    fail(400,"Nieprawidłowy identyfikator dostawcy.");
  if(input.license&&input.licenses!==undefined)fail(400,"Wybierz parametr licenses albo license, nie oba jednocześnie.");
  const legacyLicense=input.license??(input.licenses===undefined&&input.scope==="approved"&&!providerIds?"CC0-1.0":undefined);
  const licenses=[...new Set(input.licenses?.split(",").map(s=>s.trim())??(legacyLicense?[legacyLicense]:knownLicenses))];
  if(!licenses.length||licenses.some(l=>!knownLicenses.includes(l)))fail(400,"Wybierz co najmniej jedną obsługiwaną licencję.");
  return { scope: input.scope, providerIds, license:input.license, licenses:licenses.sort() };
}
export type ExportOptions = ReturnType<typeof exportOptions>;

const root = alias(aeds, "export_root");
async function eligibleRows(scope: ExportScope, providerIds?:string[], familyIds?:string[], includeLineage=false,executor:Pick<typeof db,"select">=db) {
  const sourceIds=providerIds?.filter(id=>id.startsWith("source:")).map(id=>id.slice(7))??[];
  const orgIds=providerIds?.filter(id=>id.startsWith("organization:")).map(id=>id.slice(13))??[];
  const providerFilter=providerIds?or(
    providerIds.includes("dane-gov")?sql`${observations.sourceId} in (select id from data_sources where key='dane-gov' or key like 'dane-gov:%')`:undefined,
    sourceIds.length?inArray(observations.sourceId,sourceIds):undefined,
    orgIds.length?and(isNull(observations.sourceId),eq(aeds.imported,false),inArray(aeds.organizationId,orgIds)):undefined,
    providerIds.includes("aed-puls")?and(isNull(observations.sourceId),eq(aeds.imported,false),isNull(aeds.organizationId)):undefined,
  ):undefined;
  const visible = scope === "review" ? undefined : scope === "approved" ? inArray(root.verificationStatus, ["verified","VERIFIED"])
    : or(inArray(root.verificationStatus, ["verified","VERIFIED"]), and(inArray(root.verificationStatus, ["unverified","NOT_VERIFIED"]),eq(root.imported,true),
      or(eq(root.publicImport, true), and(isNull(root.latitude),isNull(root.longitude)))));
  const rows = await executor.select({
    original: aeds,
    canonical: { id: root.id, verificationStatus: root.verificationStatus, recordVerificationStatus: root.recordVerificationStatus,locationEvidence:root.locationEvidence,
      operationalStatus: root.deviceOperationalStatus, verifiedAt: root.verifiedAt, sourceConflict: root.sourceConflict },
    ref: { id: observations.id, sourceId: observations.sourceId, sourceRecordId: observations.sourceRecordId,
      catalogueProvider:sql<string|null>`case when ${observations.sourceId} in (select id from data_sources where key='dane-gov' or key like 'dane-gov:%') then 'dane-gov' else null end`,
      normalizedRecord: observations.normalizedRecord, license: observations.license, sourceUrl: observations.sourceUrl,
      publisher: observations.publisher, datasetId: observations.datasetId, datasetTitle: observations.datasetTitle,
      publisherId:observations.publisherId,reuseConditions:observations.reuseConditions,provenanceEvidence:observations.provenanceEvidence,
      datasetUrl: observations.datasetUrl, resourceId: observations.resourceId, importedAt: observations.importedAt,
      lastSyncedAt: observations.lastSyncedAt, sourceModifiedAt: observations.sourceModifiedAt, removedAt: observations.removedAt },
  }).from(aeds).innerJoin(root, sql`${root.id}=coalesce(${aeds.mergedIntoId},${aeds.id})`)
    .leftJoin(observations, eq(observations.aedId, aeds.id))
    .where(and(eq(aeds.isDemo, false), eq(root.isDemo, false), isNull(root.mergedIntoId), visible,providerFilter,
      familyIds?inArray(root.id,familyIds):undefined))
    .orderBy(aeds.id, observations.id);
  return rows.filter(r => {
    if(includeLineage)return true;
    if (r.ref?.removedAt) return false;
    if (scope !== "review" && !r.original.imported && !["verified","VERIFIED"].includes(r.original.verificationStatus)) return false;
    return true;
  });
}
export type ExportRow = Awaited<ReturnType<typeof eligibleRows>>[number];
type Row = ExportRow;

function providerId(r: Row) {
  if(r.ref?.catalogueProvider)return r.ref.catalogueProvider;
  if (r.ref?.sourceId) return `source:${r.ref.sourceId}`;
  if (r.original.organizationId) return `organization:${r.original.organizationId}`;
  return "aed-puls";
}

export async function exportContext(scope: ExportScope, providerIds?:string[],rightsLoaded=true) {
  // All fields and legal lineage must come from the same database snapshot.
  return db.transaction(async transaction=>{
  const [rows, sourceRows, orgRows] = await Promise.all([
    eligibleRows(scope,providerIds,undefined,false,transaction), transaction.select().from(sources).orderBy(sources.name), transaction.select().from(organizations).orderBy(organizations.name),
  ]);
  const families=[...new Set(rows.map(r=>r.canonical.id))];
  const [familyRows,conflicts]=rightsLoaded&&families.length?await Promise.all([
    eligibleRows(scope,undefined,families,true,transaction),
    transaction.select({rootId:sql<string>`coalesce(${aeds.mergedIntoId},${aeds.id})`}).from(dataConflicts)
      .innerJoin(aeds,eq(aeds.id,dataConflicts.aedId))
      .where(and(eq(dataConflicts.field,"license"),eq(dataConflicts.status,"pending"),
        inArray(sql`coalesce(${aeds.mergedIntoId},${aeds.id})`,families))),
  ]):[[],[]];
  const lineage=new Map<string,Row[]>();
  for(const row of familyRows){const group=lineage.get(row.canonical.id)??[];group.push(row);lineage.set(row.canonical.id,group);}
  const counts = new Map<string, Set<string>>();
  for (const r of rows) {
    const id = providerId(r), ids = counts.get(id) ?? new Set<string>();
    ids.add(r.canonical.id); counts.set(id, ids);
  }
  const providers: ExportProvider[] = [
    ...sourceRows.filter(s=>s.key==="dane-gov").map(s=>({
      id:"dane-gov",name:"dane.gov.pl",kind:"source" as const,status:s.status,
      license:"Licencje poszczególnych zbiorów i wydawców",recordCount:counts.get("dane-gov")?.size??0,
    })),
    ...sourceRows.filter(s => s.key!=="dane-gov"&&!s.key?.startsWith("dane-gov:")&&s.sourceType!=="wms").map(s => ({
      id: `source:${s.id}`, name: s.name, kind: "source" as const, status: s.status,
      license: s.license, recordCount: counts.get(`source:${s.id}`)?.size ?? 0,
    })),
    ...(counts.has("aed-puls")?[{ id: "aed-puls", name: "AED Puls — zgłoszenia przez aplikację", kind: "application" as const, status: "ready",
      license: "Licencja podana w rekordzie", recordCount: counts.get("aed-puls")!.size }]:[]),
    ...orgRows.filter(o => counts.has(`organization:${o.id}`)).map(o => ({
      id: `organization:${o.id}`, name: o.name, kind: "organization" as const, status: "ready",
      license: "Licencja podana w rekordzie", recordCount: counts.get(`organization:${o.id}`)!.size,
    })),
  ];
  return { rows, providers, sourceRows, lineage, rightsLoaded, licenseConflicts:new Set(conflicts.map(c=>c.rootId)) };
  },{isolationLevel:"repeatable read",accessMode:"read only"});
}
export type ExportContext=Awaited<ReturnType<typeof exportContext>>;

export function selectedRows(context: Awaited<ReturnType<typeof exportContext>>, options: ExportOptions) {
  const providerMap = new Map(context.providers.map(p => [p.id, p]));
  const selected = options.providerIds ?? context.providers.map(p => p.id);
  if (selected.some(id => !providerMap.has(id))) fail(400, "Nieznany lub niedostępny dostawca. Odśwież listę i wybierz ponownie.");
  const wanted = new Set(selected);
  const rows = context.rows.filter(r => wanted.has(providerId(r)) && options.licenses.includes(r.ref?.license ?? r.original.license));
  return { rows, selected, providerMap };
}

export function exportPreview(context: ExportContext, options: ExportOptions, assessment=assessExport(context,options)) {
  const { selected, providerMap } = selectedRows(context, options);
  const rows=assessment.rows;
  const empty = selected.filter(id => !rows.some(r => providerId(r) === id)).map(id => providerMap.get(id)!.name);
  return {
    recordCount: new Set(rows.map(r => r.canonical.id)).size,
    publicationCount: rows.length, providerIds: selected,
    licenses: [...new Set([...assessment.accepted.values()].flatMap(g=>g.attributions.map(a=>a.license)))].sort(),
    candidateRecordCount:assessment.candidateRecordCount,skippedRecordCount:assessment.skippedRecordCount,
    skippedPublicationCount:assessment.skippedPublicationCount,selectedLicenses:options.licenses,
    sources:selected.map(id=>{
      const candidates=new Set(assessment.candidates.filter(r=>rowProviderId(r)===id).map(r=>r.canonical.id));
      const exported=new Set(rows.filter(r=>rowProviderId(r)===id).map(r=>r.canonical.id));
      const provider=providerMap.get(id)!;
      return {...provider,recordCount:candidates.size,exportedRecordCount:exported.size,skippedRecordCount:candidates.size-exported.size};
    }),
    reasons:assessment.reasons,policyVersion:rightsPolicyVersion,legalDisclaimer,reportDownloadAvailable:selected.length>0,
    manualReviewCount: assessment.manualReviewCount,
    decisionSamples: [...assessment.decisions].sort((a,b) => Number(b.decision === "MANUAL_REVIEW") - Number(a.decision === "MANUAL_REVIEW")).slice(0,20),
    schemaVersion: exportSchemaVersion, fields: [...exportFields],
    warnings: [
      ...(empty.length ? [`Brak rekordów w tym zakresie: ${empty.join("; ")}.`] : []),
      ...assessment.reasons.map(r=>`${r.message} Dotyczy AED: ${r.recordCount}.`),
      "Nieznane i niezweryfikowane prawa są blokowane. Filtrowanie nie usuwa obowiązków pochodzących z pełnej historii scalenia.",
      ...(options.scope !== "approved" ? ["Plik może zawierać niezweryfikowane dane. Import nie potwierdza sprawności ani dostępności AED."] : []),
      "Każda publikacja zachowuje własną licencję; plik nie nadaje wszystkim danym licencji CC0.",
      "ODbL nie zabrania eksportu. Niezależne rekordy różnych licencji nie blokują się wzajemnie; nierozstrzygnięte połączenia pól i praw w obrębie jednego AED wymagają ręcznej oceny.",
    ],
  };
}

function fieldsFor(r: Row): ExportAedFields {
  // Never fill a selected provider's attributes from a different, unselected canonical provider.
  const data = (r.original.imported || r.ref?.sourceId) ? r.ref!.normalizedRecord! : r.original;
  const value = (key: keyof ExportAedFields) => (data as Record<string, unknown>)[key];
  const text = (key: keyof ExportAedFields, fallback = "") => typeof value(key) === "string" ? String(value(key)) : fallback;
  const nullable = (key: keyof ExportAedFields) => typeof value(key) === "string" && value(key) !== "" ? String(value(key)) : null;
  const lat = value("latitude"), lon = value("longitude");
  const valid=typeof lat==="number"&&typeof lon==="number"&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
  const latitude=valid?lat:null,longitude=valid?lon:null;
  return {
    name: text("name", "UNKNOWN"), address: text("address", "UNKNOWN"), city: text("city", "UNKNOWN"),
    postalCode: nullable("postalCode"), voivodeship: nullable("voivodeship"), country: text("country", "PL"),
    latitude, longitude, description: nullable("description"), placement: text("placement", "unknown"),
    completenessStatus: valid && ["name","address","city"].every(key => text(key as keyof ExportAedFields).trim() && text(key as keyof ExportAedFields) !== "UNKNOWN") ? "COMPLETE" : "INCOMPLETE",
    accessibility: text("accessibility", "unknown"), openingHours: nullable("openingHours"), deviceIdentifier: nullable("deviceIdentifier"),
    responsibleOrganization: nullable("responsibleOrganization"), sourceName: text("sourceName", r.original.sourceName),
    sourceUrl: r.ref?.sourceUrl ?? r.original.sourceUrl, license: r.ref?.license ?? r.original.license,
    sourceCategory: text("sourceCategory", r.original.sourceCategory),
    sourceOperationalClaim:nullable("sourceOperationalClaim"),
    qualityScore: typeof value("qualityScore") === "number" ? Number(value("qualityScore")) : r.original.qualityScore,
    qualityIssues: Array.isArray(value("qualityIssues")) ? (value("qualityIssues") as unknown[]).map(String) : [],
  };
}

export function exportRecords(context: ExportContext, options: ExportOptions, assessment=assessExport(context,options)): ExportRecord[] {
  const { providerMap } = selectedRows(context, options);
  const rows=assessment.rows;
  const groups = new Map<string, Row[]>();
  for (const r of rows) { const group = groups.get(r.canonical.id) ?? []; group.push(r); groups.set(r.canonical.id, group); }
  return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([id, group]) => {
    const primary = group.find(r => r.original.id === id) ?? group[0]!;
    const publications: ExportPublication[] = group.map(r => ({
      id: r.ref?.id ?? `aed:${r.original.id}`, providerId: providerId(r), providerName: providerMap.get(providerId(r))!.name,
      sourceRecordId: r.ref?.sourceRecordId ?? r.original.id, publisher: r.ref?.publisher ?? null,publisherId:r.ref?.publisherId??null,
      reuseConditions:{...r.ref?.reuseConditions,mandatoryAttributions:assessment.accepted.get(id)!.attributions,
        licensePolicyVersion:rightsPolicyVersion,mandatoryAttributionCannotBeDisabled:true},
      provenanceEvidence:r.ref?.provenanceEvidence??{},
      datasetId: r.ref?.datasetId ?? null, datasetTitle: r.ref?.datasetTitle ?? null,
      datasetUrl: r.ref?.datasetUrl ?? null, resourceId: r.ref?.resourceId ?? null,
      importedAt: (r.ref?.importedAt ?? r.original.createdAt).toISOString(),
      lastSyncedAt: (r.ref?.lastSyncedAt ?? r.original.updatedAt).toISOString(),
      sourceModifiedAt: r.ref?.sourceModifiedAt?.toISOString() ?? null, data: fieldsFor(r),
    }));
    return ExportRecordSchema.parse({
      ...fieldsFor(primary), id, schemaVersion: exportSchemaVersion,
      fieldProvenance: [{ publicationId: primary.ref?.id ?? `aed:${primary.original.id}`,
        fields: Object.keys(fieldsFor(primary)), license: primary.ref?.license ?? primary.original.license }],
      providerIds: [...new Set(publications.map(p => p.providerId))].sort(),
      providers: [...new Set(publications.map(p => p.providerName))].sort(),
      licenses: [...new Set(assessment.accepted.get(id)!.attributions.map(a=>a.license))].sort(), sources: publications,
      verificationStatus: primary.canonical.verificationStatus, recordVerificationStatus: primary.canonical.recordVerificationStatus,
      operationalStatus: primary.canonical.operationalStatus, verifiedAt: primary.canonical.verifiedAt?.toISOString() ?? null,
      sourceConflict: primary.canonical.sourceConflict, createdAt: primary.original.createdAt.toISOString(),
      updatedAt: primary.original.updatedAt.toISOString(),
    });
  });
}

export function csvCell(value: unknown, protectFormula = true) {
  let s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (protectFormula && /^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return `"${s.replaceAll('"', '""')}"`;
}
export function formatExport(records: ExportRecord[], format: "json" | "csv" | "geojson") {
  if (format === "json") return JSON.stringify(records);
  if (format === "geojson") return JSON.stringify({
    type: "FeatureCollection", features: records.map(record => ({
      type: "Feature", geometry: record.latitude==null||record.longitude==null?null:{ type: "Point", coordinates: [record.longitude, record.latitude] }, properties: record,
    })),
  });
  return "\uFEFF" + [
    exportFields.map(f => csvCell(f)).join(","),
    ...records.map(record => exportFields.map(f => csvCell(record[f], typeof record[f] !== "number")).join(",")),
  ].join("\r\n");
}
