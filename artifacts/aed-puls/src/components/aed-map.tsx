import { useEffect, useRef } from 'react';
import * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import type { Aed } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import type { UserPosition } from '@/hooks/use-geolocation';
import type { Coordinates } from '@/lib/geo';
import { hasCoordinates } from '@/lib/geo';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyL = any;
const L: AnyL = (Leaflet as unknown as { default?: AnyL }).default ?? Leaflet;
(window as unknown as { L: AnyL }).L = L;
let clusterReady: Promise<unknown> | null = null;
const loadCluster = () => (clusterReady ??= import('leaflet.markercluster'));

const POLAND: [number, number] = [52.07, 19.48];
const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; współtwórcy <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Geokodowanie: <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a>';

type MapPoint = Pick<Aed, 'id' | 'name' | 'city' | 'latitude' | 'longitude' | 'isDemo'> & { verificationStatus: string };

function pinColor(a: MapPoint) {
  if (a.isDemo) return '#64748B';
  if (['unconfirmed','unverified','NOT_VERIFIED'].includes(a.verificationStatus)) return '#2563EB';
  if (['verified','VERIFIED'].includes(a.verificationStatus)) return '#16A34A';
  if (['rejected','REJECTED'].includes(a.verificationStatus)) return '#0F172A';
  return '#B45309';
}

export function AedMap({
  aeds,
  selectedId,
  onSelect,
  className,
  label = 'Mapa defibrylatorów AED',
  userPosition,
  onCenterChange,
  preserveView = false,
}: {
  aeds: MapPoint[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  label?: string;
  userPosition?: UserPosition | null;
  onCenterChange?: (center: Coordinates) => void;
  preserveView?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<AnyL>(null);
  const group = useRef<AnyL>(null);
  const markers = useRef<Map<string, AnyL>>(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCenterRef = useRef(onCenterChange);
  onCenterRef.current = onCenterChange;
  const positionRef = useRef(userPosition);
  positionRef.current = userPosition;
  const preserveRef = useRef(preserveView);
  preserveRef.current = preserveView;
  const userLayer = useRef<AnyL>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: POLAND, zoom: 6, scrollWheelZoom: true });
    L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(m);
    map.current = m;
    let cancelled = false;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => { if (!cancelled && map.current === m) m.invalidateSize(); };
    const resize = new ResizeObserver(invalidate);
    resize.observe(el.current);
    m.on('moveend', () => {
      const c = m.getCenter();
      onCenterRef.current?.({ latitude: c.lat, longitude: c.lng });
    });
    loadCluster().then(() => {
      if (cancelled) return;
      group.current = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 48, animate:false });
      m.addLayer(group.current);
      resizeTimer = setTimeout(invalidate, 0);
      m.fire('aedready');
    });
    return () => {
      cancelled = true;
      clearTimeout(resizeTimer);
      resize.disconnect();
      m.remove();
      map.current = null;
      group.current = null;
      userLayer.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const draw = () => {
      const located=aeds.filter(hasCoordinates);
      const g = group.current;
      if (!g) return;
      g.clearLayers();
      markers.current.clear();
      located.forEach((a) => {
        const icon = L.divIcon({
          className: '',
          html: `<div class="aed-pin" style="background:${pinColor(a)}"><span>AED</span></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 30],
        });
        const mk = L.marker([a.latitude, a.longitude], {
          icon,
          title: `${a.name}, ${a.city}${a.isDemo ? ' (demo)' : ''}`,
          alt: a.name,
          keyboard: true,
        });
        mk.on('click', () => onSelectRef.current?.(a.id));
        markers.current.set(a.id, mk);
        g.addLayer(mk);
      });
      if (positionRef.current || preserveRef.current) {
        // Preserve the user's view when records refresh, instead of fitting every AED.
      } else if (located.length) {
        const b = L.latLngBounds(located.map((a) => [a.latitude, a.longitude]));
        m.fitBounds(b, { padding: [40, 40], maxZoom: 14 });
      } else m.setView(POLAND, 6);
    };
    if (group.current) draw();
    else m.once('aedready', draw);
    return () => { m.off('aedready', draw); };
  }, [aeds]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (userLayer.current) m.removeLayer(userLayer.current);
    if (!userPosition) return;
    const p: [number, number] = [userPosition.latitude, userPosition.longitude];
    const accuracy = L.circle(p, { radius: userPosition.accuracy, color: '#2563EB', weight: 1, fillOpacity: 0.08 });
    const dot = L.circleMarker(p, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563EB', fillOpacity: 1 });
    dot.bindTooltip('Twoja przybliżona pozycja');
    userLayer.current = L.layerGroup([accuracy, dot]).addTo(m);
    m.setView(p, 14);
  }, [userPosition]);

  useEffect(() => {
    markers.current.forEach((mk, id) => {
      const node = mk.getElement?.()?.querySelector('.aed-pin');
      node?.classList.toggle('selected', id === selectedId);
    });
    const m=map.current;
    if (!selectedId || !m) return;
    const reveal=()=>{
      const g=group.current,mk=markers.current.get(selectedId);
      if(!g||!mk||!g.hasLayer(mk))return;
      // zoomToShowLayer keeps internal listeners for markers that clearLayers removes.
      // Reveal synchronously so refreshing results cannot leave a stale __parent callback.
      if(!mk.getElement?.()||!m.getBounds().contains(mk.getLatLng())){
        m.setView(mk.getLatLng(),Math.max(m.getZoom(),18),{animate:false});
        const parent=g.getVisibleParent(mk);
        if(parent&&parent!==mk)parent.spiderfy?.();
      }
      mk.getElement?.()?.querySelector('.aed-pin')?.classList.add('selected');
    };
    if(group.current)reveal();else m.once('aedready',reveal);
    return ()=>{m.off('aedready',reveal);};
  }, [selectedId, aeds]);

  return <div ref={el} role="region" aria-label={label} className={cn('z-0 h-full w-full bg-muted', className)} data-testid="map-aed" />;
}

export function LocationPicker({
  lat,
  lng,
  onPick,
  className,
}: {
  lat?: number;
  lng?: number;
  onPick: (lat: number, lng: number) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<AnyL>(null);
  const marker = useRef<AnyL>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: POLAND, zoom: 6 });
    L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(m);
    m.on('click', (e: AnyL) => onPickRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return;
    const icon = L.divIcon({ className: '', html: '<div class="aed-pin" style="background:#DC2626"><span>AED</span></div>', iconSize: [30, 30], iconAnchor: [15, 30] });
    if (!marker.current) marker.current = L.marker([lat, lng], { icon }).addTo(m);
    else marker.current.setLatLng([lat, lng]);
  }, [lat, lng]);

  return <div ref={el} role="application" aria-label="Kliknij mapę, aby ustawić współrzędne. Możesz też wpisać je ręcznie." className={cn('z-0 h-72 w-full rounded-xl border bg-muted', className)} data-testid="map-picker" />;
}
