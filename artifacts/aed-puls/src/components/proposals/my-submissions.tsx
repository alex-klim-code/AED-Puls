import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, PencilLine } from 'lucide-react';
import {
  getGetAedProposalQueryKey, getGetConflictReportQueryKey, getGetSubmissionThreadQueryKey,
  useGetAedProposal, useGetConflictReport, useListAedProposals, useListConflictReports, useResubmitAedProposal,
  type AedProposal, type SubmissionLocation,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, ErrorState, ListSkeleton, accessibilityLabel, placementLabel } from '@/components/aed-bits';
import { SubmissionGps } from '@/components/submission-gps';
import { errorText, useSession } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { draftFrom, draftProblems, draftToInput, formatStamp, invalidateRegistry, isStale, licenseLabel, methodLabel, type Draft } from '@/lib/proposals';
import { Pager, StatusTag, Tabs } from './proposal-bits';
import { ProposalFields } from './proposal-fields';
import { LicenseChoice } from './license-choice';
import { PrivatePhoto } from './photo-upload';
import { SubmissionThread } from './submission-thread';

type Open = { kind: 'AED' | 'ERROR'; id: string } | null;

export function MySubmissionsView() {
  const [tab, setTab] = useState<'aed' | 'reports'>('aed');
  const [open, setOpen] = useState<Open>(null);
  if (open) return (
    <div className="space-y-5">
      <Button variant="ghost" onClick={() => setOpen(null)} data-testid="button-back-my-submissions"><ArrowLeft className="mr-2 h-4 w-4" />Wróć do listy</Button>
      {open.kind === 'AED' ? <OwnProposal id={open.id} /> : <OwnReport id={open.id} />}
    </div>
  );
  return (
    <div>
      <Tabs value={tab} onChange={(v) => setTab(v as typeof tab)} items={[{ value: 'aed', label: 'Zgłoszenia AED' }, { value: 'reports', label: 'Zgłoszenia błędów' }]} />
      {tab === 'aed' ? <ProposalList onOpen={(id) => setOpen({ kind: 'AED', id })} /> : <ReportList onOpen={(id) => setOpen({ kind: 'ERROR', id })} />}
    </div>
  );
}

function Row({ onClick, testId, title, sub, meta, status, kind, note }: { onClick: () => void; testId: string; title: string; sub?: string; meta: string; status: string; kind: 'AED' | 'ERROR'; note?: string }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/50" data-testid={testId}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 font-semibold">{title}</p>
            <StatusTag status={status} kind={kind} />
          </div>
          {sub && <p className="truncate text-sm text-muted-foreground">{sub}</p>}
          <p className="mt-1 font-data text-xs text-muted-foreground">{meta}</p>
          {note && <p className="mt-2 line-clamp-2 rounded-lg bg-muted/60 px-3 py-1.5 text-sm"><span className="font-semibold">Administrator: </span>{note}</p>}
          {status === 'UNCOMPLETED' && kind === 'AED' && <p className="mt-2 text-xs font-semibold text-warn">Wymaga uzupełnienia. Otwórz, aby poprawić i wysłać ponownie.</p>}
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  );
}

function ProposalList({ onOpen }: { onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const q = useListAedProposals({ page });
  if (q.isLoading) return <ListSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.items.length) return <EmptyState title="Brak zgłoszeń AED" action={<Button asChild><Link href="/submit-aed">Dodaj AED</Link></Button>}>Dodane urządzenia czekają tutaj na decyzję administratora.</EmptyState>;
  return (
    <>
      <ul className="divide-y rounded-2xl border bg-card">
        {q.data.items.map((p) => (
          <Row key={p.id} onClick={() => onOpen(p.id)} testId={`row-my-proposal-${p.id}`} kind="AED" status={p.status} note={p.reviewNote}
            title={p.payload.name || 'Bez nazwy'} sub={[p.payload.address, p.payload.city].filter(Boolean).join(', ') || 'Adres do uzupełnienia'}
            meta={`Zgłoszenie AED · ${methodLabel[p.submissionMethod] ?? p.submissionMethod} · ${formatStamp(p.createdAt)}`} />
        ))}
      </ul>
      <Pager page={page} total={q.data.total} busy={q.isFetching} onPage={setPage} />
    </>
  );
}

