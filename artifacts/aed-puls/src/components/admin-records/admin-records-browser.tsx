import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { getListAdminRecordsQueryKey, useListAdminRecords, type Aed } from '@workspace/api-client-react';
import { EmptyState, ErrorState, ListSkeleton, formatDate } from '@/components/aed-bits';
import { KpiCard } from '@/components/records-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { RecordEditor } from './record-editor';
import { StatusPills } from './status-pills';
import { PAGE_SIZE, display, hasLocation } from './record-utils';

export function AdminRecordsBrowser({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [missingLocation, setMissing] = useState(false);
  const [needsLocationReview,setLocationReview]=useState(false);
  const [draft, setDraft] = useState(() => new URLSearchParams(window.location.search).get('search') ?? '');
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('search')?.trim() ?? '');
  const [selected, setSelected] = useState<Aed | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(draft.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [draft]);

  const params = { page, missingLocation,needsLocationReview, ...(search ? { search } : {}) };
  const list = useListAdminRecords(params, { query: { enabled, queryKey: getListAdminRecordsQueryKey(params), placeholderData: (prev) => prev } });
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE_SIZE)) : 1;

  // Po odświeżeniu listy podmieniamy rekord w edytorze na świeży (nowa rewizja), bez zmiany wybranego ID.
  useEffect(() => {
    if (!d || saving) return;
    setSelected((cur) => (cur ? d.records.find((r) => r.id === cur.id) ?? cur : cur));
  }, [d, saving]);

  const open = (a: Aed) => {
    if (saving && selected?.id !== a.id) { toast({ title: 'Trwa zapis', description: 'Poczekaj na zakończenie zapisu bieżącego rekordu.' }); return; }
    setSelected(a);
  };
  const close = () => { if (!saving) setSelected(null); };

  return (
    <div className="space-y-6">
      {d && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Rekordy w wyniku" value={d.total} />
          <KpiCard label="Brak lokalizacji" value={d.missingLocationCount} tone="red" hint="Niewidoczne na mapie publicznej" />
          <KpiCard label="Niekompletne" value={d.incompleteCount} hint="Status INCOMPLETE" />
          <KpiCard label="Do oceny lokalizacji" value={d.locationReviewCount} tone="red" hint="Zachowane rekordy ze współrzędnymi wymagającymi sprawdzenia" />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Szukaj: nazwa, adres, miejscowość, ID" aria-label="Szukaj rekordów" className="pl-9" data-testid="input-admin-search" />
        </div>
        <div role="group" aria-label="Filtr lokalizacji" className="flex flex-wrap gap-2">
          <Button variant={!missingLocation&&!needsLocationReview ? 'default' : 'outline'} aria-pressed={!missingLocation&&!needsLocationReview} onClick={() => { setMissing(false);setLocationReview(false); setPage(1); }} data-testid="filter-all">Wszystkie</Button>
          <Button variant={missingLocation ? 'default' : 'outline'} aria-pressed={missingLocation} onClick={() => { setMissing(true);setLocationReview(false); setPage(1); }} data-testid="filter-missing-location">
            Brak lokalizacji{d && <span className="ml-2 rounded-full bg-background/20 px-1.5 font-data text-xs tabular-nums">{d.missingLocationCount}</span>}
          </Button>
          <Button variant={needsLocationReview?'default':'outline'} aria-pressed={needsLocationReview} onClick={()=>{setLocationReview(true);setMissing(false);setPage(1);}} data-testid="filter-location-review">
            Do oceny lokalizacji{d&&<span className="ml-2 font-data text-xs tabular-nums">{d.locationReviewCount}</span>}
          </Button>
        </div>
      </div>

      {list.isLoading ? <ListSkeleton /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !d?.records.length ? (
        <EmptyState title={needsLocationReview?'Brak lokalizacji wymagających oceny':missingLocation ? 'Wszystkie rekordy mają lokalizację' : 'Brak rekordów'}>{search ? `Nic nie pasuje do „${search}”.` : 'Brak rekordów dla tego filtra.'}</EmptyState>
      ) : (
        <div className={cn('overflow-hidden rounded-2xl border bg-card transition-opacity', list.isFetching && 'opacity-70')} aria-busy={list.isFetching}>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Rekordy AED, strona {d.page} z {pages}</caption>
            <thead className="hidden bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground md:table-header-group">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Rekord</th>
                <th scope="col" className="px-4 py-3 font-semibold">Statusy</th>
                <th scope="col" className="px-4 py-3 font-semibold">Źródło</th>
                <th scope="col" className="px-4 py-3 font-semibold">Aktualizacja</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Akcje</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.records.map((a) => (
                <tr key={a.id} className={cn('grid gap-2 p-4 md:table-row md:p-0', selected?.id === a.id && 'bg-accent/50')} data-testid={`row-admin-aed-${a.id}`}>
                  <td className="md:px-4 md:py-3">
                    <p className="font-semibold">{display(a.name)}</p>
                    <p className="text-muted-foreground">{display(a.address)}, {display(a.city)}</p>
                    <p className="font-data text-xs text-muted-foreground">{hasLocation(a) ? `${a.latitude!.toFixed(5)}, ${a.longitude!.toFixed(5)}` : 'współrzędne: brak danych'}</p>
                  </td>
                  <td className="md:px-4 md:py-3"><StatusPills aed={a} /></td>
                  <td className="text-xs md:px-4 md:py-3"><p className="font-medium">{a.sourceName}</p><p className="font-data text-muted-foreground">{a.license}</p></td>
                  <td className="text-xs text-muted-foreground md:px-4 md:py-3">{formatDate(a.updatedAt)}</td>
                  <td className="md:px-4 md:py-3 md:text-right">
                    <Button size="sm" variant="outline" onClick={() => open(a)} disabled={saving && selected?.id !== a.id} data-testid={`button-edit-${a.id}`}>Edytuj i historia</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label="Stronicowanie" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <Button variant="outline" disabled={page <= 1 || list.isFetching} onClick={() => setPage((p) => p - 1)} data-testid="button-prev-page">Poprzednia</Button>
        <span className="font-data text-xs text-muted-foreground" data-testid="text-page">Strona {page} z {pages} · {PAGE_SIZE} na stronę</span>
        <Button variant="outline" disabled={page >= pages || list.isFetching} onClick={() => setPage((p) => p + 1)} data-testid="button-next-page">Następna</Button>
      </nav>

      <Sheet open={!!selected} onOpenChange={(o) => { if (!o) close(); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl" onInteractOutside={(e) => { if (saving) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (saving) e.preventDefault(); }}>
          <SheetHeader>
            <SheetTitle className="break-words font-display text-left">{selected ? display(selected.name) : ''}</SheetTitle>
            <SheetDescription className="text-left">Uzupełnij brakujące pola. Zapis nie zatwierdza rekordu.</SheetDescription>
          </SheetHeader>
          {selected && <div className="mt-4"><RecordEditor key={selected.id} aed={selected} onPendingChange={setSaving} onClose={close} /></div>}
        </SheetContent>
      </Sheet>
    </div>
  );
}
