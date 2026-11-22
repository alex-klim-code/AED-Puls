import { sql } from "drizzle-orm";
import { db, auditLogs } from "@workspace/db";
import type { MultiPolygon } from "polygon-clipping";
import { readIsoline, seconds, type CoveragePoint } from "./geometry";

export const maxNewRequests = 16;
const dailyLimit = 120;
const cache = new Map<string, { expires: number; polygon: MultiPolygon | null }>();
const keyFor = (point: CoveragePoint) => `walk-no-ferries-1800:${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
const action = "red_map_geoapify_request";

export async function dailyRemaining() {
  const result = await db.execute<{ used: number }>(sql`select count(*)::int as used from audit_logs
    where action=${action} and created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`);
  return Math.max(0, dailyLimit - Number(result.rows[0]?.used ?? 0));
}
async function reserveRequest(userId: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(7349274)`);
    const result = await tx.execute<{ used: number }>(sql`select count(*)::int as used from audit_logs
      where action=${action} and created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`);
    if (Number(result.rows[0]?.used ?? 0) >= dailyLimit) return false;
    await tx.insert(auditLogs).values({ userId, action, details: { mode: "walk", seconds, maximumEstimatedCredits: 6 } });
    return true;
  });
}

export function createIsolineLoader(userId: string) {
  let newRequests = 0, budgetReached = false;
  const deadline = Date.now() + 25000;
  const warnings = new Set<string>();
  const load = async (point: CoveragePoint): Promise<MultiPolygon | null> => {
    const key = keyFor(point), cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      if (!cached.polygon) warnings.add("Nie udało się obliczyć części tras. Błędy nie są oznaczane jako brak AED.");
      return cached.polygon;
    }
    if (Date.now() >= deadline) {
      warnings.add("Osiągnięto czas pojedynczej analizy. Ponowne uruchomienie wykorzysta zapisane wyniki, a nierozstrzygnięte fragmenty pozostają szare.");
      return null;
    }
    if (newRequests >= maxNewRequests || budgetReached) {
      warnings.add("Osiągnięto limit nowych obliczeń. Szare fragmenty pozostają nierozstrzygnięte; zmniejsz obszar lub spróbuj ponownie.");
      return null;
    }
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) return null;
    let polygon: MultiPolygon | null = null;
    try {
      const url = new URL("https://api.geoapify.com/v1/isoline");
      url.search = new URLSearchParams({ lat: String(point.latitude), lon: String(point.longitude),
        type: "time", mode: "walk", range: String(seconds), avoid: "ferries", apiKey }).toString();
      for (let poll = 0; poll < 3; poll++) {
        if (newRequests >= maxNewRequests || !(await reserveRequest(userId))) {
          budgetReached = true; warnings.add("Osiągnięto limit zapytań do usługi tras. Niepełny wynik pozostaje szary."); break;
        }
        newRequests++;
        const response = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(8000, deadline - Date.now()))), redirect: "error" });
        if (![200, 202].includes(response.status)) {
          await response.body?.cancel();
          warnings.add(response.status === 429 ? "Geoapify ograniczyło liczbę zapytań. Spróbuj później."
            : "Usługa tras nie dostarczyła części wyników. Nie oznaczamy tych obszarów jako brak AED.");
          break;
        }
        const body = await response.text();
        if (body.length > 2_000_000) break;
        const document = JSON.parse(body);
        if (response.status === 200) { polygon = readIsoline(document); break; }
        const id = document.properties?.id;
        if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id)) break;
        url.search = new URLSearchParams({ id, apiKey }).toString();
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch {
      // Never log exceptions or provider URLs: URLs contain the API credential.
    }
    if (!polygon) warnings.add("Część zasięgów jest niedostępna lub oczekuje na obliczenie. Obszar pozostaje nierozstrzygnięty.");
    for (const [entry, value] of cache) if (value.expires <= Date.now()) cache.delete(entry);
    if (cache.size >= 500) cache.delete(cache.keys().next().value!);
    cache.set(key, { polygon, expires: Date.now() + (polygon ? 86400000 : 60000) });
    return polygon;
  };
  return { load, warnings, get newRequests() { return newRequests; } };
}
