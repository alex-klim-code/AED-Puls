import type { ReactNode } from 'react';
import { proposalStatus, statusLabelFor } from '@/lib/proposals';
import { cn } from '@/lib/utils';

export function StatusTag({ status, kind = 'AED' }: { status: string; kind?: 'AED' | 'ERROR' }) {
  const s = proposalStatus[status] ?? { label: status, cls: 'bg-muted' };
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', s.cls)} data-testid={`status-${status}`}>
      {statusLabelFor(status, kind)}<span className="font-data text-[10px] font-normal opacity-70">{status}</span>
    </span>
  );
}

export function Pager({ page, total, size = 50, busy, onPage }: { page: number; total: number; size?: number; busy?: boolean; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
      <button type="button" className="rounded-lg border px-3 py-1.5 disabled:opacity-40" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)} data-testid="button-page-prev">Poprzednia</button>
      <span className="font-data text-xs text-muted-foreground">Strona {page} z {pages}</span>
      <button type="button" className="rounded-lg border px-3 py-1.5 disabled:opacity-40" disabled={page >= pages || busy} onClick={() => onPage(page + 1)} data-testid="button-page-next">Następna</button>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: NoInfer<T>; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="mb-5 flex flex-wrap gap-1 rounded-xl border bg-card p-1">
      {items.map((i) => (
        <button key={i.value} type="button" role="tab" aria-selected={value === i.value} onClick={() => onChange(i.value)}
          className={cn('rounded-lg px-3 py-2 text-sm font-medium transition-colors', value === i.value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted')}
          data-testid={`tab-${i.value}`}>{i.label}</button>
      ))}
    </div>
  );
}
