import type { Aed } from '@workspace/api-client-react';

export const PAGE_SIZE = 50;
export const SENTINEL = 'UNKNOWN';

/** Legacy sentinel z importów: pokazujemy jako „brak danych”, ale nie podmieniamy go niejawnie. */
export function isMissing(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && (v.trim() === '' || v.trim().toUpperCase() === SENTINEL));
}

export function display(v: unknown): string {
  if (isMissing(v)) return 'brak danych';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

export function hasLocation(a: Pick<Aed, 'latitude' | 'longitude'>) {
  return typeof a.latitude === 'number' && typeof a.longitude === 'number';
}

export type Editorial = 'VERIFIED' | 'NOT_VERIFIED' | 'REJECTED';

/** Normalizuje stare i kanoniczne statusy do VERIFIED / NOT_VERIFIED / REJECTED. */
export function editorialStatus(s: string | undefined): Editorial {
  const v = (s ?? '').toUpperCase();
  if (v === 'VERIFIED') return 'VERIFIED';
  if (v === 'REJECTED') return 'REJECTED';
  return 'NOT_VERIFIED';
}

export const editorialLabel: Record<Editorial, string> = {
  VERIFIED: 'Zweryfikowany',
  NOT_VERIFIED: 'Niezweryfikowany',
  REJECTED: 'Odrzucony',
};

export const fieldLabel: Record<string, string> = {
  name: 'Nazwa',
  address: 'Adres',
  city: 'Miejscowość',
  postalCode: 'Kod pocztowy',
  latitude: 'Szerokość geogr.',
  longitude: 'Długość geogr.',
  description: 'Opis',
  openingHours: 'Godziny dostępu',
  accessibility: 'Dostępność',
  placement: 'Umiejscowienie',
  verificationStatus: 'Status redakcyjny',
  completenessStatus: 'Kompletność',
  recordVerificationStatus: 'Weryfikacja fizyczna',
  operationalStatus: 'Stan urządzenia',
};

export function errorMessage(e: unknown): string {
  const status = typeof e === 'object' && e && 'status' in e ? (e as { status: unknown }).status : undefined;
  const msg = e instanceof Error ? e.message : 'Nieznany błąd serwera';
  if (status === 409) return `Konflikt zapisu: rekord zmienił się w międzyczasie (inna sesja lub import). Odśwież dane i wprowadź zmiany ponownie. Szczegóły: ${msg}`;
  return msg;
}
