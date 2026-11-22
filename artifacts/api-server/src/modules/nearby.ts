import type { FastifyInstance } from "fastify";
import { z } from "zod/v4";
import { GetNearbyAedsResponse } from "@workspace/api-zod";

const RADIUS = 5000;
const TTL = 10 * 60 * 1000;
const elementSchema = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number().int().positive(),
  lat: z.number().optional(), lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).default({}),
});
const overpassSchema = z.object({
  remark: z.string().optional(),
  elements: z.array(z.unknown()).max(10000),
});
type Nearby = z.infer<typeof GetNearbyAedsResponse>;
const cache = new Map<string, { until: number; data?: Nearby; failed?: boolean }>();
const pending = new Map<string, Promise<Nearby>>();

export function parseOverpass(raw: unknown): Nearby {
  const result = overpassSchema.parse(raw);
  // Overpass may return HTTP 200 with incomplete data after hitting a resource limit.
  if (result.remark) throw new Error("Niepełna odpowiedź źródła.");
  const items: Nearby["items"] = [];
  for (const input of result.elements) {
    const parsed = elementSchema.safeParse(input);
    if (!parsed.success) continue;
    const e = parsed.data;
    const t = e.tags;
    if (t.emergency !== "defibrillator" || t["disused:emergency"] || t["removed:emergency"]) continue;
    const latitude = e.lat ?? e.center?.lat;
    const longitude = e.lon ?? e.center?.lon;
    if (latitude == null || longitude == null || Math.abs(latitude) > 85 || Math.abs(longitude) > 180) continue;
    const text = (key: string) => (t[key] ?? "").slice(0, 1500);
    items.push({
      id: `osm-${e.type}-${e.id}`,
      name: text("name") || text("operator") || "Defibrylator AED",
      latitude, longitude,
      address: [text("addr:street"), text("addr:housenumber")].filter(Boolean).join(" "),
      city: text("addr:city"),
      location: text("defibrillator:location") || text("description") || text("location"),
      openingHours: text("opening_hours"),
      access: text("access"),
      sourceUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      checkDate: text("check_date:emergency") || text("check_date"),
    });
  }
  return GetNearbyAedsResponse.parse({
    items, fetchedAt: new Date().toISOString(), radiusMeters: RADIUS,
    license: "ODbL-1.0", attribution: "© współtwórcy OpenStreetMap",
  });
}

async function fetchArea(latitude: number, longitude: number): Promise<Nearby> {
  const query = `[out:json][timeout:12];nwr["emergency"="defibrillator"](around:${RADIUS},${latitude},${longitude});out center;`;
  // Regional instance allows small public projects; global instance is a fallback.
  // Outside Poland use global coverage, never interpret a regional extract as worldwide.
  const endpoints = latitude >= 49 && latitude <= 55.2 && longitude >= 14 && longitude <= 24.3
    ? ["https://ovp.dresel.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
    : ["https://overpass.private.coffee/api/interpreter"];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}?${new URLSearchParams({ data: query })}`, {
        headers: { Accept: "application/json", "User-Agent": "AED-Puls/1.0 (public AED map)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) continue;
      const body = await response.text();
      if (body.length > 5_000_000) continue;
      return parseOverpass(JSON.parse(body));
    } catch {
      // A second independent Overpass instance may be available. Never substitute demo data.
    }
  }
  throw Object.assign(new Error("Nie można pobrać danych OpenStreetMap. Spróbuj ponownie za chwilę."), { statusCode: 503 });
}

export async function nearbyAeds(latitude: number, longitude: number): Promise<Nearby> {
  // About 100 m precision: neither exact GPS nor identity is sent to Overpass or persisted.
  const lat = Number(latitude.toFixed(3));
  const lon = Number(longitude.toFixed(3));
  const key = `${lat},${lon}`;
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.until > now) {
    if (existing.data) return existing.data;
    throw Object.assign(new Error("Źródło OpenStreetMap jest chwilowo niedostępne. Spróbuj za minutę."), { statusCode: 503 });
  }
  if (pending.has(key)) return pending.get(key)!;
  if (pending.size >= 2) throw Object.assign(new Error("Trwa wiele wyszukiwań. Spróbuj ponownie za chwilę."), { statusCode: 503 });
  const work = fetchArea(lat, lon).then(data => {
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(key, { until: Date.now() + TTL, data });
    return data;
  }).catch(error => {
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(key, { until: Date.now() + 60000, failed: true });
    throw error;
  }).finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}

export function registerNearby(app: FastifyInstance) {
  app.get("/api/nearby-aeds", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const input = z.object({
      latitude: z.coerce.number().min(-85).max(85),
      longitude: z.coerce.number().min(-180).max(180),
    }).parse(req.query);
    return nearbyAeds(input.latitude, input.longitude);
  });
}
