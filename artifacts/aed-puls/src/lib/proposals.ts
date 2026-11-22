import type { QueryClient } from '@tanstack/react-query';
import {
  getGetStatsQueryKey, getGetWorkspaceQueryKey, getListAdminRecordsQueryKey, getListAedProposalsQueryKey,
  getListAedsQueryKey, getListConflictReportsQueryKey, getListMapPointsQueryKey,
  type AedProposalInput,
} from '@workspace/api-client-react';

export const LICENSES = [
  { value: 'CC0-1.0', label: 'CC0 1.0', text: 'Domena publiczna. Każdy może używać danych bez obowiązku podawania źródła.' },
  { value: 'CC-BY-4.0', label: 'CC BY 4.0', text: 'Dane otwarte. Ponowne użycie wymaga podania źródła (uznania autorstwa).' },
  { value: 'ODbL-1.0', label: 'ODbL 1.0', text: 'Otwarta baza danych. Wymaga uznania autorstwa, a bazy pochodne muszą być udostępniane na tych samych warunkach.' },
  { value: 'UNKNOWN', label: 'Nie wiem / później', text: 'Rekord nie zostanie opublikowany, dopóki licencja nie zostanie wyjaśniona z administratorem.' },
] as const;
export const KNOWN_LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'ODbL-1.0'];
export const licenseLabel = (v?: string) => LICENSES.find((l) => l.value === v)?.label ?? (v || 'Nieustalona');

/** Statusy zgłoszeń AED i błędów (nie dotyczą kanonicznych statusów AED). */
export const proposalStatus: Record<string, { label: string; cls: string }> = {
  NEW: { label: 'Nowe', cls: 'bg-muted text-foreground' },
  UNCOMPLETED: { label: 'Do uzupełnienia', cls: 'bg-[hsl(var(--warn)/0.12)] text-warn' },
  DONE: { label: 'Zakończone', cls: 'bg-[hsl(var(--verified)/0.12)] text-verified' },
  REJECTED: { label: 'Odrzucone', cls: 'bg-accent text-accent-foreground' },
};
export const statusLabelFor = (status: string, kind: 'AED' | 'ERROR' = 'AED') =>
  status === 'DONE' ? (kind === 'AED' ? 'Zatwierdzone' : 'Poprawione') : proposalStatus[status]?.label ?? status;
export const isClosedStatus = (s: string) => s === 'DONE' || s === 'REJECTED';
export function formatStamp(v?: string | null) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}
export const photoSrc = (id: string) => `/api/submission-photos/${encodeURIComponent(id)}`;
export const methodLabel: Record<string, string> = { MANUAL: 'Ręcznie', GPS: 'GPS', FILE: 'Plik' };
export const roleLabel: Record<string, string> = { USER: 'Użytkownik', PROVIDER: 'Organizacja', ADMIN: 'Administrator' };

export type Draft = {
  name: string; address: string; city: string; postalCode: string; voivodeship: string;
  latitude: string; longitude: string; description: string; placement: string; accessibility: string;
  openingHours: string; sourceUrl: string; license: string;
};
export const emptyDraft: Draft = {
  name: '', address: '', city: '', postalCode: '', voivodeship: '', latitude: '', longitude: '', description: '',
  placement: 'unknown', accessibility: 'unknown', openingHours: '', sourceUrl: '', license: 'UNKNOWN',
};
export function draftFrom(p: AedProposalInput): Draft {
  return {
    name: p.name ?? '', address: p.address ?? '', city: p.city ?? '', postalCode: p.postalCode ?? '',
    voivodeship: p.voivodeship ?? '', latitude: p.latitude == null ? '' : String(p.latitude),
    longitude: p.longitude == null ? '' : String(p.longitude), description: p.description ?? '',
    placement: p.placement ?? 'unknown', accessibility: p.accessibility ?? 'unknown',
    openingHours: p.openingHours ?? '', sourceUrl: p.sourceUrl ?? '', license: p.license || 'UNKNOWN',
  };
}
export function coord(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
export function draftProblems(d: Draft, forApproval: boolean): string[] {
  const out: string[] = [];
  const lat = coord(d.latitude), lng = coord(d.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) out.push('Współrzędne muszą być liczbami (np. 52.2297).');
  if (d.postalCode && !/^\d{2}-\d{3}$/.test(d.postalCode.trim())) out.push('Kod pocztowy ma format 00-000.');
  if (d.sourceUrl && !/^https?:\/\//.test(d.sourceUrl.trim())) out.push('Adres źródła musi zaczynać się od http(s)://.');
  if (forApproval) {
    if (d.name.trim().length < 3) out.push('Brak nazwy miejsca.');
    if (d.address.trim().length < 3) out.push('Brak adresu.');
    if (d.city.trim().length < 2) out.push('Brak miejscowości.');
    if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng) || lat < 49 || lat > 55 || lng < 14 || lng > 24.2)
      out.push('Potrzebne współrzędne w granicach Polski.');
    if (!KNOWN_LICENSES.includes(d.license)) out.push('Potrzebna znana otwarta licencja.');
  }
  return out;
}
export function draftToInput(d: Draft, extra: Partial<AedProposalInput> & { sourceName: string }): AedProposalInput {
  const opt = (s: string) => s.trim() || undefined;
  const lat = coord(d.latitude), lng = coord(d.longitude);
  return {
    name: d.name.trim(), address: d.address.trim(), city: d.city.trim(), postalCode: opt(d.postalCode), voivodeship: opt(d.voivodeship),
    latitude: lat == null || Number.isNaN(lat) ? null : lat, longitude: lng == null || Number.isNaN(lng) ? null : lng,
    description: opt(d.description), placement: d.placement as AedProposalInput['placement'],
    accessibility: d.accessibility as AedProposalInput['accessibility'],
    openingHours: d.accessibility === '24/7' ? '24/7' : opt(d.openingHours),
    sourceUrl: d.sourceUrl.trim(), license: d.license, ...extra,
  };
}

export const isStale = (e: unknown) => (e as { status?: number } | null)?.status === 409;

export function invalidateRegistry(qc: QueryClient) {
  for (const queryKey of [getListAedProposalsQueryKey(), getListConflictReportsQueryKey(), getGetWorkspaceQueryKey(),
    getListMapPointsQueryKey(), getGetStatsQueryKey(), getListAedsQueryKey(), getListAdminRecordsQueryKey(), ['/api/aed-proposals']])
    qc.invalidateQueries({ queryKey });
}
