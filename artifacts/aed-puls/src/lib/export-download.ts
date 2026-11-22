export type ExportFormat = 'csv' | 'json' | 'geojson' | 'zip' | 'xlsx';
export type ExportScope = 'public' | 'approved' | 'review';
export type LicenseId = 'CC0-1.0' | 'CC-BY-4.0' | 'ODbL-1.0';
/** Zgodność wsteczna: 'all' albo pojedyncza licencja (stary parametr `license`). */
export type ExportLicense = 'all' | LicenseId;
/** Nowy wybór wielokrotny: jawna lista licencji (parametr `licenses`). */
export type ExportLicenseSelection = ExportLicense | readonly LicenseId[];

export const LICENSE_IDS: readonly LicenseId[] = ['CC0-1.0', 'CC-BY-4.0', 'ODbL-1.0'];

const MIME: Record<ExportFormat, string[]> = {
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  csv: ['text/csv', 'application/csv'],
  json: ['application/json'],
  geojson: ['application/geo+json', 'application/json'],
  zip: ['application/zip'],
};

export function apiUrl(path: string, params?: Record<string, string>): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
  return `${base}${path}${qs}`;
}

/** Kanoniczna, posortowana i bez duplikatów lista licencji (kolejność wg LICENSE_IDS). */
export function serializeLicenses(list: readonly string[]): string {
  return LICENSE_IDS.filter((l) => list.includes(l)).join(',');
}

export function exportQuery(scope: ExportScope, providerIds: string[], license: ExportLicenseSelection = 'all'): {
  scope: ExportScope; providerIds: string; license?: LicenseId; licenses?: string;
} {
  const base = { scope, providerIds: [...providerIds].sort().join(',') };
  if (Array.isArray(license)) return { ...base, licenses: serializeLicenses(license as readonly LicenseId[]) };
  const single = license as ExportLicense;
  return single === 'all' ? base : { ...base, license: single };
}

export interface DownloadResult {
  filename: string;
  bytes: number;
  recordCount: number | null;
  schemaVersion: string | null;
}

export class ExportDownloadError extends Error {}

function filenameFrom(header: string | null, format: ExportFormat): string {
  const fallback = `aed_puls.${format}`;
  if (!header) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  let name: string | null = null;
  if (star) {
    try { name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { name = null; }
  }
  if (!name) {
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
    name = plain ? plain[1].trim() : null;
  }
  if (!name) return fallback;
  name = name.replace(/[\\/]/g, '_');
  return name.toLowerCase().endsWith(`.${format}`) ? name : `${name.replace(/\.[a-z0-9]+$/i, '')}.${format}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('json')) {
      const j = await res.json();
      return j?.error || j?.message || `HTTP ${res.status}`;
    }
    const t = (await res.text()).trim();
    return t.slice(0, 200) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Pobiera kompletny plik eksportu; zapisuje go dopiero po odebraniu całej odpowiedzi. */
export async function downloadExport(
  format: ExportFormat,
  scope: ExportScope,
  providerIds: string[],
  signal: AbortSignal,
  license: ExportLicenseSelection = 'all',
): Promise<DownloadResult> {
  if (providerIds.length === 0) throw new ExportDownloadError('Nie wybrano żadnego dostawcy.');
  if (Array.isArray(license) && serializeLicenses(license as readonly LicenseId[]) === '') {
    throw new ExportDownloadError('Nie wybrano żadnej licencji.');
  }
  const res = await fetch(apiUrl(`/api/exports/${format}`, exportQuery(scope, providerIds, license)), {
    credentials: 'include',
    signal,
    headers: { Accept: MIME[format].join(', ') },
  });
  if (!res.ok) throw new ExportDownloadError(`Serwer odrzucił eksport (${res.status}): ${await readError(res)}`);
  const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!MIME[format].includes(ct)) {
    throw new ExportDownloadError(`Nieoczekiwany typ odpowiedzi: ${ct || 'brak'}. Plik nie został zapisany.`);
  }
  const blob = await res.blob();
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (blob.size === 0) throw new ExportDownloadError('Serwer zwrócił pusty plik. Nic nie zostało zapisane.');
  const rc = res.headers.get('X-AED-Record-Count');
  const recordCount = rc != null && rc.trim() !== '' && !Number.isNaN(Number(rc)) ? Number(rc) : null;
  if (recordCount == null || !Number.isSafeInteger(recordCount) || recordCount < 0) {
    throw new ExportDownloadError('Serwer nie potwierdził liczby rekordów. Plik nie został zapisany.');
  }
  // Pakiet ZIP z raportem walidacji może legalnie mieć 0 AED; surowe formaty nie.
  if (recordCount === 0 && format !== 'zip') {
    throw new ExportDownloadError('Plik nie zawiera żadnego rekordu AED. Nic nie zostało zapisane.');
  }
  const filename = filenameFrom(res.headers.get('Content-Disposition'), format);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  return { filename, bytes: blob.size, recordCount, schemaVersion: res.headers.get('X-AED-Schema-Version') };
}

export function isAbort(e: unknown) {
  return e instanceof DOMException && e.name === 'AbortError';
}
