import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CloudOff, ShieldCheck } from 'lucide-react';
import {
  getGetMcodWorkspaceQueryKey, getGetWorkspaceQueryKey, useGetMcodWorkspace,
  type McodEntity, type McodIntegrationStatus, type McodWorkspace,
} from '@workspace/api-client-react';
import { ErrorState, ListSkeleton } from '@/components/aed-bits';
import { useSession, errorText } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export const str = (e: McodEntity | null | undefined, k: string) => { const v = e?.[k]; return v == null ? '' : String(v); };
/** Rewizja z serwera albo null — nigdy nie zgadujemy wartości. */
export const rev = (e: McodEntity): number | null => { const v = Number(e.revision); return e.revision != null && Number.isInteger(v) && v >= 1 ? v : null; };
export const inputCls = 'mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm';
export const MISSING_REVISION = 'Brak rewizji rekordu z serwera. Odśwież dane przed zapisem.';

export const syncEnabled = (st: McodIntegrationStatus) => (st as McodIntegrationStatus & { syncEnabled?: boolean }).syncEnabled === true;

/** Powód blokady operacji zdalnej albo null. Niepotwierdzony kontrakt blokuje nawet przy włączonych flagach. */
export function remoteBlock(ws: McodWorkspace, flag: boolean): string | null {
  if (!ws.status.enabled || !flag) return 'Integracja MCOD oczekuje na aktywację';
  if (ws.unconfirmedOperations.length > 0) return 'Wymaga potwierdzenia kontraktu MCOD';
  return null;
}

const lifecycle: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'Szkic', tone: 'bg-muted text-foreground' },
  PENDING_APPROVAL: { label: 'Czeka na zatwierdzenie', tone: 'bg-accent text-accent-foreground' },
  PENDING_VERIFICATION: { label: 'Czeka na weryfikację', tone: 'bg-accent text-accent-foreground' },
  UNCOMPLETED: { label: 'Do uzupełnienia', tone: 'bg-accent text-accent-foreground' },
  APPROVED: { label: 'Zatwierdzone lokalnie', tone: 'bg-verified/15 text-verified' },
  REGISTERED: { label: 'Zarejestrowane', tone: 'bg-verified/15 text-verified' },
  REJECTED: { label: 'Odrzucone', tone: 'bg-primary/10 text-primary' },
  PREPARED: { label: 'Plan przygotowany', tone: 'bg-muted text-foreground' },
  VALIDATION_FAILED: { label: 'Walidacja nieudana', tone: 'bg-primary/10 text-primary' },
  PUBLISHED: { label: 'Opublikowane w MCOD', tone: 'bg-verified text-white' },
};

export function StatusPill({ status }: { status?: string }) {
  const s = lifecycle[status ?? ''] ?? { label: status || 'brak statusu', tone: 'bg-muted text-muted-foreground' };
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', s.tone)} data-testid="status-lifecycle"><span className="font-data text-[10px] opacity-70">{status}</span>{s.label}</span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block text-sm font-medium">{label}{children}{hint && <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span>}</label>;
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-xl font-bold">{title}</h2>{aside}</div>
      {children}
    </section>
  );
}

export function BlockedNote({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return <p className="text-xs text-muted-foreground" data-testid="text-blocked-reason">{reason}</p>;
}

export function IntegrationBanner({ ws }: { ws: McodWorkspace }) {
  const st = ws.status;
  const live = st.enabled && st.writesEnabled && ws.unconfirmedOperations.length === 0;
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('rounded-2xl border-2 p-5', live ? 'border-verified/40 bg-verified/5' : 'border-dashed border-foreground/25 bg-card')} data-testid="status-mcod-integration">
      <div className="flex flex-wrap items-start gap-4">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', live ? 'bg-verified text-white' : 'bg-foreground text-background')}>{live ? <ShieldCheck className="h-5 w-5" aria-hidden /> : <CloudOff className="h-5 w-5" aria-hidden />}</span>
        <div className="min-w-0 flex-1">
          <p className="font-data text-xs uppercase tracking-[0.2em] text-muted-foreground">{live ? 'Tryb LIVE' : 'Tryb lokalny'}</p>
          <p className="mt-1 font-display text-lg font-bold">{live ? 'Integracja MCOD aktywna' : st.enabled ? 'Wymaga potwierdzenia kontraktu MCOD' : 'Integracja MCOD oczekuje na aktywację'}</p>
          <p className="mt-1 text-sm text-muted-foreground">{ws.message || 'Wszystkie działania są zapisywane lokalnie w AED Puls. Nic nie jest wysyłane do dane.gov.pl.'}</p>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-data text-xs">
            <div>enabled: <strong>{String(st.enabled)}</strong></div>
            <div>writes: <strong>{String(st.writesEnabled)}</strong></div>
            <div>sync: <strong>{String(syncEnabled(st))}</strong></div>
            <div>kontrakt: <strong>{st.contractStatus}</strong></div>
            <div>połączenie: <strong>{st.connectionStatus}</strong></div>
          </dl>
          {ws.unconfirmedOperations.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              <button type="button" className="font-semibold underline" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="button-toggle-unconfirmed">{ws.unconfirmedOperations.length} niepotwierdzonych operacji API</button>
              {open && <ul className="mt-1 font-data">{ws.unconfirmedOperations.map((o) => <li key={o}>{o}</li>)}</ul>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function useMcodWs() {
  const { user } = useSession();
  return useGetMcodWorkspace({ query: { queryKey: getGetMcodWorkspaceQueryKey(), enabled: !!user } });
}

export function WsBody({ children }: { children: (ws: McodWorkspace) => ReactNode }) {
  const ws = useMcodWs();
  if (ws.isLoading) return <ListSkeleton />;
  if (ws.error || !ws.data) return <ErrorState error={ws.error} onRetry={() => ws.refetch()} />;
  return <div className="space-y-6">{children(ws.data)}</div>;
}

export function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getGetMcodWorkspaceQueryKey() });
    qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
  };
}

export function useErr() {
  const { toast } = useToast();
  return (title: string) => (e: unknown) => toast({ title, description: errorText(e), variant: 'destructive' });
}

export function EventsList({ ws }: { ws: McodWorkspace }) {
  if (!ws.events.length) return null;
  return (
    <Section title="Historia">
      <ol className="space-y-2 border-l-2 pl-4">{ws.events.slice(0, 15).map((e) => <li key={e.id} className="text-sm"><span className="font-medium">{str(e, 'action') || e.status || e.title}</span> <span className="text-xs text-muted-foreground">{new Date(str(e, 'createdAt')).toLocaleString('pl-PL')}</span></li>)}</ol>
    </Section>
  );
}
