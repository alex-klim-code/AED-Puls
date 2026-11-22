import clipping, { type MultiPolygon, type Pair } from "polygon-clipping";
import { z } from "zod/v4";

export const seconds = 1800;
export type AreaInput = { latitude: number; longitude: number; sizeKm: number };
export type CoveragePoint = { id: string; name: string; latitude: number; longitude: number };
export const geometry = (coordinates: MultiPolygon) => ({ type: "MultiPolygon" as const, coordinates });

export function areaBounds(input: AreaInput) {
  const dy = input.sizeKm / 2 / 111.32;
  const dx = input.sizeKm / 2 / (111.32 * Math.cos(input.latitude * Math.PI / 180));
  return { west: input.longitude - dx, south: input.latitude - dy, east: input.longitude + dx, north: input.latitude + dy };
}
export function areaPolygon(input: AreaInput): MultiPolygon {
  const b = areaBounds(input);
  return [[[[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]]]];
}
const pair = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const ring = z.array(pair).min(4).max(30000).refine(r => r[0]![0] === r.at(-1)![0] && r[0]![1] === r.at(-1)![1]);
const polygon = z.array(ring).min(1).max(1000);
const providerGeometry = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: polygon }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygon).min(1).max(1000) }),
]);
export function readIsoline(document: unknown): MultiPolygon {
  const result = z.object({ type: z.literal("FeatureCollection"), features: z.array(z.object({
    properties: z.object({ mode: z.literal("walk"), range: z.literal(seconds), type: z.literal("time") }),
    geometry: providerGeometry,
  })).length(1) }).parse(document);
  const shape = result.features[0]!.geometry;
  return shape.type === "Polygon" ? [shape.coordinates as Pair[][]] : shape.coordinates as MultiPolygon;
}

/** Only a fully evaluated remainder may be labelled as uncovered. */
export async function calculateCoverage(area: MultiPolygon, points: CoveragePoint[],
  getIsoline: (point: CoveragePoint) => Promise<MultiPolygon | null>) {
  let remaining = area, analysedCount = 0, unresolved = 0;
  for (const point of points) {
    if (!remaining.length) break; // Full coverage is already proven; further requests add no information.
    const isoline = await getIsoline(point);
    if (!isoline) { unresolved++; continue; }
    try {
      remaining = clipping.difference(remaining, isoline);
      analysedCount++;
    } catch { unresolved++; }
  }
  const complete = remaining.length === 0 || unresolved === 0;
  return { complete, analysedCount, area: geometry(area), covered: geometry(clipping.difference(area, remaining)),
    uncovered: geometry(complete ? remaining : []), unknown: geometry(complete ? [] : remaining) };
}
