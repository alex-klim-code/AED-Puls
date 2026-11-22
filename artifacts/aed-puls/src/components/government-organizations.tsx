import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSearchGovernmentOrganizations, useGetGovernmentOrganization, useGetMyGovernmentOrganizations,
  useClaimGovernmentOrganization, useImportGovernmentOrganization, useSwitchGovernmentOrganization,
  useListGovernmentOrganizationDatasets, useListGovernmentDatasetResources,
  type GovernmentEntity,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/aed-bits';
import { useToast } from '@/hooks/use-toast';
import { Field, inputCls } from '@/components/mcod/mcod-shared';

const statusLabels: Record<string, string> = { NOT_STARTED: 'Nie rozpoczęto', QUEUED: 'W kolejce',
  RUNNING: 'Pobieranie danych', COMPLETED: 'Zakończono', PARTIAL: 'Częściowo pobrano',
  FAILED: 'Błąd importu', PENDING: 'Oczekuje na administratora', APPROVED: 'Zatwierdzono', REJECTED: 'Odrzucono' };
export const governmentStatus = (status?: string) => statusLabels[status ?? ''] ?? status;

function ImportDetails({ id }: { id: string }) {
  const info = useGetGovernmentOrganization(id, { query: { refetchInterval: 5000 } });
  const datasets = useListGovernmentOrganizationDatasets(id, { query: { refetchInterval: 5000 } });
  const [dataset, setDataset] = useState('');
  const resources = useListGovernmentDatasetResources(dataset, { query: { enabled: !!dataset } });
  const start = useImportGovernmentOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  return <div className="mt-3 space-y-2 rounded-lg bg-muted/50 p-3 text-sm" aria-live="polite">
    {info.error ? <ErrorState error={info.error} onRetry={() => info.refetch()} /> : <>
      <p><strong>Import: {governmentStatus(info.data?.importStatus)}</strong></p>
      <p>{info.data?.importMessage}</p>
    </>}
    {['FAILED', 'PARTIAL', 'NOT_STARTED', 'QUEUED'].includes(info.data?.importStatus ?? '') &&
      <Button size="sm" variant="outline" disabled={start.isPending} onClick={() => start.mutate({ id }, {
        onSuccess: () => qc.invalidateQueries(), onError: () => toast({ title: 'Nie udało się zlecić importu', variant: 'destructive' }),
      })}>Uruchom / ponów import</Button>}
    {datasets.error ? <ErrorState error={datasets.error} onRetry={() => datasets.refetch()} /> : <p>Zapisane zbiory: {datasets.data?.length ?? 0}</p>}
    {!!datasets.data?.length && <label className="block">Zbiory i zasoby
      <select className={inputCls} value={dataset} onChange={e => setDataset(e.target.value)}>
        <option value="">Wybierz zbiór, aby zobaczyć zasoby</option>
        {datasets.data.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>}
    {dataset && (resources.error ? <ErrorState error={resources.error} onRetry={() => resources.refetch()} /> :
      <ul className="space-y-1">{resources.data?.map(r => <li key={r.id}><a className="underline" href={r.sourceUrl} target="_blank" rel="noreferrer">{r.name}</a> · {r.format}</li>)}</ul>)}
    <p className="text-xs text-muted-foreground">Import nie zmienia istniejących AED. Brak GPS nie blokuje zapisu, ale taki rekord nie jest punktem na mapie.</p>
  </div>;
}

export function MyGovernmentOrganizations() {
  const q = useGetMyGovernmentOrganizations({ query: { refetchInterval: 5000 } });
  const change = useSwitchGovernmentOrganization();
  const { toast } = useToast();
  return <section className="space-y-3 rounded-2xl border bg-card p-5">
    <h2 className="text-xl font-bold">Organizacje z dane.gov.pl</h2>
    <p className="text-sm"><Link className="text-primary underline" href="/register-organization">Wyszukaj instytucję i zgłoś reprezentowanie organizacji</Link></p>
    {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
    {q.data?.claims.map(c => <article key={c.id} className="rounded-xl border p-4">
      <h3 className="font-semibold">{c.name}</h3>
      <p className="text-sm">{governmentStatus(c.status)}</p>
      {c.note && <p className="text-sm">Decyzja administratora: {c.note}</p>}
      {c.status === 'APPROVED' && c.institutionId && c.organizationId !== q.data.activeOrganizationId &&
        <Button className="mt-2" disabled={change.isPending} onClick={() => change.mutate({ id: c.institutionId! }, {
          onSuccess: () => window.location.assign(`${import.meta.env.BASE_URL}dashboard`),
          onError: () => toast({ title: 'Nie udało się zmienić profilu', variant: 'destructive' }),
        })}>Przełącz na profil organizacji</Button>}
      {c.status === 'APPROVED' && c.organizationId === q.data.activeOrganizationId && <p className="text-sm font-medium">Aktywny profil organizacji</p>}
      {c.institutionId && <ImportDetails id={c.institutionId} />}
    </article>)}
  </section>;
}

export function GovernmentOrganizationForm() {
  const [phrase, setPhrase] = useState(''), [search, setSearch] = useState('');
  useEffect(() => { const timer = setTimeout(() => setSearch(phrase.trim()), 450); return () => clearTimeout(timer); }, [phrase]);
  const results = useSearchGovernmentOrganizations({ q: search }, { query: { enabled: search.length >= 2, staleTime: 60000 } });
  const [selected, setSelected] = useState<GovernmentEntity | null>(null);
  const [representative, setRepresentative] = useState(''), [evidence, setEvidence] = useState('');
  const claim = useClaimGovernmentOrganization(), start = useImportGovernmentOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const choose = (institution: GovernmentEntity) => {
    setSelected(institution);
    start.mutate({ id: institution.id }, {
      onSuccess: () => qc.invalidateQueries(),
      onError: () => toast({ title: 'Nie udało się zlecić importu. Możesz ponowić poniżej.', variant: 'destructive' }),
    });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    claim.mutate({ id: selected.id, data: { representative, evidence } }, {
      onSuccess: async () => { await qc.invalidateQueries(); toast({ title: 'Wniosek zapisany — oczekuje na administratora' }); },
      onError: () => toast({ title: 'Nie udało się wysłać wniosku', variant: 'destructive' }),
    });
  };
  return <div className="space-y-6">
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <h2 className="text-xl font-bold">Konto ORGANIZATION — wybierz instytucję</h2>
      <p className="text-sm text-muted-foreground">Najpierw przeszukujemy lokalną bazę, a gdy brak wyników — oficjalne API dane.gov.pl. Wybór nazwy nie przyznaje uprawnień.</p>
      <Field label="Szukaj instytucji z dane.gov.pl">
        <input className={inputCls} value={phrase} maxLength={120} onChange={e => setPhrase(e.target.value)} placeholder="Wpisz co najmniej 2 znaki, np. nazwę miasta" data-testid="input-government-institution" />
      </Field>
      {search.length >= 2 && (results.isFetching ? <p role="status">Wyszukiwanie…</p> :
        results.error ? <ErrorState error={results.error} onRetry={() => results.refetch()} /> :
        !results.data?.length ? <p>Brak pasujących instytucji.</p> :
        <ul className="max-h-64 divide-y overflow-auto rounded-xl border">{results.data.map(i => <li key={i.id}>
          <button type="button" className="min-h-11 w-full p-3 text-left hover:bg-muted" aria-pressed={selected?.id === i.id}
            onClick={() => choose(i)}>{i.name}{selected?.id === i.id ? ' — wybrano' : ''}</button>
        </li>)}</ul>)}
      {selected && <form onSubmit={submit} className="space-y-4 border-t pt-4">
        <h3 className="font-semibold">Reprezentuję: {selected.name}</h3>
        <Field label="Imię, nazwisko i funkcja przedstawiciela"><input required minLength={2} maxLength={200} className={inputCls} value={representative} onChange={e => setRepresentative(e.target.value)} /></Field>
        <Field label="Podstawa reprezentowania i sposób potwierdzenia uprawnienia"><textarea required minLength={10} maxLength={2000} className={inputCls} value={evidence} onChange={e => setEvidence(e.target.value)} /></Field>
        <p className="text-sm">Wniosek otrzyma status PENDING. Dostęp do profilu organizacji wymaga zatwierdzenia przez administratora.</p>
        <Button disabled={claim.isPending}>Zgłoś chęć reprezentowania</Button>
        <ImportDetails id={selected.id} />
      </form>}
    </section>
    <MyGovernmentOrganizations />
  </div>;
}
