import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, MessageSquareWarning, Save, X } from 'lucide-react';
import {
  getFindProposalDuplicatesQueryKey, getGetAedProposalQueryKey, useFindProposalDuplicates, useGetAedProposal, useListAedProposals, useReviewAedProposal,
  type AedProposal, type AedProposalDecisionDecision,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, ErrorState, ListSkeleton, formatDateTime } from '@/components/aed-bits';
import { errorText } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  draftFrom, draftProblems, isClosedStatus, draftToInput, invalidateRegistry, isStale, licenseLabel, methodLabel, roleLabel, type Draft,
} from '@/lib/proposals';
import { ProposalFields } from './proposal-fields';
import { LicenseChoice } from './license-choice';
import { Pager, StatusTag, Tabs } from './proposal-bits';
import { PrivatePhoto } from './photo-upload';
import { SubmissionThread } from './submission-thread';

const QUEUES = [
  { value: 'NEW', label: 'Nowe' }, { value: 'UNCOMPLETED', label: 'Do uzupełnienia' },
  { value: 'DONE', label: 'Zatwierdzone' }, { value: 'REJECTED', label: 'Odrzucone' },
] as const;
const HISTORY_LABELS:Record<string,string>={SUBMITTED:'Przekazano do weryfikacji',SAVE:'Zapisano zmiany',APPROVE:'Zatwierdzono',REJECT:'Odrzucono',REQUEST_INFO:'Poproszono o uzupełnienie'};
type Queue = typeof QUEUES[number]['value'];

