import { useEffect, useRef } from 'react';
import { Scale } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LICENSE_IDS, type LicenseId } from '@/lib/export-download';

const licenseMeta: Record<LicenseId, { label: string; d: string }> = {
  'CC0-1.0': { label: 'CC0', d: 'Deklaracja domeny publicznej' },
  'CC-BY-4.0': { label: 'CC BY 4.0', d: 'Wymaga uznania autorstwa' },
  'ODbL-1.0': { label: 'ODbL 1.0', d: 'Uznanie autorstwa, share-alike bazy danych' },
};

export function LicenseFieldset({ selected, busy, onToggle, onSetAll }: {
  selected: ReadonlySet<LicenseId>; busy: boolean; onToggle: (l: LicenseId) => void; onSetAll: (all: boolean) => void;
}) {
  const count = LICENSE_IDS.filter((l) => selected.has(l)).length;
  const allLic = count === LICENSE_IDS.length;
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = count > 0 && !allLic; }, [count, allLic]);
  const licSet = selected;
  const toggleLic = onToggle;
  const licenses = { length: count };
  return (
        <fieldset disabled={busy} className="mt-6 rounded-2xl border bg-card p-5" data-testid="fieldset-licenses">
          <legend className="sr-only">Licencje danych</legend>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <p className="inline-flex items-center gap-2 text-sm font-semibold"><Scale className="h-4 w-4" /> Licencje danych źródłowych</p>
              <p className="mt-1 text-xs text-muted-foreground">Wybór wielokrotny. Filtr wybiera publikacje o deklarowanej licencji źródła; nie zmienia licencji i nie usuwa obowiązków wynikających z połączonych źródeł. Brak wyboru blokuje podgląd i pobieranie.</p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:border-foreground">
              <input ref={allRef} type="checkbox" checked={allLic} onChange={() => onSetAll(!allLic)}
                className="h-4 w-4 accent-[hsl(var(--primary))]" data-testid="checkbox-license-all" />
              Wszystkie dostępne licencje
            </label>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {LICENSE_IDS.map((l) => (
              <label key={l} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors', licSet.has(l) ? 'border-foreground bg-muted/40' : 'hover:border-foreground')} data-testid={`row-license-${l}`}>
                <input type="checkbox" checked={licSet.has(l)} onChange={() => toggleLic(l)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" data-testid={`checkbox-license-${l}`} />
                <span><span className="block text-sm font-semibold">{licenseMeta[l].label}</span><span className="font-data text-[11px] text-muted-foreground">{l}</span><span className="block text-xs text-muted-foreground">{licenseMeta[l].d}</span></span>
              </label>
            ))}
          </div>
          {licenses.length === 0 && <p role="alert" className="mt-3 text-xs font-medium text-primary" data-testid="text-no-license">Nie wybrano żadnej licencji. Zaznacz co najmniej jedną — pusty wybór nigdy nie oznacza „wszystkich”.</p>}
        </fieldset>
  );
}
