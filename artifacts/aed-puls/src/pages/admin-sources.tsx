import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { RefreshCw } from 'lucide-react';
import { useStartSourceSync, useTestSourceConnection, type IntegrationPanel, type IntegrationSource, type SyncInputSourceKey } from '@workspace/api-client-react';
import { SourceDiagnosticsCard, sourceTabLabel, type SourceTab } from '@/components/source-diagnostics-card';
import { WorkspaceLayout } from '@/components/layout';
import { KpiCard } from '@/components/records-table';
import { EmptyState, ErrorState, ListSkeleton, formatDate } from '@/components/aed-bits';
import { JsonBlock, Pager, Panel, ReadOnlyNotice, StatusPill, errMsg, useIntegrationPanel, useInvalidateIntegrations } from '@/components/admin-integrations';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Tab = SourceTab;
const tabLabel = sourceTabLabel;

function SourcesList({ data, sourceId, onSelect, onSync, syncing, onTest, testingId }: { data: IntegrationPanel; sourceId?: string; onSelect: (id: string | undefined, tab: Tab) => void; onSync: (k: SyncInputSourceKey, s: IntegrationSource) => void; syncing: boolean; onTest: (s: IntegrationSource) => void; testingId: string | null }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {data.sources.map((s) => (
        <SourceDiagnosticsCard key={s.id} s={s} selected={sourceId === s.id} readOnly={data.demoReadOnly} onSelect={onSelect} onSync={onSync} syncPending={syncing} onTest={onTest} testing={testingId === s.id} testBusy={testingId !== null} />
      ))}
    </div>
  );
}

