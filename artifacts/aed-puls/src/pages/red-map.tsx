import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Crosshair, Info, Loader2, Phone, Play } from 'lucide-react';
import {
  getGetRedMapStatusQueryKey,
  useAnalyseRedMap,
  useGetRedMapStatus,
  type RedMapAnalysis,
  type RedMapAreaInput,
} from '@workspace/api-client-react';
import { WorkspaceLayout } from '@/components/layout';
import { RedCoverageMap, type Centre } from '@/components/red-coverage-map';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSession } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

const SIZES: RedMapAreaInput['sizeKm'][] = [2, 4, 6];
const inPoland = (c: Centre | null) => !!c && c.latitude >= 49 && c.latitude <= 55 && c.longitude >= 14 && c.longitude <= 24.2;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Nieznany błąd analizy.');

export default function RedMapPage() {
  return (
    <WorkspaceLayout roles={['PROVIDER', 'ADMIN']} title="Czerwona mapa zasięgu AED" kicker="Planowanie rozmieszczenia">
      <RedMapContent />
    </WorkspaceLayout>
  );
}

function RedMapContent() {
  const { user } = useSession();
  const qc = useQueryClient();
  const statusKey = [...getGetRedMapStatusQueryKey(), user?.id ?? 'anon'] as const;
  const status = useGetRedMapStatus({ query: { queryKey: statusKey, refetchInterval: false } });
  const analyse = useAnalyseRedMap();

  const [centre, setCentre] = useState<Centre | null>(null);
  const [zoomOk, setZoomOk] = useState(false);
  const [sizeKm, setSizeKm] = useState<RedMapAreaInput['sizeKm']>(4);
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');
  const [result, setResult] = useState<RedMapAnalysis | null>(null);

  const onMapCentre = (c: Centre) => {
    setCentre(c);
    setZoomOk(true);
    setLatText(c.latitude.toFixed(5));
    setLngText(c.longitude.toFixed(5));
  };
  const applyCoords = () => {
    const c = { latitude: Number(latText.replace(',', '.')), longitude: Number(lngText.replace(',', '.')) };
    if (Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) { setCentre(c); setZoomOk(true); }
  };

  const st = status.data;
  const valid = inPoland(centre) && zoomOk;
  const canRun = valid && !!st?.configured && st.dailyRemaining > 0 && !analyse.isPending;

  const run = () => {
    if (!centre || !canRun) return;
    setResult(null);
    analyse.mutate(
      { data: { latitude: centre.latitude, longitude: centre.longitude, sizeKm } },
      {
        onSuccess: (r) => setResult(r),
        onSettled: () => qc.invalidateQueries({ queryKey: getGetRedMapStatusQueryKey() }),
      },
    );
  };

  const shown = analyse.isPending || analyse.isError ? null : result;
  const minutes = Math.round((st?.seconds ?? 1800) / 60);

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
        Wybierz lokalny obszar w Polsce, a system oszacuje, dokąd da się dojść pieszo <strong className="text-foreground">od</strong> każdego AED z naszej bazy w {minutes} minut.
        Na czerwono zaznaczamy miejsca w analizowanym kwadracie poza tym modelowanym zasięgiem.
      </p>

      <section aria-labelledby="quota" className="grid gap-3 sm:grid-cols-3">
        <h2 id="quota" className="sr-only">Limit zapytań</h2>
        {status.isLoading ? (
          [0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)
        ) : status.isError ? (
          <div role="alert" className="rounded-xl border bg-card p-4 sm:col-span-3">
            <p className="font-semibold">Nie udało się pobrać stanu usługi.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => status.refetch()} data-testid="button-retry-status">Spróbuj ponownie</Button>
          </div>
        ) : st ? (
          <>
            <Stat label="Usługa izolinii" value={st.configured ? 'skonfigurowana' : 'niedostępna'} tone={st.configured ? 'ok' : 'bad'} testid="status-configured" />
            <Stat label="Pozostało dziś zapytań" value={String(st.dailyRemaining)} tone={st.dailyRemaining > 0 ? 'ok' : 'bad'} testid="text-daily-remaining" />
            <Stat label="Maks. nowych zapytań na analizę" value={String(st.maxNewRequests)} testid="text-max-requests" />
          </>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative h-[60vh] min-h-[380px] overflow-hidden rounded-2xl border">
          <RedCoverageMap centre={centre} sizeKm={sizeKm} result={shown} showPreview={!analyse.isPending} onCentreChange={onMapCentre} />
          <Crosshair className="pointer-events-none absolute left-1/2 top-1/2 z-[500] h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-foreground" aria-hidden />
          {analyse.isPending && (
            <div className="absolute inset-0 z-[600] grid place-items-center bg-background/70" role="status" data-testid="status-analysis-pending">
              <p className="flex items-center gap-2 rounded-xl bg-card px-4 py-3 font-medium shadow">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Liczenie izolinii… do ok. 30 s
              </p>
            </div>
          )}
        </div>

        <aside className="space-y-5 rounded-2xl border bg-card p-5">
          <div>
            <p className="text-sm font-semibold">1. Środek obszaru</p>
            <p className="mt-1 text-sm text-muted-foreground">Przybliż mapę do miejscowości lub dzielnicy, przesuń ją albo kliknij — środek wyznacza krzyżyk. Przerywany kwadrat to podgląd obszaru.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="lat">Szerokość</Label>
                <Input id="lat" inputMode="decimal" value={latText} onChange={(e) => setLatText(e.target.value)} placeholder="52.22977" data-testid="input-latitude" />
              </div>
              <div>
                <Label htmlFor="lng">Długość</Label>
                <Input id="lng" inputMode="decimal" value={lngText} onChange={(e) => setLngText(e.target.value)} placeholder="21.01178" data-testid="input-longitude" />
              </div>
            </div>
            <Button variant="outline" size="sm" className="mt-2 w-full" onClick={applyCoords} data-testid="button-apply-coords">Ustaw współrzędne</Button>
            {centre && !inPoland(centre) && <p className="mt-2 text-sm font-medium text-destructive">Środek musi leżeć w Polsce (49–55°N, 14–24,2°E).</p>}
          </div>

          <fieldset>
            <legend className="text-sm font-semibold">2. Wielkość kwadratu</legend>
            <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup">
              {SIZES.map((s) => (
                <label
                  key={s}
                  className={cn('flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2', sizeKm === s ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted')}
                  data-testid={`button-size-${s}`}
                >
                  <input className="sr-only" type="radio" name="red-map-size" value={s} checked={sizeKm === s} onChange={() => setSizeKm(s)} />
                  {s}×{s} km
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <Button className="w-full" size="lg" disabled={!canRun} onClick={run} data-testid="button-analyse">
              {analyse.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Play className="mr-2 h-4 w-4" aria-hidden />}
              Analizuj obszar
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Analiza uruchamia się tylko po kliknięciu i może zużyć do {st?.maxNewRequests ?? '—'} zapytań z limitu Geoapify. Nie ponawiamy jej automatycznie.
            </p>
            {!zoomOk && <p className="mt-1 text-xs text-muted-foreground">Najpierw wybierz środek na mapie lub wpisz współrzędne.</p>}
          </div>
        </aside>
      </div>

      {analyse.isError && (
        <div role="alert" className="flex gap-3 rounded-xl border border-destructive/40 bg-accent p-4" data-testid="text-analysis-error">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="font-semibold">Analiza nie powiodła się</p>
            <p className="text-sm">{errMsg(analyse.error)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Część limitu mogła zostać zużyta — stan limitu odświeżono. Uruchom ponownie ręcznie, jeśli chcesz.</p>
          </div>
        </div>
      )}

      {shown && (
        <section aria-labelledby="wynik" className="space-y-4 rounded-2xl border bg-card p-5" data-testid="section-result">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="wynik" className="font-display text-2xl font-bold">Wynik analizy</h2>
            <span className="font-data text-xs text-muted-foreground">{new Date(shown.generatedAt).toLocaleString('pl-PL')}</span>
          </div>
          <p className={cn('rounded-lg p-3 text-sm', shown.complete ? 'bg-muted' : 'bg-accent text-accent-foreground')} data-testid="text-result-message">
            {!shown.complete && <strong>Wynik częściowy. </strong>}{shown.message}
          </p>
          <dl className="grid gap-3 sm:grid-cols-4">
            <Stat label="AED kandydujących" value={String(shown.candidateCount)} testid="text-candidates" />
            <Stat label="AED przeanalizowanych" value={String(shown.analysedCount)} testid="text-analysed" />
            <Stat label="Nowe zapytania API" value={`${shown.newRequests} / ${st?.maxNewRequests ?? '—'}`} testid="text-new-requests" />
            <Stat label="Próg pieszy" value={`${Math.round(shown.seconds / 60)} min`} testid="text-seconds" />
          </dl>
          {shown.warnings.length > 0 && (
            <ul className="space-y-1 text-sm" data-testid="list-warnings">
              {shown.warnings.map((w, i) => (
                <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />{w}</li>
              ))}
            </ul>
          )}
          <ul className="flex flex-wrap gap-4 text-sm" aria-label="Legenda">
            <Legend color="#DC2626" label="Poza modelowanym zasięgiem AED z naszej bazy" />
            <Legend color="#16A34A" label="W szacowanym zasięgu pieszym od AED" />
            <Legend color="#64748B" label="Nierozstrzygnięte (brak wyniku, nie brak AED)" />
            <Legend color="#0F172A" label="Granica analizowanego obszaru" outline />
          </ul>
        </section>
      )}

      <section aria-labelledby="model" className="rounded-2xl border bg-card p-5">
        <h2 id="model" className="flex items-center gap-2 font-display text-xl font-bold"><Info className="h-5 w-5 text-primary" aria-hidden /> Model i ograniczenia</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>Zasięg to szacowana izolinia piesza {minutes} min liczona <strong>od AED</strong> (promy wyłączone) — nie dokładne trasy odwrotne do urządzenia ani okręgi promienia.</li>
          <li>Czerwień oznacza wyłącznie obszar poza modelowanym zasięgiem AED <strong>z naszej bazy</strong>. Nie dowodzi, że w pobliżu nie ma prawdziwego AED. Poza zwróconym obszarem nic nie jest oceniane.</li>
          <li>Szary oznacza obszar nierozstrzygnięty (np. przekroczony limit lub błąd usługi), a nie brak AED.</li>
          <li>Uwzględniamy też rekordy zaimportowane i niezweryfikowane; godziny otwarcia i dostępność urządzeń mogą być nieznane. AED bez współrzędnych GPS są pominięte.</li>
          <li>Próg {minutes} min to założenie planistyczne, nie zalecenie medyczne.</li>
        </ul>
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm text-background"><Phone className="h-4 w-4 text-primary" aria-hidden /> W nagłym wypadku zawsze dzwoń <strong>112</strong>.</p>
      </section>
    </div>
  );
}

function Stat({ label, value, tone, testid }: { label: string; value: string; tone?: 'ok' | 'bad'; testid: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-data text-xl font-semibold', tone === 'ok' && 'text-verified', tone === 'bad' && 'text-destructive')} data-testid={testid}>{value}</p>
    </div>
  );
}

function Legend({ color, label, outline }: { color: string; label: string; outline?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span className="h-4 w-4 rounded-sm" style={outline ? { border: `2px solid ${color}` } : { background: color, opacity: 0.75 }} aria-hidden />
      {label}
    </li>
  );
}
