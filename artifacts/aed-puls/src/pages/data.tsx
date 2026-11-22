import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, Download, FileArchive, Loader2, RotateCw, X } from 'lucide-react';
import {
  getGetExportPreviewQueryKey, getListExportProvidersQueryKey, useGetExportPreview, useListExportProviders,
} from '@workspace/api-client-react';
import type { ExportProvider } from '@workspace/api-client-react';
import { SiteLayout } from '@/components/layout';
import { ErrorState, ListSkeleton } from '@/components/aed-bits';
import { LicenseFieldset } from '@/components/export-license-fieldset';
import { PolicyExplainer, PreviewBody } from '@/components/export-preview';
import { DataCatalogue } from '@/components/data-catalogue';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { sourceStatusLabel } from '@/lib/source-status';
import {
  apiUrl, downloadExport, exportQuery, isAbort, LICENSE_IDS,
  type DownloadResult, type ExportFormat, type ExportScope, type LicenseId,
} from '@/lib/export-download';

const formats: { f: ExportFormat; label: string; d: string }[] = [
  { f: 'xlsx', label: 'XLSX', d: 'Skoroszyt Excel: rekordy AED, źródła i licencje, warunki wykorzystania, standard danych oraz raport walidacji. Jeden wiersz na AED.' },
  { f: 'zip', label: 'Pakiet ZIP', d: 'aed_data.csv, sources.csv, LICENSES.txt, validation_report.json. Zawiera raport także wtedy, gdy żaden AED nie przeszedł polityki.' },
  { f: 'csv', label: 'CSV', d: 'UTF-8; zagnieżdżone metadane (publikacje, licencje) zakodowane jako JSON w komórkach' },
  { f: 'json', label: 'JSON', d: 'Tablica rekordów, jeden rekord na AED' },
  { f: 'geojson', label: 'GeoJSON', d: 'FeatureCollection, geometria WGS84; współrzędne zachowane także we właściwościach' },
];
const fmtName = (f: ExportFormat) => f === 'geojson' ? 'GeoJSON' : f.toUpperCase();

const scopes: { id: ExportScope; label: string; d: string; admin?: boolean }[] = [
  { id: 'public', label: 'Publiczny', d: 'Rekordy widoczne publicznie, w tym niezweryfikowane importy z jawnym statusem. Bez prywatnych zgłoszeń.' },
  { id: 'approved', label: 'Zatwierdzony', d: 'Wyłącznie rekordy zatwierdzone.' },
  { id: 'review', label: 'Kontrola (ADMIN)', d: 'Również rekordy oczekujące. Nie jest to zbiór do publikacji.', admin: true },
];

const kindLabel: Record<string, string> = { source: 'Źródło', application: 'Aplikacja', organization: 'Organizacja' };
const kindOrder = ['source', 'application', 'organization'];
const n = (v: number) => v.toLocaleString('pl-PL');
/** Ścisłe dopasowanie: zwrócone licencje muszą dokładnie odpowiadać bieżącemu wyborowi (bez duplikatów i braków). */
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

type DlState =
  | { s: 'idle' }
  | { s: 'loading'; format: ExportFormat }
  | { s: 'done'; format: ExportFormat; r: DownloadResult }
  | { s: 'cancelled'; format: ExportFormat }
  | { s: 'error'; format: ExportFormat; msg: string };

