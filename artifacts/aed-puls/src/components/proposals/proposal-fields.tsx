import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Draft } from '@/lib/proposals';

type Key = keyof Draft;

function F({ label, children, span }: { label: string; children: ReactNode; span?: boolean }) {
  return <div className={span ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}><Label>{label}</Label>{children}</div>;
}

/** Edytowalne pola AED. `locked` blokuje pola lokalizacji (np. zgłoszenia GPS). */
export function ProposalFields({ value, onChange, locked = false, showSourceUrl = false, idPrefix = 'input' }: {
  value: Draft; onChange: (d: Draft) => void; locked?: boolean; showSourceUrl?: boolean; idPrefix?: string;
}) {
  const set = (k: Key) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const txt = (k: Key, label: string, ph = '', opts: { span?: boolean; mono?: boolean; lock?: boolean } = {}) => (
    <F label={label} span={opts.span}>
      <Input value={value[k]} onChange={set(k)} placeholder={opts.lock && locked ? 'Uzupełniane z GPS' : ph} readOnly={opts.lock && locked}
        className={opts.mono ? 'font-data' : ''} data-testid={`${idPrefix}-${k}`} />
    </F>
  );
  const sel = (k: 'placement' | 'accessibility', label: string, items: [string, string][]) => (
    <F label={label}>
      <select value={value[k]} onChange={set(k)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid={`${idPrefix}-${k}`}>
        {items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </F>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {txt('name', 'Nazwa miejsca', 'np. Urząd Dzielnicy Mokotów', { span: true })}
      {txt('address', 'Ulica i numer', 'ul. Rakowiecka 25/27', { lock: true })}
      {txt('city', 'Miejscowość', 'Warszawa', { lock: true })}
      {txt('postalCode', 'Kod pocztowy', '02-517', { lock: true })}
      {txt('voivodeship', 'Województwo', 'mazowieckie', { lock: true })}
      {txt('latitude', 'Szerokość geograficzna', '52.196000', { mono: true, lock: true })}
      {txt('longitude', 'Długość geograficzna', '21.005000', { mono: true, lock: true })}
      <F label="Opis lokalizacji" span>
        <Textarea rows={3} value={value.description} onChange={set('description')} placeholder="np. parter, przy portierni" data-testid={`${idPrefix}-description`} />
      </F>
      {sel('placement', 'Umiejscowienie', [['indoor', 'Wewnątrz budynku'], ['outdoor', 'Na zewnątrz'], ['unknown', 'Nie wiem']])}
      {sel('accessibility', 'Dostęp', [['24/7', 'Całodobowo (24/7)'], ['limited', 'W określonych godzinach'], ['unknown', 'Nie wiem']])}
      {value.accessibility === '24/7'
        ? <p className="text-sm text-muted-foreground sm:col-span-2">Godziny dostępu zostaną zapisane jako 24/7.</p>
        : txt('openingHours', 'Godziny dostępu', 'pn–pt 8:00–16:00', { span: true })}
      {showSourceUrl && txt('sourceUrl', 'Adres źródła (opcjonalnie)', 'https://', { span: true })}
    </div>
  );
}
