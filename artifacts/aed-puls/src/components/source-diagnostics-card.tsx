import { Link } from 'wouter';
import { Loader2, PlugZap, RefreshCw } from 'lucide-react';
import type { IntegrationSource, SyncInputSourceKey } from '@workspace/api-client-react';
import { formatDate, formatDateTime } from '@/components/aed-bits';
import { StatusPill } from '@/components/admin-integrations';
import { SourceIndicator } from '@/components/source-provenance';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type SourceTab = 'records' | 'errors' | 'history';
export const sourceTabLabel: Record<SourceTab, string> = { records: 'Zobacz rekordy', errors: 'Zobacz błędy', history: 'Historia importów' };

const knownSyncKeys = ['all', 'dane-gov', 'openaedmap', 'przemysl', 'warszawa', 'openaed-eu'];
export const asSyncKey = (k: string | null | undefined): SyncInputSourceKey | null =>
  k && knownSyncKeys.includes(k) ? (k as SyncInputSourceKey) : null;

const needsConfig = (s: IntegrationSource) =>
  [s.status, s.connectionStatus].some((v) => v?.toLowerCase() === 'requires_configuration');

const ruleLabel: Record<string, string> = {
  border_review: 'Kontrola granicy Polski',
  missing_address: 'Brak adresu (pozostaje nieznany)',
  missing_city: 'Brak miejscowości (pozostaje nieznana)',
  missing_hours: 'Brak godzin dostępności (pozostają nieznane)',
};

function str(v: unknown) { return typeof v === 'string' && v.trim() ? v : null; }

function Metric({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'red' | 'muted' }) {
  return (
    <div className="rounded-lg border bg-background/60 p-2.5">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn('font-data text-lg font-semibold', tone === 'red' && 'text-primary', tone === 'muted' && 'text-muted-foreground')}>{value}</dd>
      {hint && <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  );
}

type Props = {
  s: IntegrationSource; selected: boolean; readOnly: boolean;
  onSelect: (id: string, t: SourceTab) => void;
  onSync: (k: SyncInputSourceKey, s: IntegrationSource) => void; syncPending: boolean;
  onTest: (s: IntegrationSource) => void; testing: boolean; testBusy: boolean;
};

