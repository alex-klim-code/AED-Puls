import { test } from "node:test";
import assert from "node:assert/strict";
import { nearbyAeds, parseOverpass } from "../src/modules/nearby";
import { distanceMeters, distanceLabel } from "../../aed-puls/src/lib/geo";

const point = { type: "node", id: 123, lat: 52.23, lon: 21.01, tags: { emergency: "defibrillator", name: "Testowy AED", opening_hours: "24/7", access: "yes" } };

test("OSM retains source, coordinates and license without claiming verification", () => {
  const data = parseOverpass({ elements: [point] });
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0]!.latitude, 52.23);
  assert.equal(data.items[0]!.sourceUrl, "https://www.openstreetmap.org/node/123");
  assert.equal(data.license, "ODbL-1.0");
  assert.equal(data.radiusMeters, 5000);
  assert.equal("verificationStatus" in data.items[0]!, false);
  assert.equal(data.items[0]!.checkDate, "");
});

test("invalid, non-AED, disused and removed features are not mapped", () => {
  const data = parseOverpass({ elements: [
    {}, { ...point, tags: {} }, { ...point, lat: 99 },
    { ...point, tags: { emergency: "defibrillator", "disused:emergency": "defibrillator" } },
    { ...point, tags: { emergency: "defibrillator", "removed:emergency": "defibrillator" } },
  ] });
  assert.equal(data.items.length, 0);
});

test("ways and relations use their center; missing fields stay unknown", () => {
  const data = parseOverpass({ elements: [{ type: "way", id: 456, center: { lat: 50.1, lon: 19.2 }, tags: { emergency: "defibrillator" } }] });
  assert.equal(data.items[0]!.latitude, 50.1);
  assert.equal(data.items[0]!.sourceUrl, "https://www.openstreetmap.org/way/456");
  assert.equal(data.items[0]!.openingHours, "");
  assert.equal(data.items[0]!.access, "");
});

test("partial and invalid Overpass responses cannot become empty-success results", () => {
  assert.throws(() => parseOverpass({ remark: "runtime error: timeout", elements: [point] }));
  assert.throws(() => parseOverpass({ error: "service unavailable" }));
});

test("lookup rounds location before contacting source and deduplicates cached requests", async () => {
  const old = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async input => {
    urls.push(String(input));
    return new Response(JSON.stringify({ elements: [point] }), { status: 200 });
  };
  try {
    const [a, b] = await Promise.all([nearbyAeds(52.234567, 21.012345), nearbyAeds(52.234567, 21.012345)]);
    assert.equal(urls.length, 1);
    const query = new URL(urls[0]!).searchParams.get("data")!;
    assert.ok(query.includes("5000,52.235,21.012"));
    assert.ok(!query.includes("52.234567"));
    assert.equal(a.items.length, 1);
    assert.deepEqual(a, b);
    await nearbyAeds(52.234567, 21.012345);
    assert.equal(urls.length, 1);
  } finally { globalThis.fetch = old; }
});

test("upstream failures return 503 and are briefly cached, never replaced by demo", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("Busy", { status: 503 }); };
  try {
    await assert.rejects(nearbyAeds(50.111, 20.222), (e: unknown) => (e as { statusCode: number }).statusCode === 503);
    assert.equal(calls, 2);
    await assert.rejects(nearbyAeds(50.111, 20.222));
    assert.equal(calls, 2);
  } finally { globalThis.fetch = old; }
});

test("outside Poland requests use global coverage, not a regional extract", async () => {
  const old = globalThis.fetch;
  let url = "";
  globalThis.fetch = async input => { url = String(input); return new Response('{"elements":[]}'); };
  try {
    await nearbyAeds(40.712, -74.006);
    assert.equal(new URL(url).hostname, "overpass.private.coffee");
  } finally { globalThis.fetch = old; }
});

test("distance is a straight-line estimate with consistent units", () => {
  const a = { latitude: 52, longitude: 21 };
  const b = { latitude: 52.01, longitude: 21 };
  assert.equal(distanceMeters(a, a), 0);
  assert.ok(distanceMeters(a, b) > 1100 && distanceMeters(a, b) < 1120);
  assert.equal(distanceLabel(850), "850 m");
  assert.equal(distanceLabel(1500), "1.5 km");
});
