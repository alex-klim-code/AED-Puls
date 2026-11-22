import { type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import {
  getGetIntegrationPanelQueryKey, getGetStatsQueryKey, getGetWorkspaceQueryKey, getListAedsQueryKey,
  getListMapPointsQueryKey,
  useGetIntegrationPanel, type GetIntegrationPanelParams,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

export function useIntegrationPanel(params: GetIntegrationPanelParams) {
  const { user } = useSession();
  return useGetIntegrationPanel(params, { query: { queryKey: getGetIntegrationPanelQueryKey(params), enabled: !!user, refetchInterval: 5000 } });
}

export function useInvalidateIntegrations() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getGetIntegrationPanelQueryKey() });
    qc.invalidateQueries({ queryKey: getListAedsQueryKey() });
    qc.invalidateQueries({ queryKey: getListMapPointsQueryKey() });
    qc.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/aeds/')});
    qc.invalidateQueries({ queryKey: getGetStatsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
  };
}

export function errMsg(e: unknown) {
  return e instanceof Error ? e.message : undefined;
}

export function Pager({ page, pageSize, total, onPage, label }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; label: string }) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (total <= pageSize && page === 1) return <p className="mt-3 font-data text-xs text-muted-foreground">{label}: {total}</p>;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm" data-testid={`pager-${label}`}>
      <span className="font-data text-xs text-muted-foreground">{label}: {total} · strona {page} z {pages}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="button-page-prev"><ChevronLeft className="mr-1 h-4 w-4" /> Poprzednia</Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="button-page-next">Następna <ChevronRight className="ml-1 h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export function ReadOnlyNotice() {
  return (
    <div role="note" className="flex gap-3 rounded-2xl border border-dashed bg-card p-4 text-sm" data-testid="status-demo-readonly">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <p><strong>Tryb demo — tylko odczyt.</strong> Widzisz publiczne podsumowania źródeł. Testy połączeń, synchronizacja, łączenie duplikatów i rozstrzyganie konfliktów wymagają konta z pełną rolą ADMIN.</p>
    </div>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  if (value && typeof value === 'object' && 'encoding' in value && value.encoding === 'json-string' && 'payload' in value) {
    try { value = JSON.parse(String(value.payload)); } catch { /* Retain the encoded original if malformed. */ }
  }
  let text: string;
  try { text = JSON.stringify(value, null, 2) ?? 'null'; } catch { text = String(value); }
  return <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 font-data text-xs leading-relaxed">{text}</pre>;
}

export function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone = /(ok|success|done|completed|finished|merged|resolved)/.test(s) ? 'bg-verified/15 text-verified'
    : /(fail|error|rejected)/.test(s) ? 'bg-primary/15 text-primary'
    : /(running|queued|pending|open|progress)/.test(s) ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground';
  const labels: Record<string, string> = { dependent:'Warstwa zależna od OSM',connected:'Połączono',reachable:'Dostępne',untested:'Nie testowano',unavailable:'Niedostępne API',requires_configuration:'Wymaga dostępu i konfiguracji',below_threshold:'Poniżej progu',rejected_after_unmerge:'Rozdzielono ręcznie',ready: 'Gotowe', running: 'W trakcie', queued: 'W kolejce', pending: 'Oczekuje', succeeded: 'Zakończono', partial: 'Częściowo', failed: 'Błąd', interrupted: 'Przerwano', warning: 'Ostrzeżenie', error: 'Błąd', info: 'Informacja', merged: 'Połączono', rejected: 'Odrzucono', accepted: 'Przyjęto', kept: 'Zachowano' };
  return <span className={cn('inline-flex rounded-full px-2.5 py-0.5 font-data text-xs font-semibold', tone)} data-testid="status-pill">{labels[s] ?? status}</span>;
}

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