export function SourceDiagnosticsCard({ s, selected, readOnly, onSelect, onSync, syncPending, onTest, testing, testBusy }: Props) {
  const syncKey = asSyncKey(s.syncKey);
  const config = needsConfig(s);
  const isGovChild = syncKey === 'dane-gov' && s.key !== 'dane-gov';
  const isCoordinator = syncKey === 'dane-gov' && s.key === 'dane-gov';
  const nonImportable = !syncKey;
  const syncDisabledReason = readOnly ? 'Konto tylko do odczytu' : nonImportable ? 'To źródło nie jest importowane (np. warstwa WMS zależna od OSM).' : config ? 'Integracja wymaga konfiguracji po stronie serwera.' : undefined;
  const li = s.latestImport;
  const ev = (s.provenanceEvidence ?? {}) as Record<string, unknown>;
  const copyName = str(ev.copyOfSourceName); const copyId = str(ev.copyOfSourceId);
  const conn = s.connectionStatus;
  const syncLabel = isGovChild || isCoordinator ? 'Synchronizuj katalog' : 'Synchronizuj teraz';
  const isWms = /wms|geoportal/i.test(`${s.key} ${s.sourceType ?? ''} ${s.name}`);

  return (
    <article className={cn('flex flex-col rounded-2xl border bg-card p-5', selected && 'ring-2 ring-primary')} data-testid={`card-source-${s.key}`} aria-busy={testing}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-bold">{s.name}</h3>
          <SourceIndicator category={s.sourceCategory} />
          <p className="text-sm text-muted-foreground">{s.coverage}</p>
          {isGovChild && <p className="mt-1 font-data text-[11px] text-muted-foreground">Zbiór wykryty w katalogu dane.gov.pl · {s.key}</p>}
        </div>
        <StatusPill status={s.status} />
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Wydawca</dt><dd data-testid={`text-publisher-${s.key}`}>{s.publisher || 'nieznany'}</dd>
        <dt className="text-muted-foreground">Licencja</dt><dd className="font-data">{s.license || 'nieustalona'}</dd>
        <dt className="text-muted-foreground">Typ integracji</dt><dd>{s.sourceType || 'Nieustalony'}</dd>
      </dl>

      <section className="mt-4 rounded-xl border border-dashed p-3" aria-label="Stan połączenia" data-testid={`status-connection-${s.key}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Połączenie</span>
          {testing ? <span className="inline-flex items-center gap-1 font-data text-xs text-accent-foreground" role="status"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Testowanie, może potrwać kilkadziesiąt sekund</span>
            : conn ? <StatusPill status={conn} /> : <span className="font-data text-xs text-muted-foreground">nie testowano</span>}
        </div>
        {s.connectionMessage && <p className="mt-1.5 text-sm">{s.connectionMessage}</p>}
        <p className="mt-1 font-data text-[11px] text-muted-foreground">Ostatni test: {s.connectionCheckedAt ? formatDate(s.connectionCheckedAt) : 'nigdy'} · Test nie importuje AED.</p>
      </section>

      <section className="mt-4" aria-label="Ostatni import">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ostatni import (bieżący przebieg)</h4>
        {li ? (
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid={`metrics-latest-${s.key}`}>
            <Metric label="Pobrane / przetw." value={li.processed} />
            <Metric label="Poprawne" value={li.validRecords ?? 'b.d.'} hint={li.validRecords == null ? 'Metryka historyczna nieznana' : undefined} tone={li.validRecords == null ? 'muted' : undefined} />
            <Metric label="Nowe AED" value={li.imported} />
            <Metric label="Aktualizacje" value={li.updated} />
            <Metric label="Duplikaty wierszy" value={li.duplicates} hint="Powtórzone wiersze źródła" />
            <Metric label="Błędy przebiegu" value={li.errors} tone={li.errors > 0 ? 'red' : undefined} />
          </dl>
        ) : <p className="mt-2 text-sm text-muted-foreground">Brak zakończonego importu dla tego źródła.</p>}
        {!!s.errorSummary?.length && (
          <ul className="mt-2 space-y-1 text-sm" data-testid={`list-error-summary-${s.key}`}>
            {s.errorSummary.map((e) => (
              <li key={`${e.rule}-${e.severity}`} className="flex flex-wrap items-baseline gap-2">
                <StatusPill status={e.severity} /><span className="font-data text-xs">{e.count} x</span>
                <span>{ruleLabel[e.rule] ?? e.rule}</span><span className="text-xs text-muted-foreground">{e.message}</span>
              </li>
            ))}
          </ul>
        )}
        {s.errorSummary?.some((e) => /^missing_/.test(e.rule)) && <p className="mt-1 text-xs text-muted-foreground">Brakujące adresy, miejscowości i godziny to ostrzeżenia; wartości pozostają nieznane i nie są uzupełniane.</p>}
      </section>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 text-sm">
        <dt className="text-muted-foreground">Rekordy w rejestrze</dt><dd className="font-data">{s.recordCount}</dd>
        <dt className="text-muted-foreground">Nowe AED (łącznie)</dt><dd className="font-data">{s.newAeds ?? 0}</dd>
        <dt className="text-muted-foreground">Dopasowane do innych AED</dt><dd className="font-data">{s.matchedRecords ?? 0}</dd>
        <dt className="text-muted-foreground">Otwarte konflikty</dt><dd className="font-data">{s.conflictCount ?? 0}</dd>
        <dt className="text-muted-foreground">Błędy historyczne</dt><dd className={cn('font-data', s.errorCount > 0 && 'text-primary')} title="Wszystkie zapisane problemy, także z wcześniejszych przebiegów">{s.errorCount}</dd>
        <dt className="text-muted-foreground">Ostatni błąd</dt><dd>{formatDate(s.lastErrorAt)}</dd>
        <dt className="text-muted-foreground">Ostatni sukces</dt><dd>{s.lastSuccessAt ? formatDate(s.lastSuccessAt) : 'nigdy'}</dd>
        <dt className="text-muted-foreground">Ostatnie sprawdzenie</dt><dd>{s.lastCheckedAt ? formatDateTime(s.lastCheckedAt) : 'nigdy'}</dd>
        <dt className="text-muted-foreground">Ostatnia synchronizacja</dt><dd>{formatDate(s.lastSyncedAt)}</dd>
        <dt className="text-muted-foreground">Aktualizacja w źródle</dt><dd>{formatDate(s.lastUpdatedAt)}</dd>
      </dl>
      {s.errorCount > 0 && <p className="mt-1 text-xs text-muted-foreground">Błędy historyczne obejmują wcześniejsze przebiegi i nie muszą dotyczyć obecnego stanu. Bieżące problemy pokazuje sekcja ostatniego importu.</p>}

      {s.message && <p className="mt-3 rounded-lg bg-muted p-3 text-sm" data-testid={`text-source-message-${s.key}`}>{s.message}</p>}
      {(copyName || copyId) && <p className="mt-3 rounded-lg border p-3 text-sm" data-testid={`text-copy-of-${s.key}`}>Kopia innej publikacji: <strong>{copyName ?? copyId}</strong>. Według metadanych pochodzenia ten zbiór powiela inne źródło, nie jest więc niezależnym potwierdzeniem fizycznego urządzenia.</p>}
      {isWms && nonImportable && <p className="mt-3 rounded-lg border p-3 text-sm">Geoportal udostępnia warstwę WMS opartą na danych OSM. Nie jest importowany i nie stanowi niezależnego dowodu istnienia AED. Test połączenia jest dostępny.</p>}
      {(isGovChild || isCoordinator) && <p className="mt-3 rounded-lg border p-3 text-sm">Synchronizuj katalog uruchamia koordynatora dane.gov.pl, który aktualizuje cały katalog i wszystkie wykryte zbiory, nie tylko {isGovChild ? 'ten jeden' : 'jeden zbiór'}.</p>}

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <Button size="sm" variant="outline" disabled={readOnly || testBusy} aria-busy={testing} onClick={() => onTest(s)} data-testid={`button-test-${s.key}`}>
          {testing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <PlugZap className="mr-1 h-4 w-4" aria-hidden />}
          {testing ? 'Testowanie...' : 'Testuj połączenie'}
        </Button>
        <Button size="sm" disabled={!!syncDisabledReason || syncPending} title={syncDisabledReason} aria-busy={syncPending} onClick={() => syncKey && onSync(syncKey, s)} data-testid={`button-sync-${s.key}`}>
          <RefreshCw className={cn('mr-1 h-4 w-4', syncPending && 'animate-spin')} aria-hidden /> {syncLabel}
        </Button>
        {s.datasetUrl && <Button asChild size="sm" variant="outline"><a href={s.datasetUrl} target="_blank" rel="noreferrer" data-testid={`link-dataset-${s.key}`}>Zobacz źródło</a></Button>}
        <Button asChild size="sm" variant="outline"><Link href="/admin/duplicates">Zobacz potencjalne duplikaty</Link></Button>
        {(['records', 'errors', 'history'] as SourceTab[]).map((t) => (
          <Button key={t} size="sm" variant="outline" onClick={() => onSelect(s.id, t)} data-testid={`button-${t}-${s.key}`}>{sourceTabLabel[t]}</Button>
        ))}
      </div>
      {syncDisabledReason && !readOnly && <p className="mt-2 text-xs text-muted-foreground">{syncDisabledReason}</p>}
    </article>
  );
}
