import { ExternalLink } from 'lucide-react';
import { useGetSourceDirectory } from '@workspace/api-client-react';
import { ErrorState, ListSkeleton, formatDateTime } from '@/components/aed-bits';
import { cn } from '@/lib/utils';
import { sourceStatusLabel, sourceStatusOk } from '@/lib/source-status';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function SourceStatusList() {
  const sources = useGetSourceDirectory({ query: { refetchInterval: 60_000 } });
  if (sources.isLoading) return <ListSkeleton rows={3} />;
  if (sources.error) return <ErrorState error={sources.error} onRetry={() => sources.refetch()} />;
  const list = sources.data?.entries ?? [];
  if (list.length === 0) return <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">Serwer nie zwrócił żadnych zarejestrowanych źródeł.</p>;
  return (
    <div className="space-y-10">
      {([
        ['aed', 'Źródła danych AED', 'Zbiory oryginalnych wydawców. Potwierdzone kanały tego samego zbioru pokazujemy w jednym wpisie.'],
        ['catalogue', 'Katalogi danych', 'Wyszukują zbiory innych wydawców. Nie są dodatkowym wydawcą tych samych rekordów.'],
        ['auxiliary', 'Źródła pomocnicze', 'Warstwy mapowe i usługi pomocnicze — bez importowania rekordów AED.'],
      ] as const).map(([section, title, description]) => <section key={section} aria-labelledby={`sources-${section}`}>
        <h2 id={`sources-${section}`} className="font-display text-3xl font-bold">{title}</h2>
        <p className="mb-5 mt-2 text-muted-foreground">{description}</p>
        {list.every(s => s.section !== section) ? <p className="text-sm text-muted-foreground">Brak zarejestrowanych źródeł w tej sekcji.</p> :
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {list.filter(s => s.section === section).map((s) => (
              <li key={s.id} data-testid={`card-source-${s.id}`}>
                <Dialog>
                  <DialogTrigger asChild>
                    <button type="button" className="flex w-full items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                      aria-label={`Szczegóły źródła: ${s.name}`} data-testid={`button-source-details-${s.id}`}>
                      <span className="min-w-0 flex-1 break-words font-semibold">{s.name}</span>
                      <span title={s.status} className={cn('shrink-0 rounded-full border px-2.5 py-0.5 font-data text-[11px] uppercase tracking-wider', sourceStatusOk(s.status) ? 'border-verified/40 text-verified' : 'border-amber-300 bg-amber-50 text-warn')}>
                        {sourceStatusLabel(s.status)}
                      </span>
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-xl" data-testid={`dialog-source-${s.id}`}>
                    <DialogHeader className="text-left">
                      <DialogTitle className="break-words pr-6 text-xl leading-snug">{s.name}</DialogTitle>
                      <DialogDescription>{s.institution || 'Nie podano instytucji publikującej.'}</DialogDescription>
                    </DialogHeader>
                    <p className="text-sm font-semibold">{sourceStatusLabel(s.status)}</p>
                    {s.statusMessage && <p className="text-sm">{s.statusMessage}</p>}
                    {s.groupingEvidence.map(reason => <p key={reason} className="break-words text-xs text-muted-foreground">{reason}</p>)}
                    <dl className="grid gap-x-6 gap-y-3 break-words text-sm sm:grid-cols-2">
                      <div><dt className="text-xs text-muted-foreground">Zasięg</dt><dd>{s.coverage || '—'}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Licencja</dt><dd className="font-data">{s.license || '—'}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Aktualizacja</dt><dd>{s.updateFrequency || '—'}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Identyfikator zbioru</dt><dd className="break-all font-data">{s.datasetId || '—'}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Zakres autorytatywny</dt><dd>{s.authoritativeScope || '—'}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Ostatnie sprawdzenie</dt><dd>{formatDateTime(s.lastCheckedAt)}</dd></div>
                    </dl>
                    <div className="space-y-3">
                      <h3 className="font-semibold">Kanały i ich stan ({s.memberSources.length})</h3>
                      <p className="text-xs text-muted-foreground">Zachowano identyfikatory i historie synchronizacji wszystkich kanałów. Wspólny wpis zmienia wyłącznie prezentację.</p>
                      {s.memberSources.map(member => <div key={member.id} className="rounded-lg border p-3 text-sm">
                        <p className="font-semibold">{member.name} — {sourceStatusLabel(member.status)}</p>
                        <p className="mt-1">{member.statusMessage}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Ostatnie sprawdzenie: {formatDateTime(member.lastCheckedAt)}</p>
                        <p className="break-all font-data text-xs text-muted-foreground">ID: {member.id} · zbiór: {member.datasetId}</p>
                        <p className="text-xs text-muted-foreground">Licencja kanału: {member.license}</p>
                      </div>)}
                      <h3 className="font-semibold">Endpointy integracji i metadane ({s.endpoints.length})</h3>
                      <ul className="space-y-2">{s.endpoints.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-start gap-1 break-all text-sm text-primary hover:underline">{url}<ExternalLink aria-hidden className="mt-0.5 h-3 w-3 shrink-0" /></a></li>)}</ul>
                    </div>
                    <DialogFooter><DialogClose asChild><Button variant="outline">Zamknij</Button></DialogClose></DialogFooter>
                  </DialogContent>
                </Dialog>
              </li>
            ))}
          </ul>}
      </section>)}
    </div>
  );
}
