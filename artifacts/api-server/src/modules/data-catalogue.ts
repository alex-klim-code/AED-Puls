import type { FastifyInstance } from "fastify";
import { db, observations } from "@workspace/db";
import { exportContext, exportFields, exportSchemaVersion } from "./export-dataset";
import { dataStandard } from "./data-standard";

const calculated: Record<string, string> = {
  id: "Identyfikator kanoniczny nadawany przez AED Puls",
  schemaVersion: "Wersja wspólnego standardu eksportu",
  completenessStatus: "Wyliczany przez istniejącą walidację kompletności",
  fieldProvenance: "Budowane z historii pochodzenia pól i publikacji",
  qualityScore: "Obecny wskaźnik kompletności 0–100, nie ocena sprawności",
  qualityIssues: "Wyniki istniejącej walidacji danych",
  providerIds: "Lista identyfikatorów dostawców",
  providers: "Lista dostawców; jej długość określa liczbę źródeł",
  licenses: "Lista licencji poszczególnych publikacji, bez przelicencjonowania",
  sources: "Zachowana historia pochodzenia i publikacji źródłowych",
  verificationStatus: "Status nadawany w procesie weryfikacji AED Puls",
  recordVerificationStatus: "Niezależny status weryfikacji opisu",
  operationalStatus: "Stan urządzenia; import nie potwierdza sprawności",
  verifiedAt: "Data udokumentowanej weryfikacji urządzenia, jeśli dostępna",
  sourceConflict: "Wykryte rozbieżności pomiędzy publikacjami",
  createdAt: "Czas utworzenia rekordu w AED Puls",
  updatedAt: "Czas aktualizacji rekordu w AED Puls",
  sourceCategory: "Kategoria pochodzenia na podstawie dostępnych dowodów; nie gwarancja wiarygodności",
};
const arrays = new Set(["fieldProvenance", "qualityIssues", "providerIds", "providers", "licenses", "sources"]);
const meaningful = (value: unknown) => value != null && value !== "" && value !== "unknown" && value !== "UNKNOWN"
  && (!Array.isArray(value) || value.length > 0);

/** Read-only presentation. Does not run exports, licensing reviews or synchronization. */
export function registerDataCatalogue(app: FastifyInstance) {
  app.get("/api/data-catalogue", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    const [context, formats] = await Promise.all([
      exportContext("public", undefined, false),
      db.select({ id: observations.id, format: observations.resourceFormat }).from(observations),
    ]);
    const formatById = new Map(formats.map(r => [r.id, r.format]));
    const sourceById = new Map(context.sourceRows.map(s => [s.id, s]));
    const groups = new Map<string, {
      id: string; publisher: string; title: string; aggregation: boolean; url: string | null;
      formats: Set<string>; licenses: Set<string>; statuses: Set<string>; updatedAt: string | null;
      records: Map<string, number | null>;
    }>();
    const present = new Map<string, number>();
    for (const row of context.rows) {
      const ref = row.ref, source = ref?.sourceId ? sourceById.get(ref.sourceId) : undefined;
      const data = ref?.normalizedRecord ?? row.original;
      const evidence = ref?.provenanceEvidence;
      const officialId = ["official_api_dataset_resource_institution", "municipal_metadata_official_catalogue_cross_reference"]
        .includes(String(evidence?.method))
        ? String(evidence?.datasetApiUrl ?? "").match(/^https:\/\/api\.dane\.gov\.pl\/1\.4\/datasets\/(\d+)(?:[/?#]|$)/)?.[1] : undefined;
      const datasetId = ref?.datasetId && !["discovery", "unknown", "UNKNOWN"].includes(ref.datasetId) ? ref.datasetId : null;
      const provider = source?.id ?? row.original.organizationId ?? "aed-puls";
      const aggregation = !datasetId;
      const id = officialId ? `gov:${officialId}` : source?.key?.startsWith("dane-gov") && datasetId ? `gov:${datasetId}`
        : datasetId ? JSON.stringify([ref?.publisher ?? source?.institution, ref?.datasetUrl ?? provider, datasetId]) : `provider:${provider}`;
      const group = groups.get(id) ?? {
        id, publisher: ref?.publisher || source?.institution || row.original.responsibleOrganization || row.original.sourceName || "Nie ustalono",
        title: ref?.datasetTitle || source?.name || row.original.sourceName || "Dane zgłoszone przez aplikację",
        aggregation, url: ref?.datasetUrl || source?.datasetUrl || null,
        formats: new Set<string>(), licenses: new Set<string>(), statuses: new Set<string>(), updatedAt: null,
        records: new Map<string, number | null>(),
      };
      const format = ref ? formatById.get(ref.id) : null;
      if (format) group.formats.add(format.toUpperCase());
      group.licenses.add(ref?.license || row.original.license || "UNKNOWN");
      group.statuses.add(source?.status ?? row.canonical.verificationStatus);
      // Keep source modification time distinct from retrieval time.
      const modified = source ? ref?.sourceModifiedAt ?? source.lastUpdatedAt : row.original.updatedAt;
      if (modified && (!group.updatedAt || modified.toISOString() > group.updatedAt)) group.updatedAt = modified.toISOString();
      const quality = (data as Record<string, unknown>).qualityScore;
      group.records.set(row.canonical.id, typeof quality === "number" ? quality : null);
      groups.set(id, group);
      if (ref?.normalizedRecord) for (const field of exportFields) {
        if (meaningful(ref.normalizedRecord[field])) present.set(field, (present.get(field) ?? 0) + 1);
      }
    }
    return {
      version: exportSchemaVersion, updatedAt: new Date().toISOString(),
      datasets: [...groups.values()].map(({ records, formats, licenses, statuses, ...group }) => {
        const scores = [...records.values()].filter((v): v is number => v !== null);
        return { ...group, formats: [...formats].sort(), licenses: [...licenses].sort(), statuses: [...statuses].sort(),
          aedCount: records.size, averageQuality: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null };
      }).sort((a, b) => a.publisher.localeCompare(b.publisher, "pl")),
      fields: exportFields.map(name => {
        const standard = dataStandard.find(row => row[0] === name);
        return { name, description: standard?.[1] ?? calculated[name] ?? "Pole istniejącego standardu AED Puls",
          type: standard?.[2] ?? (arrays.has(name) ? "tablica JSON" : name === "sourceConflict" ? "boolean"
            : ["latitude", "longitude", "qualityScore"].includes(name) ? "liczba" : name.endsWith("At") ? "data i czas" : "tekst"),
          sourcePresence: present.has(name) ? `Obecne po normalizacji: ${present.get(name)!.toLocaleString("pl-PL")} publikacji` : "Nie ustalono",
          enrichment: calculated[name] ?? (name === "latitude" || name === "longitude" || name === "address"
            ? "Zachowywane ze źródła; lokalizacja może być uzupełniona udokumentowanym GPS/geokodowaniem"
            : "Zachowywane i normalizowane ze źródła lub uzupełniane przy zatwierdzaniu zgłoszeń") };
      }),
    };
  });
}
