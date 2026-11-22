import { Link } from 'wouter';
import type { Aed } from '@workspace/api-client-react';
import { ArrowUpRight } from 'lucide-react';
import { DemoBadge, QualityMeter, VerificationBadge, accessibilityLabel, formatDate } from '@/components/aed-bits';
import type { ReactNode } from 'react';

/** Tabela rekordów; na telefonach zamienia się w listę kart. */
export function RecordsTable({ records, actions }: { records: Aed[]; actions?: (a: Aed) => ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Lista rekordów AED</caption>
        <thead className="hidden bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground md:table-header-group">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">Lokalizacja</th>
            <th scope="col" className="px-4 py-3 font-semibold">Status</th>
            <th scope="col" className="px-4 py-3 font-semibold">Jakość danych</th>
            <th scope="col" className="px-4 py-3 font-semibold">Aktualizacja</th>
            <th scope="col" className="px-4 py-3 font-semibold"><span className="sr-only">Akcje</span></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {records.map((a) => (
            <tr key={a.id} className="grid gap-3 p-4 md:table-row md:p-0" data-testid={`row-aed-${a.id}`}>
              <td className="md:px-4 md:py-4">
                <Link href={`/aed/${a.id}`} className="group inline-flex items-start gap-1 font-semibold hover:text-primary">
                  {a.name}
                  <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 opacity-50 group-hover:opacity-100" aria-hidden />
                </Link>
                <p className="text-muted-foreground">{a.address}, {a.city}</p>
                <p className="mt-1 text-xs text-muted-foreground">{accessibilityLabel[a.accessibility] ?? a.accessibility}</p>
                {a.isDemo && <DemoBadge className="mt-2" />}
              </td>
              <td className="md:px-4 md:py-4"><VerificationBadge status={a.verificationStatus} /></td>
              <td className="md:px-4 md:py-4"><QualityMeter score={a.qualityScore} compact /></td>
              <td className="text-muted-foreground md:px-4 md:py-4">{formatDate(a.updatedAt)}</td>
              <td className="md:px-4 md:py-4 md:text-right">{actions?.(a)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KpiCard({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: string; tone?: 'default' | 'red' | 'green' }) {
  const bar = tone === 'red' ? 'bg-primary' : tone === 'green' ? 'bg-verified' : 'bg-foreground';
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-5">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} aria-hidden />
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold tabular-nums" data-testid={`text-kpi-${label}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