export function AdminProposalQueue() {
  const [status, setStatus] = useState<Queue>('NEW');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useListAedProposals({ status, page });

  if (selected) return <ProposalDetail id={selected} onBack={() => setSelected(null)} />;
  return (
    <div>
      <Tabs value={status} onChange={(s) => { setStatus(s); setPage(1); }} items={QUEUES.map((q) => ({ value: q.value, label: q.label }))} />
      {list.isLoading ? <ListSkeleton /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data?.items.length ? (
        <EmptyState title="Kolejka jest pusta">Nowe zgłoszenia od użytkowników i organizacji pojawią się tutaj przed publikacją.</EmptyState>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {list.data.items.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setSelected(p.id)} className="flex w-full flex-col gap-2 p-4 text-left hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-proposal-${p.id}`}>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{p.payload.name || <span className="text-muted-foreground">Bez nazwy</span>}</p>
                  <p className="truncate text-sm text-muted-foreground">{[p.payload.address, p.payload.city].filter(Boolean).join(', ') || 'Brak adresu'}</p>
                  <p className="mt-1 font-data text-xs text-muted-foreground">{p.submitterName ? `${p.submitterName} · ` : ''}{p.sourceName} · {roleLabel[p.submitterRole] ?? p.submitterRole} · {methodLabel[p.submissionMethod]} · {formatDateTime(p.createdAt)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {p.issues.length > 0 && <span className="text-xs text-warn">{p.issues.length} brak(i)</span>}
                  <StatusTag status={p.status} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} total={list.data?.total ?? 0} busy={list.isFetching} onPage={setPage} />
    </div>
  );
}

function ProposalDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useGetAedProposal(id, { query: { enabled: !!id, queryKey: getGetAedProposalQueryKey(id),refetchInterval:false,refetchOnWindowFocus:false } });
  return (
    <div className="space-y-5">
      <Button variant="ghost" onClick={onBack} data-testid="button-back-queue"><ArrowLeft className="mr-2 h-4 w-4" />Wróć do kolejki</Button>
      {q.isLoading ? <ListSkeleton rows={3} /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> :
        <ProposalEditor key={`${q.data.id}-${q.data.revision}`} proposal={q.data} onDone={onBack} refresh={() => q.refetch()} />}
    </div>
  );
}

const ACTIONS: { d: AedProposalDecisionDecision; label: string; icon: typeof Check; cls?: string; variant?: 'outline' }[] = [
  { d: 'APPROVE', label: 'Zatwierdź (DONE)', icon: Check, cls: 'bg-verified text-white hover:bg-verified/90' },
  { d: 'SAVE', label: 'Zapisz zmiany', icon: Save, variant: 'outline' },
  { d: 'REQUEST_INFO', label: 'Poproś o uzupełnienie (UNCOMPLETED)', icon: MessageSquareWarning, variant: 'outline' },
  { d: 'REJECT', label: 'Odrzuć (REJECTED)', icon: X, variant: 'outline' },
];

function ProposalEditor({ proposal: p, onDone, refresh }: { proposal: AedProposal; onDone: () => void; refresh: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(p.payload));
  const [note, setNote] = useState(p.reviewNote ?? '');
  const [stale, setStale] = useState(false);
  const review = useReviewAedProposal();
  const qc = useQueryClient();
  const { toast } = useToast();
  const userSubmitted = p.submitterRole === 'USER';
  const origKnown = p.payload.license !== 'UNKNOWN' && !!p.payload.license;
  const licenseLocked = userSubmitted || (origKnown && !!p.payload.publicationConsent);
  const needsBasis = !origKnown || !p.payload.publicationConsent;
  const minApproveNote = needsBasis ? 20 : 3;
  const closed = isClosedStatus(p.status);
  const approvalProblems = draftProblems(draft, true);
  const formatProblems = draftProblems(draft, false);

  const decide = (decision: AedProposalDecisionDecision) => {
    const editing=decision==='SAVE'||decision==='APPROVE';
    if (editing&&formatProblems.length) return;
    if (decision === 'APPROVE' && approvalProblems.length) return;
    if (decision === 'APPROVE' && note.trim().length < minApproveNote) {
      toast({ title: 'Uzupełnij notatkę', description: needsBasis ? 'Opisz podstawę licencji i prawa do publikacji (min. 20 znaków).' : 'Notatka zatwierdzenia musi mieć min. 3 znaki.', variant: 'destructive' }); return;
    }
    if ((decision === 'REJECT' || decision === 'REQUEST_INFO') && note.trim().length < 3) {
      toast({ title: 'Dodaj notatkę', description: 'Zgłaszający zobaczy uzasadnienie decyzji.', variant: 'destructive' }); return;
    }
    const payload = draftToInput(draft, {
      sourceName: p.payload.sourceName, submissionMethod: p.payload.submissionMethod,
      publicationConsent: p.payload.publicationConsent,
      ...(userSubmitted ? { license: 'CC-BY-4.0' } : licenseLocked ? { license: p.payload.license } : {}),
    });
    review.mutate({ id: p.id, data: { decision, revision: p.revision, note: note.trim(), payload:editing?payload:undefined } }, {
      onSuccess: () => {
        invalidateRegistry(qc);
        qc.invalidateQueries({ queryKey: getGetAedProposalQueryKey(p.id) });
        toast({ title: { APPROVE: 'Zgłoszenie zatwierdzone', SAVE: 'Zmiany zapisane', REQUEST_INFO: 'Poproszono o uzupełnienie', REJECT: 'Zgłoszenie odrzucone' }[decision] });
        if (decision !== 'SAVE') onDone();
      },
      onError: (e) => {
        if (isStale(e)) { setStale(true); invalidateRegistry(qc); }
        toast({ title: isStale(e) ? 'Zgłoszenie zmieniło się w międzyczasie' : 'Serwer odrzucił decyzję', description: errorText(e), variant: 'destructive' });
      },
    });
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-data text-xs uppercase tracking-[0.2em] text-primary">Zgłoszenie · rewizja {p.revision}</p>
            <h2 className="font-display text-2xl font-bold">{p.payload.name || 'Bez nazwy'}</h2>
            <p className="text-sm text-muted-foreground">{p.submitterName ? <span className="font-semibold text-foreground" data-testid="text-submitter-name">{p.submitterName} · </span> : null}{p.sourceName} · {roleLabel[p.submitterRole] ?? p.submitterRole} · {methodLabel[p.submissionMethod]}</p>
          </div>
          <StatusTag status={p.status} />
        </div>
        {(p as { targetAedId?: string | null }).targetAedId && (
          <div role="note" className="rounded-xl border-2 border-dashed border-warn/50 bg-card p-4 text-sm" data-testid="notice-target-aed">
            <p className="font-semibold text-warn">Korekta istniejącego AED</p>
            <p className="mt-1 text-muted-foreground">Zatwierdzenie zmieni ten sam rekord, a nie doda nowego urządzenia. Porównaj dane z obecnym rekordem.</p>
            <Link href={`/aed/${(p as { targetAedId?: string | null }).targetAedId}`} className="mt-2 inline-block font-semibold text-primary underline" data-testid="link-target-aed">Otwórz obecny rekord</Link>
          </div>
        )}
        {stale && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-accent p-4 text-sm text-accent-foreground">
            <span>Ktoś inny zmienił to zgłoszenie. Wczytaj aktualną wersję; niezapisane zmiany zostaną utracone.</span>
            <Button size="sm" variant="outline" onClick={refresh} data-testid="button-reload-proposal">Wczytaj ponownie</Button>
          </div>
        )}
        {p.issues.length > 0 && (
          <div className="rounded-xl border bg-[hsl(var(--warn)/0.08)] p-4 text-sm">
            <p className="font-semibold text-warn">Braki wykryte przez serwer</p>
            <ul className="mt-1 list-disc pl-5">{p.issues.map((i) => <li key={i}>{i}</li>)}</ul>
          </div>
        )}
        <div>
          <p className="mb-2 text-sm font-semibold">Zdjęcie od zgłaszającego</p>
          {p.photoId ? <PrivatePhoto id={p.photoId} className="max-w-md" /> : <p className="text-sm text-muted-foreground">Brak zdjęcia w zgłoszeniu.</p>}
        </div>
        <Duplicates id={p.id} />
        {p.aedId && <p className="text-sm">Opublikowany rekord: <a className="text-primary underline" href={`/aed/${p.aedId}`}>{p.aedId}</a></p>}
        <ProposalFields value={draft} onChange={setDraft} showSourceUrl={!userSubmitted} idPrefix="admin" />
        <div>
          <p className="mb-2 font-display text-lg font-bold">Licencja</p>
          {userSubmitted ? (
            <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm">CC BY 4.0, zgoda udzielona przez zgłaszającego. Licencji zgłoszenia użytkownika nie można zmienić bez jego zgody.</p>
          ) : licenseLocked ? (
            <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm">{licenseLabel(p.payload.license)}, zgoda organizacji potwierdzona. Licencji udzielonej przez organizację nie można zmienić.</p>
          ) : (
            <>
              <LicenseChoice value={draft.license} onChange={(license) => setDraft({ ...draft, license })} consent={false} onConsent={() => undefined} showConsent={false} />
              <p className="mt-2 text-xs text-muted-foreground">Zgoda organizacji: {p.payload.publicationConsent ? 'tak' : 'brak'}. Ustaw znaną licencję tylko na podstawie potwierdzenia od organizacji.</p>
            </>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="review-note">Notatka dla zgłaszającego</Label>
          <p className="text-xs text-muted-foreground">{needsBasis ? 'Zatwierdzenie wymaga min. 20 znaków opisujących podstawę licencji i prawa do publikacji (brak licencji lub zgody w zgłoszeniu).' : 'Każda decyzja wymaga notatki (min. 3 znaki).'}</p>
          <Textarea id="review-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="np. Prosimy o dokładny adres i godziny dostępu." data-testid="input-review-note" />
        </div>
        {[...formatProblems, ...(closed ? [] : approvalProblems.filter((x) => !formatProblems.includes(x)))].length > 0 && (
          <ul className="list-disc space-y-1 rounded-xl border p-4 pl-8 text-sm text-muted-foreground">
            {formatProblems.map((x) => <li key={x} className="text-primary">{x}</li>)}
            {!closed && approvalProblems.filter((x) => !formatProblems.includes(x)).map((x) => <li key={x}>Przed zatwierdzeniem: {x}</li>)}
          </ul>
        )}
        {review.error && !isStale(review.error) && <p role="alert" className="text-sm text-primary">{errorText(review.error)}</p>}
        {closed ? <p className="text-sm text-muted-foreground">Decyzja jest ostateczna. Zgłoszenie jest tylko do odczytu.</p> : (
          <div className="flex flex-wrap gap-2 border-t pt-5">
            {ACTIONS.map((a) => (
              <Button key={a.d} variant={a.variant} className={a.cls} disabled={review.isPending || stale || (['SAVE','APPROVE'].includes(a.d)&&formatProblems.length > 0) || (a.d === 'APPROVE' && (approvalProblems.length > 0 || note.trim().length < minApproveNote))}
                onClick={() => decide(a.d)} data-testid={`button-proposal-${a.d.toLowerCase()}`}>
                <a.icon className="mr-2 h-4 w-4" />{a.label}
              </Button>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">DONE zatwierdza dane i tworzy jeden rekord w głównej bazie (ponowne zatwierdzenie nie tworzy duplikatu). Nie potwierdza fizycznej sprawności urządzenia.</p>
      </div>
      <aside className="min-w-0 space-y-3">
        <SubmissionThread kind="AED" id={p.id} />
        <p className="pt-3 font-display text-lg font-bold">Historia edycji</p>
        {p.history?.length ? (
          <ol className="space-y-3 border-l-2 pl-4">
            {p.history.map((h) => (
              <li key={h.id} className="text-sm">
                <p className="font-medium">{HISTORY_LABELS[h.action]??h.action}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</p>
                {Object.keys(h.changes ?? {}).length > 0 && <details className={cn('mt-1 text-xs text-muted-foreground')}><summary className="cursor-pointer">Szczegóły zmiany</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border p-2">{JSON.stringify(h.changes,null,2)}</pre></details>}
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-muted-foreground">Brak wpisów.</p>}
        <p className="pt-3 text-xs text-muted-foreground">Licencja w zgłoszeniu: {licenseLabel(p.payload.license)}</p>
        {p.originalData&&<details className="text-xs"><summary className="cursor-pointer font-semibold">Oryginalne dane zgłoszenia</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded border p-3">{JSON.stringify(p.originalData,null,2)}</pre></details>}
      </aside>
    </div>
  );
}

function Duplicates({ id }: { id: string }) {
  const q = useFindProposalDuplicates(id, { query: { enabled: !!id, queryKey: getFindProposalDuplicatesQueryKey(id), refetchInterval: false } });
  return (
    <section className="rounded-2xl border bg-card p-4" aria-label="Możliwe duplikaty">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">Możliwe duplikaty w bazie</p>
        <Button size="sm" variant="ghost" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-refresh-duplicates">{q.isFetching ? 'Sprawdzanie…' : 'Sprawdź ponownie'}</Button>
      </div>
      {q.isLoading ? <ListSkeleton rows={1} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} title="Nie udało się sprawdzić duplikatów" /> : !q.data?.length ? (
        <p className="mt-1 text-sm text-muted-foreground">Nie znaleziono podobnych rekordów w pobliżu.</p>
      ) : (
        <ul className="mt-2 divide-y text-sm">
          {q.data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid={`row-duplicate-${a.id}`}>
              <span className="min-w-0"><span className="font-medium">{a.name || 'Bez nazwy'}</span><span className="block text-xs text-muted-foreground">{[a.address, a.city].filter(Boolean).join(', ')}{a.latitude != null ? ` · ${a.latitude}, ${a.longitude}` : ''}</span></span>
              <a href={`/aed/${a.id}`} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Otwórz rekord</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
