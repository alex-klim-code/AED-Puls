import { useMemo, useState } from 'react';
import { Database, RefreshCw, Search } from 'lucide-react';
import { useGetDataCatalogue } from '@workspace/api-client-react';
import type { DataCatalogueDataset } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState, ListSkeleton, formatDateTime } from '@/components/aed-bits';
import { sourceStatusLabel } from '@/lib/source-status';

const number = (value: number) => value.toLocaleString('pl-PL');
const cell = 'px-4 py-3 text-left align-top text-sm';
type Sort = 'publisher' | 'title' | 'aedCount' | 'updatedAt' | 'averageQuality';
const status = (value: string) => ['verified', 'VERIFIED'].includes(value) ? 'Zatwierdzone'
  : ['unverified', 'NOT_VERIFIED'].includes(value) ? 'Niezweryfikowane' : sourceStatusLabel(value);

export function DataCatalogue() {
  const query = useGetDataCatalogue({ query: { staleTime: 0, refetchOnMount: 'always' } });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('publisher');
  const [descending, setDescending] = useState(false);
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pl-PL');
    return (query.data?.datasets ?? []).filter(row =>
      `${row.publisher} ${row.title} ${row.formats.join(' ')} ${row.licenses.join(' ')}`.toLocaleLowerCase('pl-PL').includes(needle))
      .sort((a, b) => {
        const left = a[sort], right = b[sort];
        if (left == null) return right == null ? 0 : 1;
        if (right == null) return -1;
        return (typeof left === 'number' && typeof right === 'number'
          ? left - right : String(left).localeCompare(String(right), 'pl-PL')) * (descending ? -1 : 1);
      });
  }, [query.data, search, sort, descending]);
  return (
    <div className="mt-12 min-w-0 space-y-10" data-testid="data-catalogue">
      <section aria-labelledby="catalogue-title" className="min-w-0 rounded-2xl border bg-card">
        <div className="space-y-4 border-b p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="catalogue-title" className="flex items-center gap-2 font-display text-2xl font-bold"><Database aria-hidden className="h-5 w-5 shrink-0 text-primary" />Wykaz zasobów danych AED</h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Rzeczywiste zbiory zapisane w aplikacji, niezależnie od filtrów eksportu powyżej. Jeden wiersz oznacza zbiór, a bez identyfikatora — agregację dostawcy. Liczby AED w różnych zbiorach mogą się nakładać.</p>
            </div>
            <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()} data-testid="button-refresh-catalogue">
              <RefreshCw aria-hidden className={`mr-2 h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />Odśwież wykaz
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 basis-60">
              <label htmlFor="catalogue-search" className="mb-1 block text-sm font-medium">Szukaj zbioru, wydawcy, formatu lub licencji</label>
              <div className="relative"><Search aria-hidden className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="catalogue-search" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
            </div>
            <div>
              <label htmlFor="catalogue-sort" className="mb-1 block text-sm font-medium">Sortuj według</label>
              <select id="catalogue-sort" value={sort} onChange={e => setSort(e.target.value as Sort)} className="min-h-10 max-w-full rounded-lg border bg-background px-3 text-sm">
                <option value="publisher">Wydawcy</option><option value="title">Nazwy zbioru</option><option value="aedCount">Liczby AED</option><option value="updatedAt">Daty aktualizacji</option><option value="averageQuality">Kompletności</option>
              </select>
            </div>
            <Button type="button" variant="outline" aria-pressed={descending} onClick={() => setDescending(v => !v)}>{descending ? 'Malejąco ↓' : 'Rosnąco ↑'}</Button>
          </div>
        </div>
        {query.isLoading ? <div className="p-5"><ListSkeleton rows={3} /></div> : query.error ? <div className="p-5"><ErrorState error={query.error} onRetry={() => query.refetch()} /></div> : <>
          <p role="status" className="px-5 py-3 text-xs text-muted-foreground">{rows.length} z {query.data?.datasets.length ?? 0} zbiorów. Odczyt: {formatDateTime(query.data?.updatedAt)}.</p>
          <div role="region" aria-label="Wykaz zasobów — przewijaj poziomo na małym ekranie" tabIndex={0} className="max-h-[560px] overflow-auto border-t">
            <table className="w-full min-w-[1100px]" data-testid="table-data-catalogue">
              <caption className="sr-only">Publiczne zbiory AED. Kompletność nie potwierdza sprawności ani dostępności urządzeń.</caption>
              <thead className="sticky top-0 bg-muted"><tr>{['Lp.', 'Dysponent / wydawca', 'Nazwa zbioru danych AED', 'Format danych', 'Liczba AED', 'Data aktualizacji', 'Licencja', 'Średnia kompletność danych', 'Status danych'].map(title => <th key={title} scope="col" className={`${cell} font-semibold`}>{title}</th>)}</tr></thead>
              <tbody className="divide-y">{rows.map((row, index) => <DatasetRow key={row.id} row={row} index={index} />)}</tbody>
            </table>
            {!rows.length && <p className="p-5 text-sm">Brak zbiorów odpowiadających wyszukiwaniu.</p>}
          </div>
          <p className="p-5 text-xs text-muted-foreground">Data aktualizacji pochodzi z metadanych źródła, nie z daty odczytu wykazu. Brak metadanych oznaczamy jawnie. Wykaz nie potwierdza praw do eksportu — o dopuszczeniu danych decyduje istniejąca walidacja eksportu.</p>
        </>}
      </section>
      <section aria-labelledby="standard-title" className="min-w-0 rounded-2xl border bg-card">
        <div className="border-b p-5 sm:p-6">
          <h2 id="standard-title" className="font-display text-2xl font-bold">Rozszerzony standard AED Puls {query.data?.version ?? '1.1.0'}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{query.data?.fields.length ?? 36} istniejących pól: wspólny model danych, kompletność, statusy i historia pochodzenia. Nie zmieniamy standardu ani formatów eksportu.</p>
          <p className="mt-3 text-xs text-muted-foreground">„Obecne po normalizacji” odnosi się do zapisanych publikacji w aplikacji, nie dowodzi obecności pola w oryginalnym pliku ani we wszystkich zbiorach dane.gov.pl. „Nie ustalono” nie oznacza braku pola w źródle. Kompletność nie jest oceną wiarygodności lub sprawności; kategorię pochodzenia i weryfikację pokazujemy osobno.</p>
        </div>
        {query.isLoading ? <div className="p-5"><ListSkeleton rows={3} /></div> : query.error ? <p className="p-5 text-sm">Nie udało się pobrać opisu standardu. Odśwież wykaz.</p> :
          <div role="region" aria-label="Pola standardu — przewijaj poziomo na małym ekranie" tabIndex={0} className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[800px]" data-testid="table-aed-standard">
              <caption className="sr-only">Pola aktualnego standardu i wartość dodana przez AED Puls</caption>
              <thead className="sticky top-0 bg-muted"><tr>{['Nazwa pola', 'Typ danych', 'Czy występuje w źródłach', 'Uzupełniane lub obliczane przez AED Puls'].map(title => <th key={title} scope="col" className={`${cell} font-semibold`}>{title}</th>)}</tr></thead>
              <tbody className="divide-y">{query.data?.fields.map(field => <tr key={field.name}>
                <th scope="row" className={`${cell} font-normal`}><code className="font-data font-semibold">{field.name}</code><p className="mt-1 max-w-xs text-xs text-muted-foreground">{field.description}</p></th>
                <td className={cell}>{field.type}</td><td className={cell}>{field.sourcePresence}</td><td className={cell}>{field.enrichment}</td>
              </tr>)}</tbody>
            </table>
          </div>}
      </section>
    </div>
  );
}

function DatasetRow({ row, index }: { row: DataCatalogueDataset; index: number }) {
  return <tr className="hover:bg-muted/30">
    <td className={cell}>{index + 1}</td><td className={`${cell} min-w-44`}>{row.publisher}</td>
    <th scope="row" className={`${cell} min-w-56 font-normal`}>{row.url ? <a className="font-semibold text-primary underline underline-offset-2" href={row.url} target="_blank" rel="noreferrer">{row.title}</a> : <span className="font-semibold">{row.title}</span>}{row.aggregation && <span className="mt-2 block text-xs text-muted-foreground">Agregacja dostawcy</span>}</th>
    <td className={cell}>{row.formats.join(', ') || 'Nie ustalono'}</td><td className={`${cell} tabular-nums`}>{number(row.aedCount)}</td>
    <td className={cell}>{row.updatedAt ? formatDateTime(row.updatedAt) : 'Brak metadanych'}</td>
    <td className={cell}>{row.licenses.join(', ')}</td><td className={`${cell} tabular-nums`}>{row.averageQuality == null ? 'Nie ustalono' : `${row.averageQuality}%`}</td>
    <td className={cell}>{row.statuses.map(status).join(', ')}</td>
  </tr>;
}