function TabContent({ tab, data, sourceName, setPage }: { tab: Tab; data: IntegrationPanel; sourceName: (id: string | null) => string; setPage: (p: number) => void }) {
  const pager = (total: number, label: string) => <Pager page={data.page} pageSize={data.pageSize} total={total} onPage={setPage} label={label} />;
  if (tab === 'records') {
    if (!data.records.length) return <EmptyState title="Brak zaimportowanych rekordów">Rekordy pojawią się po udanej synchronizacji źródła.</EmptyState>;
    return (
      <>
        <ul className="space-y-3">
          {data.records.map((r) => (
            <li key={r.id} className="rounded-xl border p-4" data-testid={`row-record-${r.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold">{sourceName(r.sourceId)} · <span className="font-data">{r.sourceRecordId}</span></span>
                <span className="font-data text-xs text-muted-foreground">{r.license}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Wydawca: {r.publisher ?? 'nieznany'} · import {formatDate(r.importedAt)} · synchronizacja {formatDate(r.lastSyncedAt)}
                {r.aedId && <> · <Link href={`/aed/${r.aedId}`} className="text-primary underline">rekord kanoniczny</Link></>}
                {' · '}<a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">źródło</a>
              </p>
              <details className="mt-2"><summary className="cursor-pointer text-sm font-medium">Oryginalny rekord (bez zmian)</summary><div className="mt-2"><JsonBlock value={r.originalRecord} /></div></details>
            </li>
          ))}
        </ul>
        {pager(data.recordTotal, 'Rekordy')}
      </>
    );
  }
  if (tab === 'errors') {
    if (!data.errors.length) return <EmptyState title="Brak błędów importu">Walidacja nie zgłosiła problemów dla wybranego zakresu.</EmptyState>;
    return (
      <>
        <ul className="divide-y rounded-xl border">
          {data.errors.map((e) => (
            <li key={e.id} className="p-4 text-sm" data-testid={`row-error-${e.id}`}>
              <div className="flex flex-wrap items-center gap-2"><StatusPill status={e.severity} /><span className="font-data text-xs">{e.rule}</span><span className="text-xs text-muted-foreground">{sourceName(e.sourceId)} · {formatDate(e.createdAt)}</span></div>
              <p className="mt-1">{e.message}</p>
              {e.sourceRecordId && <p className="font-data text-xs text-muted-foreground">ID w źródle: {e.sourceRecordId} · zadanie {e.jobId}</p>}
            </li>
          ))}
        </ul>
        {pager(data.errorTotal, 'Błędy')}
      </>
    );
  }
  if (!data.jobs.length) return <EmptyState title="Brak historii importów">Uruchom synchronizację, aby utworzyć pierwsze zadanie.</EmptyState>;
  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr><th className="p-3">Źródło</th><th className="p-3">Status</th><th className="p-3">Przetw.</th><th className="p-3">Nowe</th><th className="p-3">Zaktual.</th><th className="p-3">Pominięte</th><th className="p-3">Błędy</th><th className="p-3">Start</th><th className="p-3">Koniec</th></tr>
          </thead>
          <tbody className="divide-y font-data">
            {data.jobs.map((j) => (
              <tr key={j.id} data-testid={`row-job-${j.id}`}>
                <td className="p-3 font-sans">{sourceName(j.sourceId)}</td><td className="p-3"><StatusPill status={j.status} /></td>
                <td className="p-3">{j.processed}</td><td className="p-3">{j.imported}</td><td className="p-3">{j.updated}</td><td className="p-3">{j.skipped}</td>
                <td className={cn('p-3', j.errors > 0 && 'text-primary')}>{j.errors}</td>
                <td className="p-3 font-sans">{formatDate(j.createdAt)}</td><td className="p-3 font-sans">{j.finishedAt ? formatDate(j.finishedAt) : 'w toku'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager(data.jobTotal, 'Zadania')}
    </>
  );
}

export default function AdminSourcesPage() {
  const [sourceId, setSourceId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>('history');
  const params = { ...(sourceId ? { sourceId } : {}), page };
  const panel = useIntegrationPanel(params);
  const recent = useIntegrationPanel({ page: 1 });
  const sync = useStartSourceSync();
  const invalidate = useInvalidateIntegrations();
  const { toast } = useToast();
  const data = panel.data;
  const appendJob = recent.data?.jobs.find(j => j.summary?.mode === 'append');
  const completedJob = useRef<string | null>(null);
  useEffect(() => {
    if (appendJob?.finishedAt && completedJob.current !== appendJob.id) {
      completedJob.current = appendJob.id;
      invalidate();
    }
  }, [appendJob?.id, appendJob?.finishedAt, invalidate]);
  const appendImport = () => sync.mutate({ data: { sourceKey: 'dane-gov', mode: 'append' } }, {
    onSuccess: r => {
      toast({ title: 'Import AED uruchomiony', description: r.message });
      setSourceId(undefined); setPage(1); setTab('history'); invalidate();
    },
    onError: e => toast({ title: 'Nie uruchomiono importu', description: errMsg(e), variant: 'destructive' }),
  });

  const select = (id: string | undefined, t: Tab) => { setSourceId(id); setTab(t); setPage(1); };
  const test = useTestSourceConnection();
  const [testingId, setTestingId] = useState<string | null>(null);
  const runTest = (s: IntegrationSource) => {
    setTestingId(s.id);
    test.mutate({ data: { sourceId: s.id } }, {
      onSuccess: (r) => { toast({ title: `Test połączenia: ${s.name}`, description: `${r.message} Status: ${r.status}. Rekordy w pierwszym zasobie: ${r.recordCount}. Nic nie zaimportowano.`, variant: /fail|error|unavailable/i.test(r.status) ? 'destructive' : undefined }); },
      onError: (e) => toast({ title: 'Test połączenia nie powiódł się', description: errMsg(e), variant: 'destructive' }),
      onSettled: () => { setTestingId(null); invalidate(); },
    });
  };
  const runSync = (key: SyncInputSourceKey, s?: IntegrationSource) =>
    sync.mutate({ data: { sourceKey: key } }, {
      onSuccess: (r) => { toast({ title: key === 'dane-gov' ? 'Synchronizacja katalogu dane.gov.pl uruchomiona' : 'Synchronizacja uruchomiona', description: `${s && key === 'dane-gov' && s.key !== 'dane-gov' ? 'Aktualizowany jest cały katalog i wszystkie wykryte zbiory. ' : ''}${r.message} Zadania: ${r.jobIds.length}.` }); invalidate(); setTab('history'); setPage(1); },
      onError: (e) => toast({ title: 'Nie udało się uruchomić synchronizacji', description: errMsg(e), variant: 'destructive' }),
    });
  const sourceName = (id: string | null) => data?.sources.find((s) => s.id === id)?.name ?? id ?? 'nieznane';
  const running = recent.data?.sources.some(s => s.status === 'running') || recent.data?.jobs.some(j => !j.finishedAt) || false;

  return (
    <WorkspaceLayout
      roles={['ADMIN']} title="Źródła danych" kicker="Administrator · importy"
      actions={<Button disabled={!data || data.demoReadOnly || sync.isPending || running} aria-busy={sync.isPending || running} onClick={appendImport} data-testid="button-import-aed"><RefreshCw className={cn('mr-2 h-4 w-4', (sync.isPending || running) && 'animate-spin')} /> Importuj AED z dane.gov.pl</Button>}
    >
      {panel.isLoading ? <ListSkeleton /> : panel.error || !data ? <ErrorState error={panel.error} onRetry={() => panel.refetch()} /> : (
        <div className="space-y-8">
          {data.demoReadOnly && <ReadOnlyNotice />}
          <p className="text-sm text-muted-foreground">Import dopisuje wyłącznie nowe AED. Nie nadpisuje ani nie usuwa istniejących danych i nie potwierdza sprawności urządzeń.</p>
          {appendJob && <div role="status" className="rounded-xl border bg-card p-4 text-sm" data-testid="status-append-import">
            <strong>{appendJob.finishedAt ? 'Wynik ostatniego importu dopisującego' : 'Trwa import AED z dane.gov.pl'}</strong>{' '}
            <StatusPill status={appendJob.status} />
            <p className="mt-2">Dodano: {appendJob.imported} · Pominięto: {appendJob.skipped} · Błędne rekordy: {appendJob.errors}</p>
            <p>Błędy zasobów: {Number(appendJob.summary?.resourceErrors ?? 0)} · Nieobsługiwane zasoby: {Number(appendJob.summary?.unsupportedResources ?? 0)} · Komunikaty walidacji: {Number(appendJob.summary?.validationMessages ?? 0)}</p>
            {appendJob.status === 'partial' && <p>Import częściowy — poprawne wpisy zapisano. Szczegóły w zakładce „Zobacz błędy”.</p>}
            <p className="mt-1 text-xs text-muted-foreground">Start: {formatDate(appendJob.createdAt)} · Zadanie: {appendJob.id}</p>
          </div>}
          <p className="rounded-xl border bg-card p-4 text-sm">Aktywne integracje z rzeczywistymi rekordami: <strong>{data.stats.activeIntegrations??0}</strong> z {data.sources.length} rozpatrzonych. AED z co najmniej dwoma niezależnymi wydawcami: <strong>{data.stats.multiSourceAeds??0}</strong>. Kilka publikacji nie oznacza kilku kontroli urządzenia.</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard label="Zaimportowane rekordy" value={data.stats.importedRecords} />
            <KpiCard label="Rekordy kanoniczne" value={data.stats.canonicalRecords} />
            <KpiCard label="Do weryfikacji" value={data.stats.requiringVerification} tone="red" hint="Import nie oznacza weryfikacji" />
            <KpiCard label="Kandydaci na duplikaty" value={data.stats.duplicateCandidates} />
            <KpiCard label="Konflikty pól" value={data.stats.conflicts} />
            <KpiCard label="Ostatni udany import" value={data.stats.lastSuccessAt ? formatDate(data.stats.lastSuccessAt) : 'brak'} />
          </div>
          {running && <p className="rounded-xl bg-accent p-3 text-sm text-accent-foreground" role="status" data-testid="status-sync-running">Trwa import — postęp odświeża się co 5 sekund na podstawie zadań serwera.</p>}
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline"><Link href="/admin/duplicates" data-testid="link-duplicates">Duplikaty i konflikty ({data.duplicateTotal + data.conflictTotal})</Link></Button>
          </div>
          <SourcesList data={data} sourceId={sourceId} onSelect={select} onSync={runSync} syncing={sync.isPending} onTest={runTest} testingId={testingId} />
          <Panel
            title={`${tabLabel[tab]}${sourceId ? ` — ${sourceName(sourceId)}` : ' — wszystkie źródła'}`}
            actions={
              <div className="flex flex-wrap gap-2">
                <select className="h-9 rounded-lg border bg-background px-2 text-sm" value={sourceId ?? ''} onChange={(e) => select(e.target.value || undefined, tab)} aria-label="Filtr źródła" data-testid="select-source">
                  <option value="">Wszystkie źródła</option>
                  {data.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {(['records', 'errors', 'history'] as Tab[]).map((t) => (
                  <Button key={t} size="sm" variant={tab === t ? 'default' : 'outline'} onClick={() => select(sourceId, t)} data-testid={`tab-${t}`}>{tabLabel[t]}</Button>
                ))}
              </div>
            }
          >
            <TabContent tab={tab} data={data} sourceName={sourceName} setPage={setPage} />
          </Panel>
        </div>
      )}
    </WorkspaceLayout>
  );
}
