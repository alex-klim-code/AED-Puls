import { buildApp } from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./ingestion/engine";
import { ensureSources, reserveSync, executeSync } from "./ingestion/engine";
import { detectDuplicates } from "./ingestion/engine";
import { refreshAggregation } from "./ingestion/linkage";
import { SOURCE_DEFINITIONS } from "./ingestion/connectors";
import { pool } from "@workspace/db";
import { removeDemoRecords } from "./maintenance/remove-demo";
import { startGeocodingScheduler } from "./geocoding/worker";
import { recoverIncompleteRecords } from "./ingestion/recover-incomplete";
import { startLicenseEvidenceScheduler } from "./ingestion/license-evidence";
import { repairNormalizedPublications } from "./ingestion/repair-normalized";
import { reconcileSourceStatuses } from "./ingestion/reconcile-source-status";
import { executeAppendImport } from "./ingestion/append-import";

if (process.argv[2] === "import-aed") {
  const datasetId = process.argv[3];
  if (datasetId && !/^\d+$/.test(datasetId)) throw new Error("Nieprawidłowy identyfikator zbioru.");
  await ensureSources();
  const reservation = await reserveSync("dane-gov");
  if (!reservation) throw new Error("Import lub synchronizacja już trwa.");
  const result = await executeAppendImport(reservation, { datasetId });
  logger.info(result, "Wynik dopisującego importu rzeczywistych AED.");
  if (result.status === "failed") process.exitCode = 1;
  await pool.end();
} else if (process.argv[2] === "reconcile-data") {
  await ensureSources();
  await refreshAggregation();
  await detectDuplicates();
  await refreshAggregation();
  logger.info("Przeliczono pochodzenie, scoring i bezpieczne powiązania rzeczywistych AED.");
  await pool.end();
} else if (process.argv[2] === "sync-data") {
  await ensureSources();
  const requested = process.argv[3] ?? "all";
  const keys = SOURCE_DEFINITIONS.filter(s => requested === "all" || s.key === requested).map(s => s.key);
  if (!keys.length) throw new Error(`Źródło: all lub ${SOURCE_DEFINITIONS.map(s=>s.key).join(", ")}.`);
  for (const key of keys) {
    const reservation = await reserveSync(key);
    if (!reservation) logger.info({ sourceKey: key }, "Synchronizacja już trwa.");
    else {
      const result = await executeSync(reservation);
      logger.info(result, "Wynik rzeczywistego importu.");
      if (result.status !== "succeeded") process.exitCode = 1;
    }
  }
  await pool.end();
} else {
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("Nieprawidłowy PORT");
try {
  const removed = await removeDemoRecords();
  if (removed) logger.info({ removed }, "Usunięto wycofane syntetyczne rekordy AED; rzeczywiste dane zachowano.");
  // Data-only reconciliation: managed Publish owns DDL. Serve current counters even before the next scheduled import.
  await ensureSources();
  const statuses=await reconcileSourceStatuses();
  if(statuses.updated)logger.info(statuses,"Oddzielono stan pobrania źródeł od jakości zachowanych rekordów.");
  const recovery=await recoverIncompleteRecords();
  if(recovery.created||recovery.preservedUnprocessable)logger.info(recovery,"Przetworzono zachowane oryginały niekompletnych AED bez ponownego pobierania źródeł.");
  const normalization=await repairNormalizedPublications();
  if(normalization.repaired)logger.info(normalization,"Odtworzono brakujące znormalizowane publikacje z zachowanych oryginałów, bez zmian rekordów AED.");
  await refreshAggregation();
  await detectDuplicates();
  await refreshAggregation();
  const app = await buildApp();
  let stopScheduler = () => {};
  let stopGeocoding = () => {};
  let stopLicenseEvidence = () => {};
  app.addHook("onClose", async () => { stopScheduler();stopGeocoding();stopLicenseEvidence(); });
  await app.listen({ port, host: "0.0.0.0" });
  stopScheduler = startScheduler();
  stopGeocoding = startGeocodingScheduler();
  stopLicenseEvidence = startLicenseEvidenceScheduler();
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, async () => { await app.close(); process.exit(0); });
  }
} catch (err) {
  logger.error({ err }, "Nie można uruchomić API");
  process.exit(1);
}
}
