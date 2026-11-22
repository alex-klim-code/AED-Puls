import { useEffect } from 'react';
import { Link } from 'wouter';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetStatsQueryKey, getGetSourceDirectoryQueryKey, useGetStats } from '@workspace/api-client-react';
import { SiteLayout } from '@/components/layout';
import { SourceStatusList } from '@/components/source-status-list';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/use-auth';

const params = { demo: false };
const fmt = (value?: number) => value == null ? '—' : value.toLocaleString('pl-PL');

export default function StatusPage() {
  const client = useQueryClient();
  const { user, isLoading } = useSession();
  const stats = useGetStats(params, { query: {
    queryKey: [...getGetStatsQueryKey(params), user?.id ?? 'anon', user?.role ?? 'guest'],
    enabled: !isLoading, refetchInterval: 60_000,
  } });
  const s = stats.data;
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Baza — aktualny stan | AED Puls';
    const description = 'Aktualne statystyki bazy AED Puls, dostępność źródeł danych i informacje o ostatnich aktualizacjach.';
    const previous = [
      ['name', 'description', description],
      ['property', 'og:title', 'Baza — aktualny stan | AED Puls'],
      ['property', 'og:description', description],
    ].map(([attribute, key, content]) => {
      const existing = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
      const tag = existing ?? document.createElement('meta');
      const old = tag.getAttribute('content');
      tag.setAttribute(attribute, key);
      tag.setAttribute('content', content);
      if (!existing) document.head.appendChild(tag);
      return { tag, old, existed: !!existing };
    });
    return () => {
      document.title = previousTitle;
      previous.forEach(({ tag, old, existed }) => {
        if (!existed) tag.remove();
        else if (old === null) tag.removeAttribute('content');
        else tag.setAttribute('content', old);
      });
    };
  }, []);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getGetStatsQueryKey(params) });
    void client.invalidateQueries({ queryKey: getGetSourceDirectoryQueryKey() });
  };
  const metrics = [
    ['total', 'Unikalnych AED', fmt(s?.uniqueAedCount)],
    ['sources', 'Integracji', fmt(s?.integrationCount)],
    ['publishers', 'Niezależnych wydawców', fmt(s?.independentPublisherCount)],
    ['verified', 'Zweryfikowanych', fmt(s?.verified)],
    ...(user?.role === 'ADMIN' ? [['pending', 'Oczekuje', fmt(s?.pending)]] : []),
    ['cities', 'Miejscowości', fmt(s?.cities)],
    ['quality', 'Śr. kompletność', s ? `${Math.round(s.averageQuality)}/100` : '—'],
  ];
  return (
    <SiteLayout>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <p className="font-data text-xs uppercase tracking-[0.2em] text-primary">Baza AED</p>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-5">
          <div>
            <h1 className="font-display text-4xl font-extrabold sm:text-5xl">Stan bazy na żywo</h1>
            <p className="mt-4 max-w-2xl text-muted-foreground">Aktualne statystyki platformy i dostępność źródeł danych. Pobieranie plików znajduje się na osobnej stronie „Eksport danych”.</p>
          </div>
          <Button variant="outline" onClick={refresh} disabled={stats.isFetching || isLoading} data-testid="button-refresh-database-status">
            <RefreshCw aria-hidden className={`mr-2 h-4 w-4 ${stats.isFetching ? 'animate-spin' : ''}`} />
            {stats.isFetching ? 'Odświeżanie…' : 'Odśwież dane'}
          </Button>
        </div>
        <section aria-label="Statystyki bazy AED" className="mt-8 rounded-2xl bg-foreground p-5 text-background sm:p-8">
          <p className="font-data text-xs uppercase tracking-widest text-background/70">Źródło: rzeczywista baza platformy</p>
          {stats.error && <p role="alert" className="mt-4">Nie udało się odświeżyć statystyk. {s ? 'Poniżej ostatnio pobrane wartości.' : 'Spróbuj ponownie przyciskiem „Odśwież dane”.'}</p>}
          <dl className="mt-5 grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-6">
            {metrics.map(([key, label, value]) => <div key={key}>
              <dt className="text-xs text-background/70">{label}</dt>
              <dd className="mt-2 font-display text-3xl font-bold tabular-nums" data-testid={`text-database-${key}`}>
                {stats.isLoading || isLoading ? <Skeleton className="h-9 w-20 bg-background/10" /> : value}
              </dd>
            </div>)}
          </dl>
          <p className="mt-6 max-w-4xl text-xs leading-relaxed text-background/70">Integracje to kanały techniczne, także katalog, WMS i integracje wymagające konfiguracji. Zbiory odkryte przez katalog nie zwiększają tego licznika. Wydawców liczymy niezależnie od liczby endpointów; dane.gov.pl i Geoportal nie są dodatkowymi wydawcami AED. Unikalne AED nie obejmują wpisów scalonych z innymi rekordami; publiczny widok obejmuje tylko publiczne wpisy z lokalizacją, a administrator widzi także rekordy do oceny. Kompletność nie potwierdza sprawności urządzeń.</p>
          <p className="mt-3 text-xs text-background/70" data-testid="text-database-updated">
            Automatyczne odświeżanie co 60 sekund przy aktywnej stronie.
            {stats.dataUpdatedAt > 0 && <> Statystyki pobrano: {new Date(stats.dataUpdatedAt).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })}.</>}
          </p>
        </section>
        <section className="mt-12" aria-label="Źródła danych AED">
          <p className="mb-5 mt-2 text-muted-foreground">Kliknij nazwę lub status źródła, aby zobaczyć szczegóły, ostatnie aktualizacje i warunki korzystania z danych.</p>
          <SourceStatusList />
        </section>
        <Link href="/data" className="mt-8 inline-flex items-center gap-2 font-semibold text-primary hover:underline" data-testid="link-status-to-export">
          Przejdź do eksportu danych <ArrowRight aria-hidden className="h-4 w-4" />
        </Link>
      </div>
    </SiteLayout>
  );
}
