import { useEffect, useRef } from 'react';
import * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { RedMapAnalysis } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyL = any;
const L: AnyL = (Leaflet as unknown as { default?: AnyL }).default ?? Leaflet;

const POLAND: [number, number] = [52.07, 19.48];
const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; współtwórcy <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Izolinie: <a href="https://www.geoapify.com/">Geoapify</a>';

export type Centre = { latitude: number; longitude: number };

/** Kwadrat o boku sizeKm wokół środka, w stopniach (przybliżenie lokalne). */
export function squareBounds(c: Centre, sizeKm: number): [[number, number], [number, number]] {
  const half = sizeKm / 2;
  const dLat = half / 111.32;
  const dLng = half / (111.32 * Math.cos((c.latitude * Math.PI) / 180));
  return [[c.latitude - dLat, c.longitude - dLng], [c.latitude + dLat, c.longitude + dLng]];
}

function textEl(text: string) {
  const s = document.createElement('span');
  s.textContent = text;
  return s;
}

export function RedCoverageMap({
  centre,
  sizeKm,
  result,
  showPreview = true,
  onCentreChange,
  className,
}: {
  centre: Centre | null;
  sizeKm: number;
  result: RedMapAnalysis | null;
  showPreview?: boolean;
  onCentreChange?: (c: Centre) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<AnyL>(null);
  const preview = useRef<AnyL>(null);
  const overlay = useRef<AnyL>(null);
  const cbRef = useRef(onCentreChange);
  cbRef.current = onCentreChange;
  const lastEmitted = useRef<Centre | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: POLAND, zoom: 6, scrollWheelZoom: true });
    L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(m);
    map.current = m;
    const emit = (lat: number, lng: number) => {
      const c = { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) };
      lastEmitted.current = c;
      cbRef.current?.(c);
    };
    m.on('moveend', () => { const c = m.getCenter(); emit(c.lat, c.lng); });
    m.on('click', (e: AnyL) => { m.panTo(e.latlng); });
    const ro = new ResizeObserver(() => { if (map.current === m) m.invalidateSize(); });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      preview.current = null;
      overlay.current = null;
    };
  }, []);

  // Zewnętrzna zmiana środka (np. wpisane współrzędne) — przesuwamy widok tylko gdy różni się od ostatnio zgłoszonego.
  useEffect(() => {
    const m = map.current;
    if (!m || !centre) return;
    const l = lastEmitted.current;
    if (l && Math.abs(l.latitude - centre.latitude) < 1e-6 && Math.abs(l.longitude - centre.longitude) < 1e-6) return;
    lastEmitted.current = centre;
    m.setView([centre.latitude, centre.longitude], Math.max(m.getZoom(), 13));
  }, [centre]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (preview.current) { m.removeLayer(preview.current); preview.current = null; }
    if (!centre || !showPreview) return;
    preview.current = L.rectangle(squareBounds(centre, sizeKm), { color: '#0F172A', weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(m);
  }, [centre, sizeKm, showPreview]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (overlay.current) { m.removeLayer(overlay.current); overlay.current = null; }
    if (!result) return;
    const g = L.layerGroup();
    const poly = (coords: number[][][][], style: AnyL) => {
      if (coords.length) L.geoJSON({ type: 'MultiPolygon', coordinates: coords }, { style: () => style, interactive: false }).addTo(g);
    };
    poly(result.covered.coordinates, { color: '#15803D', weight: 0, fillColor: '#16A34A', fillOpacity: 0.28 });
    poly(result.unknown.coordinates, { color: '#475569', weight: 0, fillColor: '#64748B', fillOpacity: 0.4 });
    poly(result.uncovered.coordinates, { color: '#B91C1C', weight: 0, fillColor: '#DC2626', fillOpacity: 0.42 });
    poly(result.area.coordinates, { color: '#0F172A', weight: 2.5, fill: false });
    result.aeds.forEach((a) => {
      L.circleMarker([a.latitude, a.longitude], { radius: 6, color: '#fff', weight: 2, fillColor: '#0F172A', fillOpacity: 1 })
        .bindTooltip(textEl(a.name || 'AED'))
        .addTo(g);
    });
    overlay.current = g.addTo(m);
    const area = L.geoJSON({ type: 'MultiPolygon', coordinates: result.area.coordinates });
    const b = area.getBounds();
    if (b.isValid()) m.fitBounds(b, { padding: [24, 24] });
  }, [result]);

  return (
    <div
      ref={el}
      role="application"
      aria-label="Mapa wyboru obszaru analizy. Przesuń mapę lub kliknij, aby ustawić środek. Współrzędne możesz też wpisać w formularzu."
      className={cn('z-0 h-full w-full bg-muted', className)}
      data-testid="map-red-coverage"
    />
  );
}
