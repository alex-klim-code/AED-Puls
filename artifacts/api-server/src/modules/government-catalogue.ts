import { eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, governmentInstitutions as institutions, governmentDatasets as datasets,
  governmentResources as resources } from "@workspace/db";
import { downloadJson } from "../ingestion/http";
import { API_ROOT } from "../ingestion/official";
import { cataloguePages, relevantAedTitle } from "../ingestion/government";
import { connectSource, type ConnectorBatch } from "../ingestion/connectors";
import { reserveSync, ensureSources } from "../ingestion/engine";
import { executeAppendImport } from "../ingestion/append-import";
import { logger } from "../lib/logger";
import { fail } from "./auth";

const network = { attempts: 1, timeoutMs: 12000 };
const plain = (v: unknown) => String(v ?? "").replace(/<[^>]*>/g, "").trim();
const metadata = (v: unknown) => JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
export const institutionDto = (row: typeof institutions.$inferSelect) => ({
  id: row.id, name: row.name, sourceUrl: row.sourceUrl, metadata: row.metadata,
  organizationId: row.organizationId, importStatus: row.importStatus,
  importMessage: row.importMessage, importedCount: row.importedCount,
});
async function saveInstitution(value: any) {
  if (!/^\d+$/.test(String(value?.id)) || value.type !== "institution" || !plain(value.attributes?.title))
    throw new Error("Nieprawidłowa instytucja w odpowiedzi dane.gov.pl.");
  await db.insert(institutions).values({ id: String(value.id), name: plain(value.attributes.title),
    sourceUrl: `https://dane.gov.pl/pl/institution/${value.id}`, metadata: metadata(value) }).onConflictDoNothing();
}
export async function searchInstitutions(q: string) {
  const escaped = q.replace(/[\\%_]/g, "\\$&");
  const local = await db.select().from(institutions).where(or(
    ilike(institutions.name, `%${escaped}%`),
    sql`${institutions.metadata}->'attributes'->>'city' ilike ${`%${escaped}%`}`,
  )).orderBy(institutions.name).limit(30);
  if (local.length) return local.map(institutionDto);
  const url = new URL(`${API_ROOT}/institutions`);
  url.searchParams.set("q", q); url.searchParams.set("per_page", "30");
  const result = await downloadJson(url.href, network);
  if (!Array.isArray(result.data)) throw new Error("Nieprawidłowa odpowiedź katalogu instytucji.");
  for (const value of result.data) await saveInstitution(value);
  const ids = result.data.map((value: any) => String(value.id));
  return ids.length ? (await db.select().from(institutions).where(inArray(institutions.id, ids))).map(institutionDto) : [];
}
export async function getInstitution(id: string) {
  const [row] = await db.select().from(institutions).where(eq(institutions.id, id));
  if (!row) fail(404, "Wyszukaj i wybierz instytucję z dane.gov.pl.");
  return row;
}

// A small, explicit background queue, not a catalogue-wide scheduled synchronization.
const active = new Set<string>();
export async function queueInstitutionImport(id: string, userId: string) {
  const row = await getInstitution(id);
  if (row.importStatus === "COMPLETED" || active.has(id)) return institutionDto(row);
  await db.update(institutions).set({ importStatus: "QUEUED", importMessage: "Import oczekuje na wolny importer." }).where(eq(institutions.id, id));
  active.add(id);
  const run = () => void importInstitution(id, userId).then(finished => {
    if (!finished) { const timer = setTimeout(run, 15000); timer.unref(); }
    else active.delete(id);
  }).catch(async () => {
    active.delete(id);
    await db.update(institutions).set({ importStatus: "FAILED", importMessage: "Import nie powiódł się. Spróbuj ponownie; zapisane dane zachowano." }).where(eq(institutions.id, id));
    logger.warn({ institutionId: id }, "Nie ukończono importu instytucji dane.gov.pl.");
  });
  setImmediate(run);
  return institutionDto(await getInstitution(id));
}
async function importInstitution(id: string, userId: string) {
  await ensureSources();
  const reservation = await reserveSync("dane-gov", userId);
  if (!reservation) return false;
  await db.update(institutions).set({ importStatus: "RUNNING", jobId: reservation.job.id,
    importMessage: "Pobieranie instytucji, zbiorów, zasobów i rekordów AED." }).where(eq(institutions.id, id));
  const connector: typeof connectSource = async function* () {
    const body = await downloadJson(`${API_ROOT}/institutions/${id}`, network);
    if (String(body.data?.id) !== id) throw new Error("Nie potwierdzono instytucji.");
    await saveInstitution(body.data);
    for await (const page of cataloguePages(`${API_ROOT}/institutions/${id}/datasets`, network)) {
      for (const dataset of page) {
        const datasetId = String(dataset.id);
        if (!/^\d+$/.test(datasetId) || String(dataset.relationships?.institution?.data?.id ?? id) !== id) continue;
        try {
        await db.insert(datasets).values({ id: datasetId, institutionId: id, name: plain(dataset.attributes?.title),
          sourceUrl: `https://dane.gov.pl/pl/dataset/${datasetId}`, metadata: metadata(dataset) }).onConflictDoNothing();
        let hasAed = relevantAedTitle(dataset);
        for await (const entries of cataloguePages(`${API_ROOT}/datasets/${datasetId}/resources`, network)) {
          for (const resource of entries) {
            if (!/^\d+$/.test(String(resource.id))) continue;
            await db.insert(resources).values({ id: String(resource.id), datasetId, name: plain(resource.attributes?.title),
              sourceUrl: `https://dane.gov.pl/pl/dataset/${datasetId}/resource/${resource.id}`,
              format: plain(resource.attributes?.format), metadata: metadata(resource) }).onConflictDoNothing();
            hasAed ||= relevantAedTitle(resource);
          }
        }
        if (!hasAed) continue;
        for await (const packet of connectSource("dane-gov", { datasetId })) {
          if (packet.rows.length && packet.context.publisherId !== id) throw new Error("Wydawca zasobu nie odpowiada wybranej instytucji.");
          yield packet as ConnectorBatch;
        }
        } catch (error) {
          yield { context: { name: "dane.gov.pl", publisher: plain(body.data.attributes?.title), publisherId: id,
            datasetId, datasetUrl: `https://dane.gov.pl/pl/dataset/${datasetId}`, datasetTitle: plain(dataset.attributes?.title),
            resourceId: "discovery", url: `${API_ROOT}/datasets/${datasetId}`, coverage: "Polska", license: "UNKNOWN", modified: null },
            rows: [], issue: { severity: "error", rule: "institution_dataset_failed",
              message: `Nie ukończono zbioru ${datasetId}: ${error instanceof Error ? error.message.slice(0, 200) : "błąd pobierania"}` } };
        }
      }
    }
  };
  const result = await executeAppendImport(reservation, { connector, allowEmpty: true });
  const empty = result.processed === 0 && result.resourceErrors === 0 && result.errors === 0 && result.unsupportedResources === 0;
  await db.update(institutions).set({
    importStatus: result.status === "succeeded" ? "COMPLETED" : result.status === "partial" ? "PARTIAL" : "FAILED",
    importedCount: (await getInstitution(id)).importedCount + result.imported,
    importMessage: `Nowe AED: ${result.imported}; istniejące pominięte: ${result.skipped}; błędy: ${result.errors + result.resourceErrors}; nieobsługiwane zasoby: ${result.unsupportedResources}.${empty ? " Brak zasobów zawierających AED." : ""}`,
  }).where(eq(institutions.id, id));
  return true;
}
