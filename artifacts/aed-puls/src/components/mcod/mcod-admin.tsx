import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import {
  getListMcodInstitutionsQueryKey, useExecuteMcodInstitutionRequest, useListMcodInstitutions, useRefreshMcodInstitutions,
  useReviewMcodInstitutionRequest, useSyncMcodAeds, type McodEntity, type McodWorkspace,
} from '@workspace/api-client-react';
import { ErrorState, ListSkeleton, formatDateTime } from '@/components/aed-bits';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { PlanCard } from './mcod-publication';
import { BlockedNote, EventsList, Field, IntegrationBanner, MISSING_REVISION, Section, StatusPill, inputCls, remoteBlock, rev, str, syncEnabled, useErr, useInvalidate } from './mcod-shared';

function ReviewCard({ r, ws }: { r: McodEntity; ws: McodWorkspace }) {
  const review = useReviewMcodInstitutionRequest();
  const exec = useExecuteMcodInstitutionRequest();
  const inv = useInvalidate();
  const err = useErr();
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [verified, setVerified] = useState(false);
  const details = (r.details ?? {}) as Record<string, unknown>;
  const revision = rev(r);
  const block = remoteBlock(ws, ws.status.writesEnabled);
  const decide = (decision: 'APPROVE' | 'REJECT') => {
    if (revision == null) return;
    review.mutate({ id: r.id, data: { decision, expectedRevision: revision, note: note.trim(), representativeVerified: verified } }, { onSuccess: () => { inv(); toast({ title: decision === 'APPROVE' ? 'Wniosek zatwierdzony lokalnie' : 'Wniosek odrzucony' }); }, onError: err('Decyzja odrzucona') });
  };
  const noteOk = note.trim().length >= 5;
  return (
    <li className="rounded-xl border p-4" data-testid={`card-request-${r.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{str(r, 'organizationName') || str(r, 'institutionId')} <span className="font-data text-xs text-muted-foreground">{str(r, 'kind')}</span></p><StatusPill status={r.status} /></div>
      <p className="mt-1 text-sm text-muted-foreground">{str(r, 'representativeName')}, {str(r, 'representativeRole')} · {str(r, 'representativeEmail')}</p>
      {Object.keys(details).length > 0 && <dl className="mt-2 grid gap-x-4 text-xs sm:grid-cols-2">{Object.entries(details).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => <div key={k}><dt className="inline text-muted-foreground">{k}: </dt><dd className="inline">{String(v)}</dd></div>)}</dl>}
      {r.status === 'PENDING_VERIFICATION' && (
        revision == null ? <p role="alert" className="mt-3 text-sm text-primary">{MISSING_REVISION}</p> : (
          <div className="mt-3 space-y-2">
            <Field label="Dowód weryfikacji (wymagany, min. 5 znaków)"><textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="np. potwierdzenie telefoniczne z sekretariatem, pismo nr..." data-testid={`input-review-note-${r.id}`} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} data-testid={`checkbox-verified-${r.id}`} />Potwierdziłem tożsamość przedstawiciela</label>
            <div className="flex gap-2">
              <Button size="sm" disabled={!noteOk || !verified || review.isPending} onClick={() => decide('APPROVE')} data-testid={`button-approve-request-${r.id}`}>Zatwierdź</Button>
              <Button size="sm" variant="outline" disabled={!noteOk || review.isPending} onClick={() => decide('REJECT')} data-testid={`button-reject-request-${r.id}`}>Odrzuć</Button>
            </div>
            <p className="text-xs text-muted-foreground">Zatwierdzenie dotyczy przedstawiciela w AED Puls. Nie tworzy instytucji w MCOD.</p>
          </div>
        )
      )}
      {r.status === 'APPROVED' && (
        <div className="mt-3 space-y-1">
          <Button size="sm" variant="outline" disabled={!!block || exec.isPending} onClick={() => exec.mutate({ id: r.id }, { onSuccess: () => { inv(); toast({ title: 'Wynik wykonania zapisany' }); }, onError: err('Wykonanie zablokowane') })} data-testid={`button-execute-request-${r.id}`}>Wykonaj w MCOD</Button>
          <BlockedNote reason={block} />
        </div>
      )}
    </li>
  );
}

function AdminInstitutions() {
  const [search, setSearch] = useState('');
  const p = { page: 1, search: search || undefined };
  const q = useListMcodInstitutions(p, { query: { queryKey: getListMcodInstitutionsQueryKey(p) } });
  return (
    <Section title="Katalog instytucji (kopia lokalna)">
      <input className={inputCls} aria-label="Szukaj instytucji" placeholder="Szukaj" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-admin-institution-search" />
      <div className="mt-3">{q.isLoading ? <ListSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? <p className="text-sm text-muted-foreground">{q.data?.activationRequired ? 'Brak kopii katalogu. Integracja MCOD oczekuje na aktywację.' : 'Brak wyników.'}</p> : (
        <><p className="mb-2 text-xs text-muted-foreground">{q.data.total} instytucji w pamięci podręcznej</p><ul className="max-h-64 divide-y overflow-auto text-sm">{q.data.items.map((i) => <li key={i.id} className="py-1.5">{str(i, 'name')} <span className="font-data text-xs text-muted-foreground">{i.id}</span></li>)}</ul></>
      )}</div>
    </Section>
  );
}

export function AdminView({ ws }: { ws: McodWorkspace }) {
  const refresh = useRefreshMcodInstitutions();
  const sync = useSyncMcodAeds();
  const qc = useQueryClient();
  const inv = useInvalidate();
  const err = useErr();
  const { toast } = useToast();
  const refreshBlock = remoteBlock(ws, ws.status.enabled);
  const syncBlock = remoteBlock(ws, syncEnabled(ws.status));
  const pending = ws.institutionRequests.filter((r) => r.status === 'PENDING_VERIFICATION');
  const rest = ws.institutionRequests.filter((r) => r.status !== 'PENDING_VERIFICATION');
  return (
    <>
      <IntegrationBanner ws={ws} />
      <div className="flex flex-wrap items-start gap-2">
        <div className="space-y-1">
          <Button variant="outline" disabled={!!refreshBlock || refresh.isPending} onClick={() => refresh.mutate(undefined, { onSuccess: (r) => { inv(); qc.invalidateQueries({ queryKey: getListMcodInstitutionsQueryKey() }); toast({ title: r.message, description: `${r.count}` }); }, onError: err('Odświeżenie zablokowane') })} data-testid="button-refresh-institutions"><RefreshCw className="mr-2 h-4 w-4" />Odśwież katalog instytucji</Button>
          <BlockedNote reason={refreshBlock} />
        </div>
        <div className="space-y-1">
          <Button variant="outline" disabled={!!syncBlock || sync.isPending} onClick={() => sync.mutate(undefined, { onSuccess: (r) => { inv(); toast({ title: String(r.message ?? 'Synchronizacja zakończona'), description: String(r.status ?? '') }); }, onError: err('Synchronizacja zablokowana') })} data-testid="button-sync-aeds"><RefreshCw className="mr-2 h-4 w-4" />Synchronizuj AED</Button>
          <BlockedNote reason={syncBlock} />
        </div>
        <Button asChild variant="ghost"><Link href="/admin/submissions">Moderacja zgłoszeń AED</Link></Button>
        <Button asChild variant="ghost"><Link href="/admin/reports">Zgłoszenia błędów</Link></Button>
        <Button asChild variant="ghost"><Link href="/admin/aeds">Rekordy</Link></Button>
      </div>
      <Section title={`Wnioski organizacji do weryfikacji (${pending.length})`}>
        {pending.length ? <ul className="space-y-3">{pending.map((r) => <ReviewCard key={r.id} r={r} ws={ws} />)}</ul> : <p className="text-sm text-muted-foreground">Brak wniosków oczekujących.</p>}
      </Section>
      {rest.length > 0 && <Section title="Rozpatrzone wnioski"><ul className="space-y-3">{rest.map((r) => <ReviewCard key={r.id} r={r} ws={ws} />)}</ul></Section>}
      <AdminInstitutions />
      <Section title="Plany publikacji i historia">
        {ws.plans.length ? <ul className="space-y-3">{ws.plans.map((p) => <PlanCard key={p.id} plan={p} ws={ws} />)}</ul> : <p className="text-sm text-muted-foreground">Żadna organizacja nie przygotowała jeszcze planu.</p>}
      </Section>
      <Section title="Przebiegi synchronizacji">
        {ws.syncRuns.length ? <ul className="divide-y text-sm">{ws.syncRuns.map((s) => <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{str(s, 'kind') || s.id}</span><span className="flex items-center gap-2"><StatusPill status={s.status} /><span className="text-xs text-muted-foreground">{formatDateTime(str(s, 'createdAt'))}</span></span></li>)}</ul> : <p className="text-sm text-muted-foreground">Brak przebiegów. Synchronizacja nie była uruchamiana.</p>}
      </Section>
      <EventsList ws={ws} />
    </>
  );
}
