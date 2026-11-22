import { LICENSES } from '@/lib/proposals';
import { cn } from '@/lib/utils';

export function LicenseChoice({ value, onChange, consent, onConsent, allowUnknown = true, showConsent = true }: {
  value: string; onChange: (v: string) => void; consent: boolean; onConsent: (v: boolean) => void; allowUnknown?: boolean; showConsent?: boolean;
}) {
  const opts = LICENSES.filter((l) => allowUnknown || l.value !== 'UNKNOWN');
  const known = value !== 'UNKNOWN';
  return (
    <div className="space-y-3 sm:col-span-2">
      <div role="radiogroup" aria-label="Licencja danych" className="grid gap-2 sm:grid-cols-2">
        {opts.map((l) => (
          <label key={l.value} className={cn('cursor-pointer rounded-xl border p-3 text-sm transition-colors', value === l.value ? 'border-primary bg-accent' : 'hover:bg-muted')}>
            <span className="flex items-center gap-2 font-semibold">
              <input type="radio" name="license" value={l.value} checked={value === l.value} onChange={() => { onChange(l.value); onConsent(false); }} className="accent-primary" data-testid={`radio-license-${l.value}`} />
              {l.label}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{l.text}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Licencja dotyczy Twojego zgłoszenia. Adresy ustalone przez Geoapify zachowują oznaczenie © współtwórcy OpenStreetMap (ODbL) niezależnie od wybranej licencji.</p>
      {showConsent && known && (
        <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => onConsent(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" data-testid="checkbox-license-consent" />
          <span>Potwierdzam, że organizacja ma prawo udostępnić te dane na licencji {LICENSES.find((l) => l.value === value)?.label} i zgadza się na ich publikację po weryfikacji.</span>
        </label>
      )}
    </div>
  );
}
