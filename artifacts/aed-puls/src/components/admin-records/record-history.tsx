import { getGetAdminRecordHistoryQueryKey, useGetAdminRecordHistory } from '@workspace/api-client-react';
import { ErrorState, formatDate } from '@/components/aed-bits';
import { display, fieldLabel } from './record-utils';

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : undefined);

export function RecordHistory({ id }: { id: string }) {
  const h = useGetAdminRecordHistory(id, { query: { enabled: !!id, queryKey: getGetAdminRecordHistoryQueryKey(id) } });
  if (h.isLoading) return <div className="space-y-2" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>;
  if (h.error) return <ErrorState error={h.error} onRetry={() => h.refetch()} title="Nie udało się wczytać historii" />;
  const events = h.data ?? [];
  if (!events.length) return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground" data-testid="text-history-empty">Brak zapisanych zmian. Rekord jest w stanie z importu lub zgłoszenia.</p>;
  return (
    <ol className="space-y-3 border-l-2 pl-4" data-testid="list-history">
      {events.map((ev) => {
        const before = asDict(ev.details.before) ?? {};
        const after = asDict(ev.details.after) ?? {};
        const changed = Array.isArray(ev.details.changedFields)
          ? (ev.details.changedFields as unknown[]).map(String)
          : Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
        const extra = Object.entries(ev.details).filter(([k, v]) => !['before', 'after', 'changedFields'].includes(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'));
        return (
          <li key={ev.id} className="rounded-xl border bg-card p-3 text-sm" data-testid={`history-event-${ev.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">{ev.action}</p>
              <time className="font-data text-xs text-muted-foreground" dateTime={ev.createdAt}>{formatDate(ev.createdAt)}</time>
            </div>
            {changed.length > 0 && (
              <table className="mt-2 w-full text-xs">
                <caption className="sr-only">Zmienione pola</caption>
                <thead className="text-muted-foreground"><tr><th scope="col" className="py-1 pr-2 text-left font-medium">Pole</th><th scope="col" className="py-1 pr-2 text-left font-medium">Przed</th><th scope="col" className="py-1 text-left font-medium">Po</th></tr></thead>
                <tbody className="divide-y">
                  {changed.map((f) => (
                    <tr key={f} className="align-top">
                      <td className="py-1 pr-2 font-medium">{fieldLabel[f] ?? f}</td>
                      <td className="py-1 pr-2 text-muted-foreground line-through decoration-primary/50 break-words">{f in before ? display(before[f]) : '—'}</td>
                      <td className="py-1 break-words">{f in after ? display(after[f]) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {extra.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{extra.map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</p>}
          </li>
        );
      })}
    </ol>
  );
}
