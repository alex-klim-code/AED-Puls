import test from "node:test";
import assert from "node:assert/strict";
import type { MultiPolygon } from "polygon-clipping";
import { areaPolygon, calculateCoverage, readIsoline } from "./geometry";

const square: MultiPolygon = [[[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]];
const left: MultiPolygon = [[[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]]];
const point = { id: "one", name: "Real test fixture", latitude: 1, longitude: 1 };

test("no AED candidates: the analysed square alone is uncovered", async () => {
  const r = await calculateCoverage(square, [], async () => { throw new Error("Must not call provider"); });
  assert.equal(r.complete, true);
  assert.deepEqual(r.uncovered.coordinates, square);
  assert.deepEqual(r.unknown.coordinates, []);
});
test("walking polygon covers half the square; only the remainder is red", async () => {
  const r = await calculateCoverage(square, [point], async () => left);
  assert.equal(r.complete, true);
  assert.equal(r.analysedCount, 1);
  assert.deepEqual(r.uncovered.coordinates, [[[[2, 0], [4, 0], [4, 4], [2, 4], [2, 0]]]]);
});
test("provider failures or request limits produce grey, never red", async () => {
  const r = await calculateCoverage(square, [point, { ...point, id: "two" }], async p => p.id === "one" ? left : null);
  assert.equal(r.complete, false);
  assert.deepEqual(r.uncovered.coordinates, []);
  assert.notDeepEqual(r.unknown.coordinates, []);
  assert.notDeepEqual(r.covered.coordinates, []);
});
test("full coverage stops additional requests and proves there are no red areas", async () => {
  let calls = 0;
  const r = await calculateCoverage(square, [point, { ...point, id: "two" }], async () => { calls++; return square; });
  assert.equal(calls, 1);
  assert.equal(r.complete, true);
  assert.deepEqual(r.uncovered.coordinates, []);
  assert.deepEqual(r.unknown.coordinates, []);
});
test("an earlier provider failure does not invalidate later proven full coverage", async () => {
  const r = await calculateCoverage(square, [point, { ...point, id: "two" }], async p => p.id === "one" ? null : square);
  assert.equal(r.complete, true);
  assert.deepEqual(r.uncovered.coordinates, []);
});
test("the analysis is an accurately sized geographic square, not a fake walking circle", () => {
  const area = areaPolygon({ latitude: 52, longitude: 19, sizeKm: 4 });
  assert.equal(area[0]![0]!.length, 5);
  assert.ok(Math.abs((area[0]![0]![2]![1] - area[0]![0]![0]![1]) * 111.32 - 4) < .001);
});
test("accept only walking-time provider polygons for the exact 1800 second threshold", () => {
  const document = { type: "FeatureCollection", features: [{ properties: { mode: "walk", type: "time", range: 1800 },
    geometry: { type: "Polygon", coordinates: square[0] } }] };
  assert.deepEqual(readIsoline(document), square);
  assert.throws(() => readIsoline({ ...document, features: [{ ...document.features[0], properties: { mode: "drive", type: "time", range: 1800 } }] }));
  assert.throws(() => readIsoline({ type: "FeatureCollection", features: [] }));
});