function ReportList({ onOpen }: { onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const q = useListConflictReports({ page });
  if (q.isLoading) return <ListSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.items.length) return <EmptyState title="Brak zgłoszonych błędów" action={<Button asChild variant="outline"><Link href="/report">Zgłoś błąd</Link></Button>}>Błędy zgłoszone przez mapę pojawią się tutaj wraz z decyzją.</EmptyState>;
  return (
    <>
      <ul className="divide-y rounded-2xl border bg-card">
        {q.data.items.map((r) => (
          <Row key={r.id} onClick={() => onOpen(r.id)} testId={`row-my-report-${r.id}`} kind="ERROR" status={r.status} note={r.reviewNote}
            title={r.aedName} sub={r.message} meta={`Zgłoszenie błędu · ${formatStamp(r.createdAt)}`} />
        ))}
      </ul>
      <Pager page={page} total={q.data.total} busy={q.isFetching} onPage={setPage} />
    </>
  );
}

function Header({ type, title, created, status, kind, note }: { type: string; title: string; created: string; status: string; kind: 'AED' | 'ERROR'; note?: string }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-data text-xs uppercase tracking-[0.2em] text-primary">{type}</p>
          <h2 className="font-display text-2xl font-bold" data-testid="text-submission-title">{title}</h2>
          <p className="text-sm text-muted-foreground">Utworzono {formatStamp(created)}</p>
        </div>
        <StatusTag status={status} kind={kind} />
      </div>
      {note && <p className="rounded-xl border-l-4 border-primary bg-accent/60 px-4 py-3 text-sm" data-testid="text-review-note"><span className="font-semibold">Notatka administratora: </span>{note}</p>}
    </div>
  );
}

function OwnProposal({ id }: { id: string }) {
  const q = useGetAedProposal(id, { query: { enabled: !!id, queryKey: getGetAedProposalQueryKey(id), refetchInterval: false, refetchOnWindowFocus: false } });
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  if (q.isLoading) return <ListSkeleton rows={3} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  const canEdit = p.status === 'UNCOMPLETED' && (user?.role === 'USER' || user?.role === 'PROVIDER');
  const v = p.payload;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="space-y-6">
        <Header type={`Zgłoszenie AED · rewizja ${p.revision}`} title={v.name || 'Bez nazwy'} created={p.createdAt} status={p.status} kind="AED" note={p.reviewNote} />
        {p.status === 'DONE' && p.aedId && <p className="text-sm"><Link href={`/aed/${p.aedId}`} className="text-primary underline">Zobacz opublikowany rekord</Link> · zatwierdzenie dotyczy danych, nie sprawności urządzenia.</p>}
        {canEdit && !editing && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--warn)/0.4)] bg-[hsl(var(--warn)/0.08)] p-4">
            <p className="text-sm">Administrator prosi o uzupełnienie. Popraw dane i wyślij ponownie; zgłoszenie wróci do statusu NEW.</p>
            <Button onClick={() => setEditing(true)} data-testid="button-start-resubmit"><PencilLine className="mr-2 h-4 w-4" />Uzupełnij zgłoszenie</Button>
          </div>
        )}
        {canEdit && editing ? <ResubmitForm key={p.id} proposal={p} isUser={user?.role === 'USER'} refresh={() => q.refetch()} onDone={() => setEditing(false)} /> : (
          <dl className="grid gap-x-6 gap-y-3 rounded-2xl border bg-card p-5 text-sm sm:grid-cols-2">
            <Field k="Adres" v={[v.address, v.postalCode, v.city].filter(Boolean).join(', ')} />
            <Field k="Współrzędne" v={v.latitude != null && v.longitude != null ? `${v.latitude}, ${v.longitude}` : ''} mono />
            <Field k="Umiejscowienie" v={placementLabel[v.placement ?? 'unknown'] ?? v.placement} />
            <Field k="Dostęp" v={`${accessibilityLabel[v.accessibility] ?? v.accessibility}${v.openingHours ? ` · ${v.openingHours}` : ''}`} />
            <Field k="Opis" v={v.description} span />
            <Field k="Metoda" v={methodLabel[p.submissionMethod] ?? p.submissionMethod} />
            <Field k="Licencja" v={licenseLabel(v.license)} />
          </dl>
        )}
        <div>
          <p className="mb-2 text-sm font-semibold">Zdjęcie dołączone do zgłoszenia</p>
          {p.photoId ? <PrivatePhoto id={p.photoId} className="max-w-md" /> : <p className="text-sm text-muted-foreground">Brak zdjęcia. Zdjęcie korekty możesz dodać w komentarzu.</p>}
        </div>
      </div>
      <SubmissionThread kind="AED" id={p.id} />
    </div>
  );
}