export default function DataPage() {
  const { user, isLoading: sessionLoading } = useSession();
  const isAdmin = user?.role === 'ADMIN';
  const account = user?.id ?? 'anon';
  const [scopeState, setScope] = useState<ExportScope>('public');
  const [licSet, setLicSet] = useState<Set<LicenseId>>(() => new Set(LICENSE_IDS));
  const [format, setFormat] = useState<ExportFormat>('zip');
  const scope: ExportScope = scopeState === 'review' && !isAdmin ? 'public' : scopeState;

  const pParams = { scope };
  const providers = useListExportProviders(pParams, {
    query: { queryKey: [...getListExportProvidersQueryKey(pParams), account], enabled: !sessionLoading },
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const initFor = useRef<string | null>(null);
  const list = useMemo(() => providers.data ?? [], [providers.data]);
  useEffect(() => {
    const key = `${account}:${scope}`;
    if (providers.data && initFor.current !== key) {
      initFor.current = key;
      setSelected(new Set(providers.data.map((p) => p.id)));
    }
  }, [providers.data, account, scope]);

  const ids = useMemo(() => [...selected].filter((id) => list.some((p) => p.id === id)).sort(), [selected, list]);
  const licenses = useMemo(() => LICENSE_IDS.filter((l) => licSet.has(l)), [licSet]);
  const licKey = licenses.join(',');
  const q = exportQuery(scope, ids, licenses);
  const canQuery = ids.length > 0 && licenses.length > 0;
  const preview = useGetExportPreview(q, {
    query: {
      queryKey: [...getGetExportPreviewQueryKey(q), account],
      enabled: canQuery && !sessionLoading,
      placeholderData: keepPreviousData,
    },
  });
  const pv = preview.data;
  const previewMatches = !!pv && !preview.isPlaceholderData
    && [...pv.providerIds].sort().join(',') === q.providerIds
    && Array.isArray(pv.selectedLicenses) && sameSet(pv.selectedLicenses, licenses);
  const previewReady = canQuery && previewMatches && !preview.isFetching && !preview.error;

  const [dl, setDl] = useState<DlState>({ s: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const busy = dl.s === 'loading';
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    requestVersion.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setDl({ s: 'idle' });
  }, [q.providerIds, scope, account, licKey, format]);

  const formatAllowed = (f: ExportFormat) => !!pv && (f === 'zip' ? pv.reportDownloadAvailable : pv.recordCount > 0);
  const disabledFor = (f: ExportFormat): string | null =>
    ids.length === 0 ? 'Wybierz co najmniej jednego dostawcę.'
    : licenses.length === 0 ? 'Wybierz co najmniej jedną licencję. Brak wyboru nie oznacza wszystkich.'
    : preview.error ? 'Podgląd nie został wczytany — pobieranie zablokowane.'
    : !previewReady ? 'Trwa przeliczanie podglądu dla bieżącego wyboru.'
    : !formatAllowed(f) ? (f === 'zip'
      ? 'Serwer nie udostępnia raportu dla tego wyboru.'
      : 'Żaden AED nie przeszedł polityki dla tego wyboru. Pobierz pakiet ZIP, aby przejrzeć raport walidacji.')
    : null;
  const disabledReason = disabledFor(format);

  const start = async (f: ExportFormat) => {
    if (disabledFor(f) || busy) return;
    abortRef.current?.abort();
    const version = ++requestVersion.current;
    const ac = new AbortController();
    abortRef.current = ac;
    setDl({ s: 'loading', format: f });
    try {
      const r = await downloadExport(f, scope, ids, ac.signal, licenses);
      if (version === requestVersion.current) setDl({ s: 'done', format: f, r });
    } catch (e) {
      if (version === requestVersion.current) {
        if (isAbort(e)) setDl({ s: 'cancelled', format: f });
        else setDl({ s: 'error', format: f, msg: e instanceof Error ? e.message : 'Nieznany błąd pobierania' });
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  };
  const cancel = () => abortRef.current?.abort();

  const toggle = (id: string) => {
    if (busy) return;
    setSelected((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  };
  const toggleLic = (l: LicenseId) => {
    if (busy) return;
    setLicSet((prev) => { const s = new Set(prev); if (s.has(l)) s.delete(l); else s.add(l); return s; });
  };

  const grouped = kindOrder.map((k) => ({ k, items: list.filter((p) => p.kind === k) })).filter((g) => g.items.length);

  return (
    <SiteLayout>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <p className="font-data text-xs uppercase tracking-[0.2em] text-primary">Otwarte dane</p>
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold leading-tight sm:text-5xl">Pobierz dane AED z wybranych źródeł.</h1>
        <p className="mt-4 max-w-3xl text-muted-foreground">
          Wybierz źródła, opublikowane dane AED Puls i organizacji, licencje oraz format. Sprawdź podgląd i pobierz plik. Zachowujemy rzeczywistych wydawców, odrębne licencje i wymagane atrybucje. Rekordy o nieznanych lub niezweryfikowanych prawach są pomijane. To nie jest zbiór ratunkowy; w nagłym wypadku dzwoń 112.
        </p>

        <div className="mt-8 flex flex-wrap gap-2" role="radiogroup" aria-label="Zakres eksportu">
          {scopes.filter((s) => !s.admin || isAdmin).map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={scope === s.id} disabled={busy}
              onClick={() => setScope(s.id)} data-testid={`button-scope-${s.id}`}
              className={cn('rounded-xl border px-4 py-2.5 text-left text-sm transition-colors disabled:opacity-60', scope === s.id ? 'border-foreground bg-foreground text-background' : 'bg-card hover:border-foreground')}>
              <span className="font-semibold">{s.label}</span>
              <span className={cn('block max-w-xs text-xs', scope === s.id ? 'text-background/75' : 'text-muted-foreground')}>{s.d}</span>
            </button>
          ))}
        </div>

        <LicenseFieldset selected={licSet} busy={busy} onToggle={toggleLic} onSetAll={(all) => setLicSet(all ? new Set(LICENSE_IDS) : new Set())} />

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <section aria-labelledby="prov-h" className="min-w-0 self-start rounded-2xl border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
              <div>
                <h2 id="prov-h" className="font-semibold">Dostawcy danych</h2>
                <p className="text-xs text-muted-foreground" data-testid="text-selection-count">
                  Wybrano {ids.length} z {list.length}. Liczby przy dostawcach to kandydaci przed walidacją praw i filtrem licencji; mogą się nakładać.
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={busy || list.length === 0 || ids.length === list.length} onClick={() => setSelected(new Set(list.map((p) => p.id)))} className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:border-foreground disabled:opacity-50" data-testid="button-select-all">Zaznacz wszystkie</button>
                <button type="button" disabled={busy || ids.length === 0} onClick={() => setSelected(new Set())} className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:border-foreground disabled:opacity-50" data-testid="button-clear-selection">Wyczyść</button>
              </div>
            </div>
            <div className="max-h-[560px] overflow-y-auto">
              {providers.isLoading || sessionLoading ? <div className="p-5"><ListSkeleton rows={4} /></div>
                : providers.error ? <div className="p-5"><ErrorState error={providers.error} onRetry={() => providers.refetch()} title="Nie udało się wczytać dostawców" /></div>
                : list.length === 0 ? <p className="p-5 text-sm text-muted-foreground">W tym zakresie nie ma żadnego dostawcy. To rzeczywisty stan bazy.</p>
                : grouped.map((g) => (
                  <fieldset key={g.k} disabled={busy} className="border-b last:border-b-0">
                    <legend className="w-full bg-muted/60 px-5 py-1.5 font-data text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{kindLabel[g.k] ?? g.k} · {g.items.length}</legend>
                    <ul>{g.items.map((p) => <ProviderRow key={p.id} p={p} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} />)}</ul>
                  </fieldset>
                ))}
            </div>
            <p className="border-t px-5 py-3 text-xs text-muted-foreground">Dostawcy pojawiają się po zapisaniu ich rekordów w wybranym zakresie. Jeden AED może mieć kilku dostawców; każdy zachowuje swoją licencję. Prywatne zgłoszenia nie są publicznie eksportowane.</p>
            {busy && <p className="border-t px-5 py-2 text-xs text-muted-foreground">Wybór zablokowany na czas przygotowania pliku. Anuluj, aby go zmienić.</p>}
          </section>

          <div className="min-w-0 space-y-4">
            <section aria-labelledby="pv-h" aria-live="polite" className="rounded-2xl border bg-card p-5">
              <div className="flex items-center justify-between">
                <h2 id="pv-h" className="font-semibold">Podgląd przed pobraniem</h2>
                {preview.isFetching && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> przeliczanie</span>}
              </div>
              {ids.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nie wybrano dostawców. Zaznacz co najmniej jednego, aby zobaczyć podgląd.</p>
                : licenses.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nie wybrano licencji. Zaznacz co najmniej jedną, aby zobaczyć podgląd.</p>
                : preview.error ? <div className="mt-3"><ErrorState error={preview.error} onRetry={() => preview.refetch()} title="Nie udało się przygotować podglądu" /></div>
                : !pv ? <div className="mt-4 grid grid-cols-3 gap-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="col-span-3 h-24" /></div>
                : <PreviewBody pv={pv} stale={!previewMatches} />}
            </section>

            <section aria-labelledby="dl-h" className="rounded-2xl border bg-card p-5">
              <h2 id="dl-h" className="font-semibold">Pobierz plik</h2>
              <div role="radiogroup" aria-label="Format pliku" className="mt-3 grid gap-2 sm:grid-cols-2">
                {formats.map((x) => {
                  const blocked = !!pv && previewReady && !formatAllowed(x.f);
                  return (
                    <button key={x.f} type="button" role="radio" aria-checked={format === x.f} disabled={busy} onClick={() => setFormat(x.f)}
                      data-testid={`button-format-${x.f}`}
                      className={cn('rounded-xl border p-3 text-left transition-colors disabled:opacity-60', x.f === 'zip' && 'sm:col-span-2', format === x.f ? 'border-foreground ring-1 ring-foreground' : 'hover:border-foreground', blocked && 'opacity-60')}>
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        {x.f === 'zip' && <FileArchive className="h-4 w-4" />}{x.label}
                        {blocked && <span className="font-data text-[10px] uppercase text-muted-foreground">niedostępny: 0 AED</span>}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">{x.d}</span>
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={() => start(format)} disabled={!!disabledReason || busy}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-download-export">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {busy ? 'Przygotowywanie pliku…' : format === 'zip' && pv && previewReady && pv.recordCount === 0 ? 'Pobierz ZIP z raportem (0 AED)' : `Pobierz ${fmtName(format)}`}
              </button>
              <p className="mt-2 text-xs text-muted-foreground">Uznanie autorstwa, autorzy, adresy źródeł, informacje licencyjne i obowiązki ODbL są zawsze dołączone i nie można ich wyłączyć.</p>
              <div aria-live="polite" className="mt-3 text-sm" data-testid="status-download">
                {dl.s === 'loading' ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
                    <span>Przygotowywanie pliku {fmtName(dl.format)}. Plik zapisze się automatycznie dopiero po odebraniu całości.</span>
                    <button type="button" onClick={cancel} className="inline-flex items-center gap-1 rounded-lg border bg-card px-3 py-1.5 text-xs font-semibold hover:border-foreground" data-testid="button-cancel-download"><X className="h-3.5 w-3.5" /> Anuluj</button>
                  </div>
                ) : dl.s === 'done' ? (
                  <p className="flex gap-2 rounded-lg border border-verified/40 p-3 text-verified"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>Zapisano <span className="font-data">{dl.r.filename}</span> ({(dl.r.bytes / 1024).toFixed(1)} KB{dl.r.recordCount != null && `, ${n(dl.r.recordCount)} AED`}{dl.r.schemaVersion && `, schemat ${dl.r.schemaVersion}`}).{dl.r.recordCount === 0 && ' Pakiet zawiera wyłącznie raport walidacji i informacje licencyjne.'}</span></p>
                ) : dl.s === 'cancelled' ? (
                  <p className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">Pobieranie anulowane. Nic nie zostało zapisane.<RetryBtn onClick={() => start(dl.format)} disabled={!!disabledFor(dl.format)} /></p>
                ) : dl.s === 'error' ? (
                  <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-accent p-3 text-accent-foreground"><span>{dl.msg}</span><RetryBtn onClick={() => start(dl.format)} disabled={!!disabledFor(dl.format)} /></div>
                ) : disabledReason ? <p className="text-xs text-muted-foreground" data-testid="text-download-disabled">{disabledReason}</p> : null}
              </div>
            </section>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <a href={canQuery ? apiUrl('/api/metadata', q) : undefined} aria-disabled={!canQuery} target="_blank" rel="noreferrer"
            className={cn('rounded-2xl border bg-card p-4 hover:border-foreground', !canQuery && 'pointer-events-none opacity-50')} data-testid="link-metadata">
            <p className="font-semibold">Metadane wybranego zbioru</p><p className="text-sm text-muted-foreground">Dla bieżącego zakresu, dostawców i licencji</p>
          </a>
          <a href={apiUrl('/api/standard.xlsx')} download className="rounded-2xl border bg-card p-4 hover:border-foreground" data-testid="link-standard">
            <p className="font-semibold">aed_data_standard.xlsx</p><p className="text-sm text-muted-foreground">Pola, typy, reguły walidacji, przykłady</p>
          </a>
          <a href={apiUrl('/api/openapi.json')} target="_blank" rel="noreferrer" className="rounded-2xl border bg-card p-4 hover:border-foreground" data-testid="link-openapi">
            <p className="inline-flex items-center gap-2 font-semibold"><BookOpen className="h-4 w-4" /> Dokumentacja API</p><p className="text-sm text-muted-foreground">Specyfikacja OpenAPI</p>
          </a>
        </div>

        <PolicyExplainer />
        <DataCatalogue />

      </div>
    </SiteLayout>
  );
}

function RetryBtn({ onClick, disabled: d }: { onClick: () => void; disabled: boolean }) {
  return <button type="button" onClick={onClick} disabled={d} className="inline-flex shrink-0 items-center gap-1 rounded-lg border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:border-foreground disabled:opacity-50" data-testid="button-retry-download"><RotateCw className="h-3.5 w-3.5" /> Ponów</button>;
}

function ProviderRow({ p, checked, onToggle }: { p: ExportProvider; checked: boolean; onToggle: () => void }) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-muted/50" data-testid={`row-provider-${p.id}`}>
        <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 accent-[hsl(var(--primary))]" data-testid={`checkbox-provider-${p.id}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{p.name}</span>
          <span title={p.status} className="font-data text-[11px] text-muted-foreground">deklaracja: {p.license || 'licencja nieznana'} · {sourceStatusLabel(p.status)}</span>
        </span>
        <span className={cn('font-data text-sm tabular-nums', p.recordCount === 0 && 'text-muted-foreground')}>{n(p.recordCount)}</span>
      </label>
    </li>
  );
}
