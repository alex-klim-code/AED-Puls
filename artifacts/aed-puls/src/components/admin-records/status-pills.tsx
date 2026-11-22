import type { Aed } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { editorialLabel, editorialStatus, hasLocation } from './record-utils';

const pill = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold';

export function StatusPills({ aed, className }: { aed: Aed; className?: string }) {
  const ed = editorialStatus(aed.verificationStatus);
  const complete = aed.completenessStatus === 'COMPLETE';
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      <span className={cn(pill, ed === 'VERIFIED' ? 'border-verified/40 text-verified' : ed === 'REJECTED' ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'text-muted-foreground')} title={ed} data-testid={`status-editorial-${aed.id}`}>{editorialLabel[ed]}</span>
      <span className={cn(pill, complete ? 'text-muted-foreground' : 'border-warn/40 text-warn')} title={aed.completenessStatus ?? 'INCOMPLETE'} data-testid={`status-complete-${aed.id}`}>{complete ? 'Kompletny' : 'Niekompletny'}</span>
      {!hasLocation(aed) && <span className={cn(pill, 'border-primary/40 bg-accent text-accent-foreground')}>Brak lokalizacji</span>}
    </div>
  );
}
