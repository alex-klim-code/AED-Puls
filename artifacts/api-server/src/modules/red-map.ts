import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { db, aeds } from "@workspace/db";
import { AnalyseRedMapBody, AnalyseRedMapResponse, GetRedMapStatusResponse } from "@workspace/api-zod";
import { requireUser, fail } from "./auth";
import { publicAed } from "./aeds";
import { areaBounds, areaPolygon, calculateCoverage, seconds } from "../red-map/geometry";
import { createIsolineLoader, dailyRemaining, maxNewRequests } from "../red-map/provider";

let active = false;
export function registerRedMap(app: FastifyInstance) {
  app.get("/api/provider/red-map/status", async req => {
    requireUser(req, ["PROVIDER", "ADMIN"]);
    return GetRedMapStatusResponse.parse({ configured: !!process.env.GEOAPIFY_API_KEY,
      dailyRemaining: await dailyRemaining(), maxNewRequests, seconds });
  });
  app.post("/api/provider/red-map/analysis", { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } }, async req => {
    const user = requireUser(req, ["PROVIDER", "ADMIN"]), input = AnalyseRedMapBody.parse(req.body);
    if (!process.env.GEOAPIFY_API_KEY) fail(503, "Usługa tras pieszych Geoapify nie jest skonfigurowana.");
    if (active) fail(409, "Inna analiza Red Map jest w toku. Spróbuj ponownie po jej zakończeniu.");
    active = true;
    try {
      const bounds = areaBounds(input);
      // A 20 km external margin includes AEDs outside the analysed square. This is not the walking-time model.
      // The actual model below is Geoapify walk, 1800 seconds, with ferries excluded.
      const dy = 20 / 111.32, dx = 20 / (111.32 * Math.cos(input.latitude * Math.PI / 180));
      const points = await db.select({ id: aeds.id, name: aeds.name, latitude: aeds.latitude, longitude: aeds.longitude })
        .from(aeds).where(and(eq(aeds.isDemo, false), publicAed(),
          sql`${aeds.latitude} between ${bounds.south - dy} and ${bounds.north + dy}`,
          sql`${aeds.longitude} between ${bounds.west - dx} and ${bounds.east + dx}`));
      const located = points.filter((p): p is typeof p & { latitude: number; longitude: number } => p.latitude !== null && p.longitude !== null);
      located.sort((a, b) => ((a.latitude - input.latitude) ** 2 + ((a.longitude - input.longitude) * Math.cos(input.latitude * Math.PI / 180)) ** 2)
        - ((b.latitude - input.latitude) ** 2 + ((b.longitude - input.longitude) * Math.cos(input.latitude * Math.PI / 180)) ** 2));
      const loader = createIsolineLoader(user.id);
      const result = await calculateCoverage(areaPolygon(input), located, loader.load);
      return AnalyseRedMapResponse.parse({ ...result, seconds, travelMode: "walk", generatedAt: new Date().toISOString(),
        candidateCount: located.length, aeds: located, newRequests: loader.newRequests,
        message: result.complete ? "Analiza zakończona. Czerwone fragmenty leżą poza obliczonym 30-minutowym zasięgiem pieszym AED z bazy."
          : "Analiza częściowa. Szare fragmenty nie zostały rozstrzygnięte; nie traktuj ich jako braku AED.",
        warnings: [
          "Model planistyczny Geoapify: 30 minut pieszo od AED, bez promów. Czasy i granice są szacunkowe, zależne od sieci dróg i modelu marszu.",
          "Brak pokrycia oznacza brak AED z naszej bazy w tym modelu, nie dowód nieistnienia urządzeń. Rekordy bez lokalizacji nie uczestniczą w analizie.",
          "Uwzględniamy publiczne, również niezweryfikowane AED oraz urządzenia spoza analizowanego kwadratu z buforem 20 km. Nie potwierdzamy sprawności, godzin otwarcia ani dostępu do urządzenia.",
          ...loader.warnings,
        ] });
    } finally { active = false; }
  });
}
