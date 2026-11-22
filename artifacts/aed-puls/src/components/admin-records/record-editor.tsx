import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Loader2, MapPinOff } from 'lucide-react';
import {
  getGetAdminRecordHistoryQueryKey, getGetStatsQueryKey, getGetWorkspaceQueryKey, getListAdminRecordsQueryKey,
  useUpdateAdminRecord, type AdminRecordUpdateInput, type Aed,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { formatDate } from '@/components/aed-bits';
import { RecordHistory } from './record-history';
import { StatusPills } from './status-pills';
import { SENTINEL, editorialStatus, errorMessage, fieldLabel, hasLocation } from './record-utils';

type TextKey = 'name' | 'address' | 'city' | 'postalCode' | 'description' | 'openingHours';
type Form = Record<TextKey | 'latitude' | 'longitude' | 'accessibility' | 'placement', string>;

const shown = (v: unknown) => (typeof v === 'string' && v.trim().toUpperCase() !== SENTINEL ? v : '');

function initial(a: Aed): Form {
  return {
    name: shown(a.name), address: shown(a.address), city: shown(a.city), postalCode: shown(a.postalCode),
    description: shown(a.description), openingHours: shown(a.openingHours),
    latitude: typeof a.latitude === 'number' ? String(a.latitude) : '',
    longitude: typeof a.longitude === 'number' ? String(a.longitude) : '',
    accessibility: a.accessibility ?? 'unknown', placement: a.placement ?? 'unknown',
  };
}

function parseCoord(s: string): number | null | 'invalid' {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : 'invalid';
}

export function RecordEditor({ aed: initialAed, onPendingChange, onClose }: { aed: Aed; onPendingChange: (p: boolean) => void; onClose: () => void }) {
  // A background list refresh must not silently advance the optimistic-lock token
  // beneath unsaved edits. Only this editor's own successful save advances it.
  const [aed,setAed]=useState(initialAed);
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateAdminRecord();
  const base = useMemo(() => initial(aed), [aed]);
  const [form, setForm] = useState<Form>(base);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const pending = update.isPending;
  const geocoding=aed.locationEvidence?.geocodingStatus;
  const geocodingLabels:Record<string,string>={
    RESOLVED:'Wiarygodne dopasowanie adresu do budynku; nie potwierdza urządzenia.',
    UNRESOLVED:'Brak wystarczająco pewnego dopasowania — punkt pozostał poza mapą.',
    AMBIGUOUS:'Kilka możliwych lokalizacji — wymagana decyzja administratora.',
    INSUFFICIENT_ADDRESS:'Brak adresu umożliwiającego wyszukanie lokalizacji.',
    PROVIDER_ERROR:'Usługa geokodowania nie odpowiedziała poprawnie. Dane zachowano; próba zostanie ponowiona.',
  };

  const set = (k: keyof Form) => (v: string) => { setForm((f) => ({ ...f, [k]: v })); setSaved(null); };
  const dirty = (Object.keys(form) as (keyof Form)[]).filter((k) => form[k] !== base[k]);

  const lat = parseCoord(form.latitude);
  const lon = parseCoord(form.longitude);
  const coordErr =
    lat === 'invalid' || lon === 'invalid' ? 'Współrzędne muszą być liczbami.'
    : (lat === null) !== (lon === null) ? 'Podaj obie współrzędne albo zostaw obie puste. Nie zapisujemy połowy lokalizacji.'
    : lat !== null && (lat < 49 || lat > 55) ? 'Szerokość poza Polską (49–55).'
    : lon !== null && (lon < 14 || lon > 24.2) ? 'Długość poza Polską (14–24,2).'
    : null;
  const locationChanged = dirty.includes('latitude') || dirty.includes('longitude') || dirty.includes('address') || dirty.includes('city') || dirty.includes('postalCode');
  const editorial = editorialStatus(aed.verificationStatus);

  const buildPayload = (): AdminRecordUpdateInput => {
    const d: AdminRecordUpdateInput = { expectedUpdatedAt: aed.revision ?? aed.updatedAt };
    for (const k of dirty) {
      const v = form[k];
      if (k === 'name' || k === 'address' || k === 'city') d[k] = v.trim();
      else if (k === 'postalCode' || k === 'description' || k === 'openingHours') d[k] = v.trim() === '' ? null : v.trim();
      else if (k === 'accessibility') d.accessibility = v as AdminRecordUpdateInput['accessibility'];
      else if (k === 'placement') d.placement = v as AdminRecordUpdateInput['placement'];
    }
    if (dirty.includes('latitude') || dirty.includes('longitude')) {
      d.latitude = lat === 'invalid' ? null : lat;
      d.longitude = lon === 'invalid' ? null : lon;
    }
    return d;
  };

  const save = async () => {
    setError(null);
    onPendingChange(true);
    try {
      const updated=await update.mutateAsync({ id: aed.id, data: buildPayload() });
      setAed(updated);
      setForm(initial(updated));
      setConfirm(false);
      setSaved(`Zapisano ${dirty.length} ${dirty.length === 1 ? 'pole' : 'pola'}. Status redakcyjny: ${editorial === 'REJECTED' ? 'nadal odrzucony' : 'niezweryfikowany'}.`);
      toast({ title: 'Zmiany zapisane', description: shown(aed.name) || aed.id });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListAdminRecordsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetAdminRecordHistoryQueryKey(aed.id) }),
        qc.invalidateQueries({ queryKey: getGetStatsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() }),
        qc.invalidateQueries({ queryKey: [`/api/aeds/${aed.id}`] }),
      ]);
    } catch (e) {
      setConfirm(false);
      setError(errorMessage(e));
      // Keep this draft and its old revision intact, but make reopening load
      // the current server version after a concurrent-write rejection.
      void qc.invalidateQueries({queryKey:getListAdminRecordsQueryKey()});
    } finally {
      onPendingChange(false);
    }
  };

  const text = (k: TextKey, max: number, area = false) => {
    const raw = aed[k as keyof Aed];
    const isSentinel = typeof raw === 'string' && raw.trim().toUpperCase() === SENTINEL;
    const id = `edit-${k}`;
    return (
      <div className={area ? 'sm:col-span-2' : undefined}>
        <Label htmlFor={id} className="text-xs font-semibold">{fieldLabel[k]}{dirty.includes(k) && <span className="ml-1 text-primary">· zmienione</span>}</Label>
        {area
          ? <Textarea id={id} value={form[k]} maxLength={max} disabled={pending} onChange={(e) => set(k)(e.target.value)} placeholder="brak danych" className="mt-1" rows={2} data-testid={`input-${k}`} />
          : <Input id={id} value={form[k]} maxLength={max} disabled={pending} onChange={(e) => set(k)(e.target.value)} placeholder="brak danych" className="mt-1" data-testid={`input-${k}`} />}
        {isSentinel && !dirty.includes(k) && <p className="mt-1 text-[11px] text-muted-foreground">Źródło ma znacznik UNKNOWN. Zostanie zachowany, dopóki nie wpiszesz wartości.</p>}
      </div>
    );
  };

  const select = (k: 'accessibility' | 'placement', opts: [string, string][]) => (
    <div>
      <Label htmlFor={`edit-${k}`} className="text-xs font-semibold">{fieldLabel[k]}{dirty.includes(k) && <span className="ml-1 text-primary">· zmienione</span>}</Label>
      <select id={`edit-${k}`} value={form[k]} disabled={pending} onChange={(e) => set(k)(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid={`select-${k}`}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );

  const prov = aed.provenance ?? [];

  return (
    <div className="space-y-6" data-testid={`editor-${aed.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-data text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Rekord {aed.id}</p>
          <StatusPills aed={aed} className="mt-2" />
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link href={`/aed/${aed.id}`} data-testid="link-provenance">Karta i pochodzenie <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={onClose} data-testid="button-close-editor">Zamknij</Button>
        </div>
      </div>

      <div className="rounded-xl border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        Uzupełniony adres importowanego AED bez współrzędnych może zostać wysłany do Geoapify. Tylko jednoznaczne dopasowanie do konkretnego budynku może uzupełnić lokalizację. Nie oznacza to weryfikacji AED. Próby są automatyczne, z pamięcią wyników i limitem 25 nowych zapytań dziennie.
        {typeof geocoding==='string'&&<p className="mt-2 font-medium text-foreground">Geokodowanie: {geocodingLabels[geocoding]??geocoding}</p>}
      </div>
      <section aria-labelledby="prov-h" className="rounded-xl border bg-muted/40 p-3 text-xs">
        <h3 id="prov-h" className="font-semibold uppercase tracking-wider text-muted-foreground">Źródło i licencja · tylko do odczytu</h3>
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">Źródło</dt><dd className="break-words font-medium">{aed.sourceName}</dd>
          <dt className="text-muted-foreground">Licencja</dt><dd className="font-data">{aed.license}</dd>
          {aed.sourceUrl && <><dt className="text-muted-foreground">Adres źródła</dt><dd className="break-all"><a href={aed.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">{aed.sourceUrl}</a></dd></>}
          {prov.length > 0 && <><dt className="text-muted-foreground">Publikacje</dt><dd>{prov.map((p) => `${p.sourceName} (${p.license}, import ${formatDate(p.importedAt)})`).join('; ')}</dd></>}
        </dl>
        <p className="mt-2 text-muted-foreground">Oryginalna obserwacja źródła nie jest modyfikowana. Edycja tworzy warstwę redakcyjną z pełną historią.</p>
      </section>

      {!hasLocation(aed) && (
        <p className="flex gap-2 rounded-xl border border-primary/30 bg-accent p-3 text-sm text-accent-foreground" data-testid="text-no-location">
          <MapPinOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Brak lokalizacji. Rekord nie pojawia się na publicznej mapie. Wpisz współrzędne tylko z wiarygodnego potwierdzenia, nigdy szacunkowe.
        </p>
      )}

      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (dirty.length && !coordErr) setConfirm(true); }}>
        {text('name', 160)}{text('city', 120)}
        {text('address', 240)}{text('postalCode', 10)}
        <div>
          <Label htmlFor="edit-latitude" className="text-xs font-semibold">{fieldLabel.latitude}{dirty.includes('latitude') && <span className="ml-1 text-primary">· zmienione</span>}</Label>
          <Input id="edit-latitude" inputMode="decimal" value={form.latitude} disabled={pending} onChange={(e) => set('latitude')(e.target.value)} placeholder="brak danych" className="mt-1 font-data" aria-invalid={!!coordErr} aria-describedby="coord-help" data-testid="input-latitude" />
        </div>
        <div>
          <Label htmlFor="edit-longitude" className="text-xs font-semibold">{fieldLabel.longitude}{dirty.includes('longitude') && <span className="ml-1 text-primary">· zmienione</span>}</Label>
          <Input id="edit-longitude" inputMode="decimal" value={form.longitude} disabled={pending} onChange={(e) => set('longitude')(e.target.value)} placeholder="brak danych" className="mt-1 font-data" aria-invalid={!!coordErr} aria-describedby="coord-help" data-testid="input-longitude" />
        </div>
        <p id="coord-help" className={`sm:col-span-2 -mt-2 text-xs ${coordErr ? 'font-semibold text-destructive' : 'text-muted-foreground'}`} role={coordErr ? 'alert' : undefined}>
          {coordErr ?? 'Puste pola oznaczają brak lokalizacji (null), nie zero.'}
        </p>
        {select('accessibility', [['24/7', 'Całodobowo'], ['limited', 'Ograniczona'], ['unknown', 'Nieznana']])}
        {select('placement', [['indoor', 'Wewnątrz'], ['outdoor', 'Na zewnątrz'], ['unknown', 'Nieznane']])}
        {text('openingHours', 200, true)}
        {text('description', 2000, true)}

        <div className="sm:col-span-2 space-y-3 border-t pt-4">
          {error && <div role="alert" className="flex gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="text-save-error"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</div>}
          {saved && <p role="status" className="rounded-xl border border-verified/40 p-3 text-sm text-verified" data-testid="text-save-success">{saved}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground" aria-live="polite">{dirty.length ? `Zmienione pola: ${dirty.map((k) => fieldLabel[k]).join(', ')}` : 'Brak niezapisanych zmian.'}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={!dirty.length || pending} onClick={() => { setForm(base); setError(null); }} data-testid="button-reset">Cofnij zmiany</Button>
              <Button type="submit" disabled={!dirty.length || !!coordErr || pending} data-testid="button-save">
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{pending ? 'Zapisywanie…' : 'Zapisz zmiany'}
              </Button>
            </div>
          </div>
        </div>
      </form>

      <section aria-labelledby="hist-h">
        <h3 id="hist-h" className="mb-3 font-display text-lg font-bold">Historia zmian</h3>
        <RecordHistory id={aed.id} />
      </section>

      <AlertDialog open={confirm} onOpenChange={(o) => { if (!pending) setConfirm(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Zapisać {dirty.length} {dirty.length === 1 ? 'zmianę' : 'zmiany'}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Edycja nie zatwierdza rekordu ani nie potwierdza sprawności urządzenia.</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>{editorial === 'REJECTED' ? 'Rekord pozostaje odrzucony.' : `Status redakcyjny zmieni się na Niezweryfikowany${editorial === 'VERIFIED' ? ' (rekord wymaga ponownej weryfikacji)' : ''}.`}</li>
                  {locationChanged && <li>Zmiana lokalizacji lub adresu resetuje także weryfikację fizyczną urządzenia.</li>}
                  <li>Źródło, licencja i oryginalna obserwacja pozostają bez zmian; zapis trafi do historii.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Anuluj</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={(e) => { e.preventDefault(); void save(); }} data-testid="button-confirm-save">
              {pending ? 'Zapisywanie…' : 'Zapisz'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
