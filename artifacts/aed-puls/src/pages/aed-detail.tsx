import { Link, useParams } from 'wouter';
import { ArrowLeft, Flag, Navigation, ExternalLink } from 'lucide-react';
import { getGetAedQueryKey, useGetAed } from '@workspace/api-client-react';
import { SiteLayout } from '@/components/layout';
import { AedMap } from '@/components/aed-map';
import {
  AedWarnings, DemoBadge, EmergencyNotice, ErrorState, QualityMeter, VerificationBadge,
  accessibilityLabel, directionsUrl, formatDate, placementLabel,
} from '@/components/aed-bits';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SourceIndicator, ProvenanceExplanation, deviceVerificationLabel, operationalLabel } from '@/components/source-provenance';
import { SourceSummary } from '@/components/source-summary';
import { DeviceAssessmentForm } from '@/components/device-assessment-form';

export default function AedDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const q = useGetAed(id, { query: { enabled: !!id, queryKey: getGetAedQueryKey(id) } });
  const a = q.data;

  return (
    <SiteLayout>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <Link href="/map" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-map">
          <ArrowLeft className="h-4 w-4" /> Wróć do mapy
        </Link>
        {q.isLoading ? (
          <div className="mt-6 space-y-4"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-72 w-full rounded-2xl" /></div>
        ) : q.error || !a ? (
          <div className="mt-6"><ErrorState title="Nie znaleziono rekordu" error={q.error} onRetry={() => q.refetch()} /></div>
        ) : (
          <>
            <header className="mt-6 flex flex-col gap-4 border-b pb-8 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="font-data text-xs uppercase tracking-[0.2em] text-muted-foreground">Rekord AED · {a.id.slice(0, 8)}</p>
                <h1 className="mt-2 font-display text-4xl font-bold leading-tight" data-testid="text-aed-name">{a.name}</h1>
                <p className="mt-1 text-lg text-muted-foreground">{a.address}, {a.postalCode ? `${a.postalCode} ` : ''}{a.city}{a.voivodeship ? `, woj. ${a.voivodeship}` : ''}</p>
                <div className="mt-4 flex flex-wrap gap-2"><VerificationBadge status={a.verificationStatus} />{a.isDemo && <DemoBadge />}</div>
                <SourceIndicator category={a.sourceCategory} />
                <SourceSummary aed={a} />
              </div>
              <div className="flex flex-wrap gap-2">
                {!a.isDemo && (
                  a.latitude!=null&&a.longitude!=null?<Button asChild><a href={directionsUrl(a)} target="_blank" rel="noreferrer" data-testid="link-directions"><Navigation className="mr-2 h-4 w-4" /> Wyznacz trasę</a></Button>:<span className="text-sm text-muted-foreground">Brak lokalizacji — wyznaczenie trasy jest niedostępne.</span>
                )}
                <Button asChild variant="outline"><Link href={`/report?aedId=${a.id}`} data-testid="link-report"><Flag className="mr-2 h-4 w-4" /> Zgłoś błąd</Link></Button>
              </div>
            </header>

            <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
              <div className="space-y-6">
                <AedWarnings aed={a} />
                <section className="rounded-2xl border bg-card p-6" aria-labelledby="h-info">
                  <h2 id="h-info" className="font-display text-xl font-bold">Informacje o urządzeniu</h2>
                  <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[180px_1fr]">
                    <dt className="text-muted-foreground">Dostępność</dt><dd>{accessibilityLabel[a.accessibility]}</dd>
                    <dt className="text-muted-foreground">Umiejscowienie</dt><dd>{placementLabel[a.placement ?? 'unknown']}</dd>
                    <dt className="text-muted-foreground">Godziny dostępu</dt><dd>{a.openingHours || 'brak danych'}</dd>
                    <dt className="text-muted-foreground">Opis lokalizacji</dt><dd>{a.description || 'brak opisu'}</dd>
                    <dt className="text-muted-foreground">Weryfikacja urządzenia</dt><dd>{deviceVerificationLabel[a.recordVerificationStatus ?? 'UNVERIFIED']}</dd>
                    <dt className="text-muted-foreground">Status operacyjny</dt><dd>{operationalLabel[a.operationalStatus]}</dd>
                    <dt className="text-muted-foreground">Data oceny urządzenia</dt><dd>{formatDate(a.verifiedAt)}</dd>
                    <dt className="text-muted-foreground">Dowód oceny</dt><dd>{String(a.verificationEvidence?.statement ?? 'Brak dowodu')}
                      {typeof a.verificationEvidence?.url === 'string' && <a className="ml-2 text-primary underline" href={a.verificationEvidence.url} target="_blank" rel="noreferrer">Zobacz dowód</a>}
                    </dd>
                    <dt className="text-muted-foreground">Współrzędne (WGS84)</dt><dd className="font-data">{a.latitude==null||a.longitude==null?'Brak lokalizacji':`${a.latitude.toFixed(6)}, ${a.longitude.toFixed(6)}`}{a.locationEvidence?.geocodingStatus==='RESOLVED'&&<p className="mt-1 font-sans text-xs text-muted-foreground">Dopasowanie adresu do budynku przez <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer" className="underline">Geoapify</a>. Nie jest to potwierdzenie urządzenia ani jego dokładnego położenia wewnątrz budynku.</p>}</dd>
                  </dl>
                </section>
                <section className="rounded-2xl border bg-card p-6" aria-labelledby="h-prov">
                  <h2 id="h-prov" className="font-display text-xl font-bold">Pochodzenie danych</h2>
                  <ol className="mt-4 space-y-4 border-l-2 border-border pl-5 text-sm">
                    <li><p className="text-muted-foreground">Źródło</p><p className="font-medium">{a.sourceName}</p>
                      {a.sourceUrl && <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 break-all text-primary underline-offset-2 hover:underline">{a.sourceUrl} <ExternalLink className="h-3 w-3" /></a>}
                    </li>
                    <li><p className="text-muted-foreground">Licencja</p><p className="font-medium">{a.license}</p></li>
                    <li><p className="text-muted-foreground">Utworzono</p><p className="font-medium">{formatDate(a.createdAt)}</p></li>
                    <li><p className="text-muted-foreground">Ostatnia aktualizacja</p><p className="font-medium">{formatDate(a.updatedAt)}</p></li>
                    <li><p className="text-muted-foreground">Kontrola opisu w źródle lub redakcji</p><p className="font-medium">{formatDate(a.lastVerifiedAt)} — nie oznacza kontroli urządzenia</p></li>
                  </ol>
                  {!!a.provenance?.length && <div id="all-sources" className="mt-5 space-y-3 border-t pt-4">
                    <h3 className="font-semibold">Wszystkie powiązane źródła</h3>
                    {a.provenance.map((p, i) => <div key={`${p.sourceRecordId}-${i}`} className="rounded-lg border p-3 text-sm">
                      <p className="font-semibold">{p.sourceName}</p>
                      <SourceIndicator category={p.sourceCategory} />
                      <p>Wydawca: {p.publisher || 'Nie podano'}</p>
                      {p.publisherId && <p>Identyfikator wydawcy: {p.publisherId}</p>}
                      {p.datasetTitle && <p>Zbiór: {p.datasetTitle} · {p.datasetId}</p>}
                      <p>Identyfikator: {p.sourceRecordId}</p>
                      <p>Licencja: {p.license}</p>
                      <p>Import: {formatDate(p.importedAt)} · Synchronizacja: {formatDate(p.lastSyncedAt)}</p>
                      <p>Aktualizacja źródła: {formatDate(p.sourceModifiedAt)}</p>
                      <p>Źródło pierwotne: {p.primarySourceKey || 'Niezależność wydawcy nieustalona'}</p>
                      {p.removedAt&&<p className="font-semibold text-primary">Rekord nieobecny w pełnym imporcie od {formatDate(p.removedAt)}. Nie oznacza to usunięcia fizycznego urządzenia.</p>}
                      {!!p.attributes&&<details className="my-2"><summary className="cursor-pointer">Które informacje pochodzą z tego źródła?</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(p.attributes,null,2)}</pre></details>}
                      {p.datasetUrl && <a className="mr-3 text-primary underline" href={p.datasetUrl} target="_blank" rel="noreferrer">Zbiór danych</a>}
                      {!!p.provenanceEvidence && <details className="my-2"><summary className="cursor-pointer">Podstawa klasyfikacji źródła</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(p.provenanceEvidence, null, 2)}</pre></details>}
                      <a className="break-all text-primary underline" href={p.sourceUrl} target="_blank" rel="noreferrer">Oryginalne źródło</a>
                    </div>)}
                    <p className="text-xs text-muted-foreground">Powiązanie źródeł identyfikuje wspólne urządzenie; nie zmienia licencji i nie potwierdza jego sprawności.</p>
                  </div>}
                </section>
              </div>
              <div className="space-y-6">
                {a.latitude!=null&&a.longitude!=null?<div className="h-72 overflow-hidden rounded-2xl border"><AedMap aeds={[a]} label={`Położenie: ${a.name}`} /></div>:<p className="rounded-xl border bg-muted p-4 text-sm text-muted-foreground">Nie znamy wiarygodnej lokalizacji tego AED. Rekord zachowano do uzupełnienia; nie jest pokazywany na mapie.</p>}
                <section className="rounded-2xl border bg-card p-6" aria-labelledby="h-q">
                  <h2 id="h-q" className="font-display text-xl font-bold">Jakość danych</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Wskaźnik mierzy kompletność i wiarygodność rekordu, nie sprawność medyczną urządzenia.</p>
                  <div className="mt-4"><QualityMeter score={a.qualityScore} /></div>
                  {a.qualityIssues.length ? (
                    <ul className="mt-4 space-y-2 text-sm">
                      {a.qualityIssues.map((i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />{i}</li>)}
                    </ul>
                  ) : <p className="mt-4 text-sm text-verified">Nie wykryto braków w danych.</p>}
                </section>
                <EmergencyNotice />
                <ProvenanceExplanation />
                <DeviceAssessmentForm key={a.id} aed={a} />
              </div>
            </div>
          </>
        )}
      </div>
    </SiteLayout>
  );
}
