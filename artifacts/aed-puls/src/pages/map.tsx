import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Navigation, X } from 'lucide-react';
import { getListMapPointsQueryKey, listMapPoints, useGetAed, getGetAedQueryKey, type Aed, type ListMapPointsParams } from '@workspace/api-client-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { SiteLayout } from '@/components/layout';
import { AedMap } from '@/components/aed-map';
import {
  AedWarnings, DemoBadge, QualityMeter, VerificationBadge,
  accessibilityLabel, directionsUrl, formatDate, placementLabel,
} from '@/components/aed-bits';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/use-auth';
import { useGeolocation } from '@/hooks/use-geolocation';
import { SourceIndicator, deviceVerificationLabel, operationalLabel } from '@/components/source-provenance';
import { SourceSummary } from '@/components/source-summary';

function DetailCard({ aed: summary, onClose }: { aed: Pick<Aed,'id'>; onClose: () => void }) {
  const detail = useGetAed(summary.id, { query: { queryKey: getGetAedQueryKey(summary.id) } });
  const aed = detail.data;
  if(!aed)return <div className="rounded-2xl border bg-card p-5">{detail.error?'Nie pobrano szczegółów urządzenia. Spróbuj ponownie.':'Wczytywanie szczegółów i źródeł…'}<Button onClick={onClose} variant="ghost">Zamknij</Button></div>;
  const primary = aed.provenance?.find(p => p.sourceUrl === aed.sourceUrl) ?? aed.provenance?.[0];
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-lg" data-testid="card-selected-aed">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold leading-tight">{aed.name}</h2>
          <p className="text-sm text-muted-foreground">{aed.address}, {aed.postalCode ? `${aed.postalCode} ` : ''}{aed.city}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Zamknij szczegóły" data-testid="button-close-detail"><X className="h-4 w-4" /></Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <VerificationBadge status={aed.verificationStatus} />
        {aed.isDemo && <DemoBadge />}
      </div>
      <SourceIndicator category={aed.sourceCategory} />
      <SourceSummary aed={aed} />
      <p className="text-xs">{deviceVerificationLabel[aed.recordVerificationStatus ?? 'UNVERIFIED']}</p>
      <p className="mt-1 text-xs">{operationalLabel[aed.operationalStatus]}</p>
      <p className="mt-1 text-xs">Aktualizacja źródła: {formatDate(primary?.sourceModifiedAt)}</p>
      <a className="text-xs text-primary underline" href={primary?.datasetUrl || aed.sourceUrl} target="_blank" rel="noreferrer">Oryginalny zbiór lub zasób</a>
      {detail.error && <p className="text-xs text-primary">Nie pobrano pełnych metadanych źródła.</p>}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Dostępność</dt><dd>{accessibilityLabel[aed.accessibility]}</dd>
        <dt className="text-muted-foreground">Umiejscowienie</dt><dd>{placementLabel[aed.placement ?? 'unknown']}</dd>
        <dt className="text-muted-foreground">Godziny</dt><dd>{aed.openingHours || 'brak danych'}</dd>
        <dt className="text-muted-foreground">Źródło</dt><dd className="break-words">{aed.sourceName}</dd>
        <dt className="text-muted-foreground">Ost. weryfikacja</dt><dd>{formatDate(aed.lastVerifiedAt)}</dd>
      </dl>
      <div className="mt-4"><QualityMeter score={aed.qualityScore} /></div>
      <div className="mt-4"><AedWarnings aed={aed} /></div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild size="sm" data-testid="link-aed-details"><Link href={`/aed/${aed.id}`}>Zobacz wszystkie źródła</Link></Button>
        {!aed.isDemo && (
          <Button asChild size="sm" variant="outline">
            <a href={directionsUrl(aed)} target="_blank" rel="noreferrer" data-testid="link-directions"><Navigation className="mr-1.5 h-4 w-4" /> Wyznacz trasę</a>
          </Button>
        )}
      </div>
    </div>
  );
}

export default function MapPage() {
  const { isLoading: sessionLoading } = useSession();
  const geo = useGeolocation(!sessionLoading);
  const [selected, setSelected] = useState<string | null>(null);

  const params = useMemo<ListMapPointsParams>(() => ({ limit: 2000 }), []);
  const q = useInfiniteQuery({
    queryKey: [...getListMapPointsQueryKey(params), 'all-pages'],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => listMapPoints({ ...params, page: pageParam }, { signal }),
    getNextPageParam: (lastPage, pages) => lastPage.length === params.limit ? pages.length + 1 : undefined,
    staleTime: 60000,
    refetchInterval: 60000,
  });
  useEffect(() => {
    if(q.hasNextPage&&!q.isFetching&&!q.isError)void q.fetchNextPage();
  },[q.hasNextPage,q.isFetching,q.isError,q.fetchNextPage]);
  const aeds = useMemo(() => [...new Map((q.data?.pages.flat() ?? []).map(a => [a.id,a])).values()], [q.data]);
  const sel = aeds.find((a) => a.id === selected) ?? null;

  return (
    <SiteLayout bare>
      <h1 className="sr-only">Mapa defibrylatorów AED</h1>
      <section className="relative h-[calc(100dvh-9rem)] min-h-[560px]" aria-label="Mapa najbliższych AED">
        <AedMap aeds={aeds} selectedId={selected} onSelect={setSelected} userPosition={geo.position} preserveView />
        {sel && <div className="absolute inset-x-3 bottom-3 z-[600] max-h-[70%] overflow-y-auto sm:left-auto sm:right-4 sm:w-[380px]">
          <DetailCard aed={sel} onClose={() => setSelected(null)} />
        </div>}
      </section>
    </SiteLayout>
  );
}