function Field({ k, v, mono, span }: { k: string; v?: string | null; mono?: boolean; span?: boolean }) {
  return <div className={span ? 'sm:col-span-2' : ''}><dt className="text-xs text-muted-foreground">{k}</dt><dd className={mono ? 'font-data' : ''}>{v || <span className="text-muted-foreground">brak</span>}</dd></div>;
}

function ResubmitForm({ proposal: p, isUser, refresh, onDone }: { proposal: AedProposal; isUser: boolean; refresh: () => Promise<{ data?: AedProposal }>; onDone: () => void }) {
  const [rev, setRev] = useState(p.revision);
  const [baseDraft, setBaseDraft] = useState<Draft>(() => draftFrom(p.payload));
  const [draft, setDraft] = useState<Draft>(() => draftFrom(p.payload));
  const [gps, setGps] = useState<SubmissionLocation | null>(null);
  const [changeGps, setChangeGps] = useState(false);
  const [consent, setConsent] = useState(!!p.payload.publicationConsent);
  const [note, setNote] = useState('');
  const [stale, setStale] = useState(false);
  const resubmit = useResubmitAedProposal();
  const qc = useQueryClient();
  const { toast } = useToast();

  const onGps = (g: SubmissionLocation | null) => {
    setGps(g);
    if (g) setDraft((d) => ({ ...d, address: g.address, city: g.city, postalCode: g.postalCode, voivodeship: g.voivodeship, latitude: String(g.latitude), longitude: String(g.longitude) }));
  };
  const cancelGps = () => { setChangeGps(false); setGps(null); const o = baseDraft; setDraft((d) => ({ ...d, address: o.address, city: o.city, postalCode: o.postalCode, voivodeship: o.voivodeship, latitude: o.latitude, longitude: o.longitude })); };

  const problems = draftProblems(draft, false);
  const needConsent = isUser || draft.license !== 'UNKNOWN';
  const blocked = problems.length > 0 || note.trim().length < 3 || (isUser && changeGps && !gps) || (needConsent && !consent) || resubmit.isPending;

  const send = () => {
    if (blocked) return;
    const payload = draftToInput(draft, {
      sourceName: p.payload.sourceName, submissionMethod: p.payload.submissionMethod,
      publicationConsent: needConsent ? consent : false,
      ...(isUser ? { license: 'CC-BY-4.0', sourceUrl: '' } : {}),
      ...(isUser && gps ? { locationToken: gps.locationToken } : {}),
    });
    delete (payload as { photoId?: unknown }).photoId;
    resubmit.mutate({ id: p.id, data: { revision: rev, payload, note: note.trim() } }, {
      onSuccess: () => {
        invalidateRegistry(qc);
        qc.invalidateQueries({ queryKey: getGetAedProposalQueryKey(p.id) });
        qc.invalidateQueries({ queryKey: getGetSubmissionThreadQueryKey('AED', p.id) });
        toast({ title: 'Uzupełnienie wysłane', description: 'Zgłoszenie wróciło do kolejki administratora (NEW).' });
        onDone();
      },
      onError: (e) => { if (isStale(e)) setStale(true); },
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); send(); }} noValidate className="space-y-6 rounded-2xl border bg-card p-5">
      <p className="font-display text-lg font-bold">Uzupełnij dane</p>
      {stale && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-accent p-3 text-sm text-accent-foreground">
          <span>Zgłoszenie zmieniło się w międzyczasie. Pobierz aktualną wersję; Twoje zmiany w formularzu zostaną zachowane.</span>
          <Button type="button" size="sm" variant="outline" onClick={async () => { resubmit.reset(); const res = await refresh(); const fresh = res.data; if (!fresh) return;
            const nb = draftFrom(fresh.payload);
            const LOC = ['address', 'city', 'postalCode', 'voivodeship', 'latitude', 'longitude'] as const;
            const keys = Object.keys(draft) as (keyof Draft)[];
            const merged = { ...nb } as Draft;
            for (const k of keys) if (draft[k] !== baseDraft[k]) (merged as Record<string, unknown>)[k] = draft[k];
            // A fresh GPS receipt stays only with its own coordinates; otherwise location comes from the server unless the user edited it.
            if (gps) for (const k of LOC) (merged as Record<string, unknown>)[k] = draft[k];
            setDraft(merged); setBaseDraft(nb); setRev(fresh.revision); setStale(false); }} data-testid="button-refresh-proposal">Odśwież zgłoszenie</Button>
        </div>
      )}
      {isUser && (
        changeGps ? (
          <div className="space-y-2">
            <SubmissionGps value={gps} onChange={onGps} />
            <Button type="button" size="sm" variant="ghost" onClick={cancelGps} data-testid="button-keep-gps">Zachowaj pierwotną lokalizację</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/50 p-3 text-sm">
            <span>Lokalizacja pochodzi z GPS i pozostanie bez zmian.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setChangeGps(true)} data-testid="button-change-gps">Zmień przez GPS</Button>
          </div>
        )
      )}
      <ProposalFields value={draft} onChange={setDraft} locked={isUser} showSourceUrl={!isUser} idPrefix="resubmit" />
      {isUser ? (
        <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-primary" data-testid="checkbox-resubmit-consent" />
          <span>Potwierdzam zgodę na udostępnienie zgłoszenia na licencji CC BY 4.0.</span>
        </label>
      ) : <LicenseChoice value={draft.license} onChange={(license) => setDraft({ ...draft, license })} consent={consent} onConsent={setConsent} />}
      <p className="text-xs text-muted-foreground">Pierwotne zdjęcie pozostaje w zgłoszeniu. Nowe zdjęcie dodaj w komentarzu.</p>
      <div className="space-y-1.5">
        <Label htmlFor="resubmit-note">Co zostało uzupełnione?</Label>
        <Textarea id="resubmit-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="np. Dodałem godziny otwarcia i opis wejścia." data-testid="input-resubmit-note" />
        <p className="text-xs text-muted-foreground">Wymagane, min. 3 znaki.</p>
      </div>
      {problems.length > 0 && <ul className="list-disc rounded-xl border border-primary/30 p-3 pl-8 text-sm text-primary">{problems.map((x) => <li key={x}>{x}</li>)}</ul>}
      {resubmit.error && !stale && <p role="alert" className="text-sm text-primary">{errorText(resubmit.error)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={blocked || stale} data-testid="button-resubmit">{resubmit.isPending ? 'Wysyłanie…' : 'Wyślij ponownie do weryfikacji'}</Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={resubmit.isPending}>Anuluj</Button>
      </div>
    </form>
  );
}

function OwnReport({ id }: { id: string }) {
  const q = useGetConflictReport(id, { query: { enabled: !!id, queryKey: getGetConflictReportQueryKey(id), refetchInterval: false, refetchOnWindowFocus: false } });
  if (q.isLoading) return <ListSkeleton rows={3} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="space-y-6">
        <Header type="Zgłoszenie błędu" title={r.aedName} created={r.createdAt} status={r.status} kind="ERROR" note={r.reviewNote} />
        <p className="text-sm"><Link href={`/aed/${r.aedId}`} className="text-primary underline">Otwórz rekord AED</Link></p>
        <blockquote className="whitespace-pre-wrap border-l-2 border-primary pl-4 text-sm">{r.message}</blockquote>
        <div>
          <p className="mb-2 text-sm font-semibold">Zdjęcie dołączone do zgłoszenia</p>
          {r.photoId ? <PrivatePhoto id={r.photoId} className="max-w-md" /> : <p className="text-sm text-muted-foreground">Brak zdjęcia.</p>}
        </div>
      </div>
      <SubmissionThread kind="ERROR" id={r.id} />
    </div>
  );
}
