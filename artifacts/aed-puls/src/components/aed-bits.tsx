import type { ReactNode } from 'react';
import type { Aed } from '@workspace/api-client-react';
import { AlertTriangle, CheckCircle2, Clock3, FlaskConical, Phone, RotateCcw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export const accessibilityLabel: Record<string, string> = {
  '24/7': 'Całodobowo (deklaracja źródła)',
  limited: 'Dostęp ograniczony',
  unknown: 'Dostępność nieznana',
};
export const placementLabel: Record<string, string> = {
  indoor: 'Wewnątrz budynku',
  outdoor: 'Na zewnątrz',
  unknown: 'Umiejscowienie nieznane',
};
export const verificationLabel: Record<string, string> = {
  VERIFIED: 'Zweryfikowany',
  NOT_VERIFIED: 'Niezweryfikowany',
  REJECTED: 'Odrzucony',
  pending: 'Oczekuje na weryfikację',
  verified: 'Opis zatwierdzony',
  rejected: 'Odrzucony',
  unverified: 'Import — niezweryfikowany',
};

export function formatDate(v?: string | null) {
  if (!v) return 'brak danych';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 'nieprawidłowa data';
  return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateTime(v?: string | null) {
  if (!v || Number.isNaN(new Date(v).getTime())) return formatDate(v);
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Warsaw',
  }).format(new Date(v));
}

export function VerificationBadge({ status }: { status: string }) {
  const map = {
    verified: { icon: CheckCircle2, cls: 'bg-[hsl(var(--verified)/0.1)] text-verified border-[hsl(var(--verified)/0.35)]' },
    pending: { icon: Clock3, cls: 'bg-amber-50 text-warn border-amber-300' },
    rejected: { icon: XCircle, cls: 'bg-accent text-accent-foreground border-primary/30' },
    unverified: { icon: Clock3, cls: 'bg-blue-50 text-blue-700 border-blue-300' },
  } as const;
  const key=status==='VERIFIED'?'verified':status==='REJECTED'?'rejected':status==='NOT_VERIFIED'?'unverified':status;
  const m = map[key as keyof typeof map] ?? map.pending;
  const Icon = m.icon;
  return (
    <span data-testid={`status-verification-${status}`} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold', m.cls)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {verificationLabel[status] ?? status}
    </span>
  );
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border border-dashed border-foreground/40 bg-[repeating-linear-gradient(135deg,transparent_0_6px,hsl(var(--muted))_6px_12px)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-foreground', className)}>
      <FlaskConical className="h-3 w-3" aria-hidden /> Demo — nie do ratowania
    </span>
  );
}

export function QualityMeter({ score, compact }: { score: number; compact?: boolean }) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const tone = s >= 80 ? 'bg-verified' : s >= 50 ? 'bg-amber-500' : 'bg-primary';
  return (
    <div className={cn('flex items-center gap-2', compact ? 'min-w-[110px]' : 'w-full')}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s} aria-label="Kompletność i wiarygodność danych">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${s}%` }} />
      </div>
      <span className="font-data text-xs font-medium tabular-nums">{s}/100</span>
    </div>
  );
}

export function EmergencyNotice({ className }: { className?: string }) {
  return (
    <div role="note" className={cn('flex items-start gap-3 rounded-xl border border-primary/30 bg-accent p-4 text-sm text-accent-foreground', className)}>
      <Phone className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
      <p>
        <strong className="font-bold">W nagłym zatrzymaniu krążenia dzwoń 112.</strong> Postępuj zgodnie z poleceniami dyspozytora. Mapa nie gwarantuje dostępności ani sprawności urządzenia.
      </p>
    </div>
  );
}

export function AedWarnings({ aed }: { aed: Aed }) {
  const items: string[] = [];
  if (aed.isDemo) items.push('To rekord demonstracyjny. Nie wskazuje prawdziwego urządzenia i nie może być użyty w akcji ratunkowej.');
  if (aed.accessibility === 'unknown') items.push('Dostępność urządzenia jest nieznana — może być zamknięte lub niedostępne.');
  if (aed.accessibility === '24/7') items.push('Dostęp całodobowy to deklaracja źródła, nie potwierdzenie platformy.');
  if (!['verified','VERIFIED'].includes(aed.verificationStatus)) items.push('Opis nie został jeszcze zatwierdzony redakcyjnie.');
  if (!aed.verifiedAt) items.push('Brak daty potwierdzonej oceny urządzenia.');
  if (!aed.recordVerificationStatus || aed.recordVerificationStatus === 'UNVERIFIED') items.push('Pochodzenie danych nie potwierdza fizycznej weryfikacji AED.');
  if (!items.length) return null;
  return (
    <ul className="space-y-1.5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-[hsl(32_80%_22%)]" aria-label="Ostrzeżenia dotyczące rekordu">
      {items.map((t) => (
        <li key={t} className="flex gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          {t}
        </li>
      ))}
    </ul>
  );
}

export function ErrorState({ error, onRetry, title = 'Nie udało się wczytać danych' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="rounded-xl border border-primary/30 bg-card p-6">
      <p className="font-display text-lg font-bold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : 'Serwer zwrócił błąd.'}</p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry} data-testid="button-retry">
          <RotateCcw className="mr-2 h-4 w-4" /> Spróbuj ponownie
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed bg-card/60 p-8">
      <svg viewBox="0 0 120 24" className="h-6 w-28 text-muted-foreground/60" aria-hidden>
        <path d="M0 12h40l6-9 8 18 6-12 4 3h56" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="font-display text-lg font-bold">{title}</p>
      {children && <div className="max-w-prose text-sm text-muted-foreground">{children}</div>}
      {action}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Wczytywanie">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function directionsUrl(aed: Pick<Aed, 'latitude' | 'longitude'>) {
  if(aed.latitude==null||aed.longitude==null)return undefined;
  return `https://www.openstreetmap.org/directions?route=%3B${aed.latitude}%2C${aed.longitude}#map=17/${aed.latitude}/${aed.longitude}`;
}
