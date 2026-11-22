import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, X } from 'lucide-react';
import {
  getGetConflictReportQueryKey, getGetSubmissionThreadQueryKey, useGetConflictReport, useListConflictReports, useReviewConflictReport,
  type AdminRecordUpdateInput, type Aed, type ConflictReport, type ConflictReportDecisionStatus,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/aed-bits';
import { errorText } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { formatStamp, invalidateRegistry, isClosedStatus, isStale } from '@/lib/proposals';
import { Pager, StatusTag, Tabs } from './proposal-bits';
import { PrivatePhoto } from './photo-upload';
import { SubmissionThread } from './submission-thread';

const QUEUES = [
  { value: 'NEW', label: 'Nowe' }, { value: 'UNCOMPLETED', label: 'Starsze: do uzupełnienia' },
  { value: 'DONE', label: 'Poprawione' }, { value: 'REJECTED', label: 'Odrzucone' },
] as const;
type Queue = typeof QUEUES[number]['value'];

export function AdminReportQueue() {
  const [status, setStatus] = useState<Queue>('NEW');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useListConflictReports({ status, page });
  if (selected) return (
    <div className="space-y-5">
      <Button variant="ghost" onClick={() => setSelected(null)} data-testid="button-back-reports"><ArrowLeft className="mr-2 h-4 w-4" />Wróć do kolejki</Button>
      <ReportDetail id={selected} onDone={() => setSelected(null)} />
    </div>
  );
  return (
    <div>
      <Tabs value={status} onChange={(s) => { setStatus(s); setPage(1); }} items={QUEUES.map((q) => ({ value: q.value, label: q.label }))} />
      <p className="mb-4 text-sm text-muted-foreground">Zgłoszenie błędu nigdy nie tworzy nowego AED. DONE wymaga rzeczywistej poprawki istniejącego rekordu; zmiana i decyzja zapisują się razem w historii.</p>
      {list.isLoading ? <ListSkeleton /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data?.items.length ? (
        <EmptyState title="Brak zgłoszeń w tej kolejce">Gdy ktoś zgłosi nieprawidłowe dane, zobaczysz je tutaj.</EmptyState>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {list.data.items.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setSelected(r.id)} className="flex w-full flex-col gap-2 p-4 text-left hover:bg-muted/50 sm:flex-row sm:items-start sm:justify-between" data-testid={`row-report-${r.id}`}>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.aedName}</p>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{r.message}</p>
                  <p className="mt-1 font-data text-xs text-muted-foreground">{r.submitterName ? `${r.submitterName} · ` : ''}{r.sourceName} · {formatStamp(r.createdAt)}{r.photoId ? ' · ze zdjęciem' : ''}</p>
                </div>
                <StatusTag status={r.status} kind="ERROR" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} total={list.data?.total ?? 0} busy={list.isFetching} onPage={setPage} />
    </div>
  );
}

function ReportDetail({ id, onDone }: { id: string; onDone: () => void }) {
  const q = useGetConflictReport(id, { query: { enabled: !!id, queryKey: getGetConflictReportQueryKey(id), refetchInterval: false, refetchOnWindowFocus: false } });
  if (q.isLoading) return <ListSkeleton rows={3} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <ReportReview key={q.data.id} report={q.data} refresh={() => q.refetch()} refreshing={q.isFetching} onDone={onDone} />;
}

type Form = { name: string; address: string; city: string; postalCode: string; latitude: string; longitude: string; description: string; openingHours: string; accessibility: string; placement: string };
const shown = (v: unknown) => (typeof v === 'string' && v.trim().toUpperCase() !== 'UNKNOWN' ? v : '');
const formFrom = (a: Aed): Form => ({
  name: shown(a.name), address: shown(a.address), city: shown(a.city), postalCode: shown(a.postalCode),
  latitude: typeof a.latitude === 'number' ? String(a.latitude) : '', longitude: typeof a.longitude === 'number' ? String(a.longitude) : '',
  description: shown(a.description), openingHours: shown(a.openingHours), accessibility: a.accessibility ?? 'unknown', placement: a.placement ?? 'unknown',
});
const num = (s: string): number | null | 'bad' => { const t = s.trim().replace(',', '.'); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : 'bad'; };
const LABELS: Record<keyof Form, string> = { name: 'Nazwa', address: 'Adres', city: 'Miejscowość', postalCode: 'Kod pocztowy', latitude: 'Szerokość', longitude: 'Długość', description: 'Opis', openingHours: 'Godziny dostępu', accessibility: 'Dostęp', placement: 'Umiejscowienie' };

function ReportReview({ report: live, refresh, refreshing, onDone }: { report: ConflictReport; refresh: () => Promise<{ data?: ConflictReport }>; refreshing: boolean; onDone: () => void }) {
  // Snapshot: background refetches never change the revisions this form authorizes.
  const [r, setR] = useState<ConflictReport>(live);
  const target = r.target;
  const base = useMemo(() => (target ? formFrom(target) : null), [target]);
  const [form, setForm] = useState<Form | null>(base);
  const [note, setNote] = useState(r.reviewNote ?? '');
  const [stale, setStale] = useState(false);
  const review = useReviewConflictReport();
  const qc = useQueryClient();
  const { toast } = useToast();
  const closed = isClosedStatus(r.status);

  const lat = form ? num(form.latitude) : null, lon = form ? num(form.longitude) : null;
  const coordErr = !form ? null : lat === 'bad' || lon === 'bad' ? 'Współrzędne muszą być liczbami.' : (lat === null) !== (lon === null) ? 'Podaj obie współrzędne albo żadnej.'
    : lat !== null && (lat < 49 || lat > 55) ? 'Szerokość poza Polską (49–55).' : lon !== null && (lon < 14 || lon > 24.2) ? 'Długość poza Polską (14–24,2).' : null;
  const dirty = form && base ? (Object.keys(form) as (keyof Form)[]).filter((k) => form[k].trim() !== base[k].trim()) : [];

  const correction = (): AdminRecordUpdateInput | null => {
    if (!form || !target?.revision || !dirty.length || coordErr) return null;
    const d: AdminRecordUpdateInput = { expectedUpdatedAt: target.revision };
    for (const k of dirty) {
      const v = form[k].trim();
      if (k === 'name' || k === 'address' || k === 'city') d[k] = v;
      else if (k === 'postalCode' || k === 'description' || k === 'openingHours') d[k] = v || null;
      else if (k === 'accessibility') d.accessibility = v as AdminRecordUpdateInput['accessibility'];
      else if (k === 'placement') d.placement = v as AdminRecordUpdateInput['placement'];
    }
    if (dirty.includes('latitude') || dirty.includes('longitude')) { d.latitude = lat as number | null; d.longitude = lon as number | null; }
    return d;
  };

  const decide = (status: ConflictReportDecisionStatus) => {
    const fix = status === 'DONE' ? correction() : null;
    if (note.trim().length < 3 || (status === 'DONE' && !fix)) return;
    review.mutate({ id: r.id, data: { status, revision: r.revision, note: note.trim(), ...(fix ? { correction: fix } : {}) } }, {
      onSuccess: () => {
        invalidateRegistry(qc);
        qc.invalidateQueries({ queryKey: getGetConflictReportQueryKey(r.id) });
        qc.invalidateQueries({ queryKey: getGetSubmissionThreadQueryKey('ERROR', r.id) });
        if (target) qc.invalidateQueries({ queryKey: [`/api/aeds/${target.id}`] });
        toast({ title: status === 'DONE' ? 'Poprawka zastosowana, zgłoszenie DONE' : 'Zgłoszenie odrzucone' });
        onDone();
      },
      onError: (e) => { if (isStale(e)) setStale(true); },
    });
  };

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f));
  const txt = (k: keyof Form, span = false, mono = false) => (
    <div className={span ? 'space-y-1 sm:col-span-2' : 'space-y-1'}>
      <Label htmlFor={`fix-${k}`} className={dirty.includes(k) ? 'text-primary' : ''}>{LABELS[k]}{dirty.includes(k) ? ' · zmienione' : ''}</Label>
      {k === 'description' ? <Textarea id={`fix-${k}`} rows={2} value={form?.[k] ?? ''} onChange={set(k)} disabled={closed} maxLength={2000} data-testid={`input-fix-${k}`} />
        : <Input id={`fix-${k}`} value={form?.[k] ?? ''} onChange={set(k)} disabled={closed} className={mono ? 'font-data' : ''} data-testid={`input-fix-${k}`} />}
      {base && dirty.includes(k) && <p className="text-xs text-muted-foreground">Było: {base[k] || 'brak'}</p>}
    </div>
  );
  const sel = (k: 'accessibility' | 'placement', items: [string, string][]) => (
    <div className="space-y-1">
      <Label htmlFor={`fix-${k}`} className={dirty.includes(k) ? 'text-primary' : ''}>{LABELS[k]}</Label>
      <select id={`fix-${k}`} value={form?.[k] ?? 'unknown'} onChange={set(k)} disabled={closed} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid={`select-fix-${k}`}>
        {items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );

  const noteOk = note.trim().length >= 3;
  const doneBlocked = !noteOk || !dirty.length || !!coordErr || !target?.revision || review.isPending || stale;

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-data text-xs uppercase tracking-[0.2em] text-primary">Zgłoszenie błędu · rewizja {r.revision}</p>
            <h2 className="font-display text-2xl font-bold">{r.aedName}</h2>
            <p className="text-sm text-muted-foreground">{r.submitterName && <span className="font-semibold text-foreground">{r.submitterName} · </span>}{r.sourceName} · {formatStamp(r.createdAt)}</p>
          </div>
          <StatusTag status={r.status} kind="ERROR" />
        </div>
        <blockquote className="whitespace-pre-wrap border-l-2 border-primary pl-4 text-sm" data-testid="text-report-message">{r.message}</blockquote>
        <div>
          <p className="mb-2 text-sm font-semibold">Zdjęcie od zgłaszającego</p>
          {r.photoId ? <PrivatePhoto id={r.photoId} className="max-w-md" /> : <p className="text-sm text-muted-foreground">Brak zdjęcia.</p>}
        </div>
        {stale && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-accent p-4 text-sm text-accent-foreground">
            <span>Rekord AED lub zgłoszenie zmieniły się w międzyczasie. Odśwież dane; Twoje zmiany w formularzu pozostaną, ale porównaj je z aktualnym stanem.</span>
            <Button size="sm" variant="outline" disabled={refreshing} onClick={async () => {
              review.reset();
              const res = await refresh();
              const fresh = res.data;
              if (!fresh) return;
              const nb = fresh.target ? formFrom(fresh.target) : null;
              const userDirty = dirty;
              setForm((f) => { if (!nb) return null; if (!f) return nb; const m = { ...nb }; for (const k of userDirty) m[k] = f[k]; return m; });
              setR(fresh);
              setStale(false);
            }} data-testid="button-refresh-report">{refreshing ? 'Odświeżanie…' : 'Odśwież dane'}</Button>
          </div>
        )}
        {!target ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nie udało się wczytać powiązanego rekordu AED. Możesz jedynie odrzucić zgłoszenie.</p> : (
          <section className="space-y-4 rounded-2xl border bg-card p-5" aria-label="Poprawka rekordu">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-display text-lg font-bold">Poprawka rekordu AED</p>
              <a href={`/aed/${target.id}`} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Rekord publiczny</a>
            </div>
            <p className="text-xs text-muted-foreground">Zmiany nie są zapisywane osobno. Zostaną zastosowane razem z decyzją DONE (rewizja rekordu {target.revision ?? 'nieznana'}).</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {txt('name', true)}{txt('address')}{txt('city')}{txt('postalCode')}{txt('openingHours')}
              {txt('latitude', false, true)}{txt('longitude', false, true)}
              {sel('accessibility', [['24/7', 'Całodobowo (24/7)'], ['limited', 'W określonych godzinach'], ['unknown', 'Nie wiem']])}
              {sel('placement', [['indoor', 'Wewnątrz budynku'], ['outdoor', 'Na zewnątrz'], ['unknown', 'Nie wiem']])}
              {txt('description', true)}
            </div>
            {coordErr && <p role="alert" className="text-sm text-primary">{coordErr}</p>}
            {!closed && dirty.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => setForm(base)} data-testid="button-reset-fix">Cofnij zmiany w formularzu</Button>}
          </section>
        )}
        {!closed && (
          <div className="space-y-3 border-t pt-5">
            <Label htmlFor="report-note">Notatka z rozpatrzenia (widoczna dla zgłaszającego)</Label>
            <Textarea id="report-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="np. Zaktualizowano godziny dostępu zgodnie z opisem." data-testid="input-report-note" />
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              <li className={noteOk ? 'text-verified' : ''}>Notatka min. 3 znaki</li>
              <li className={dirty.length ? 'text-verified' : ''}>DONE: zmieniono co najmniej jedno pole ({dirty.length})</li>
            </ul>
            {review.error && !stale && <p role="alert" className="text-sm text-primary">{errorText(review.error)}</p>}
            <div className="flex flex-wrap gap-2">
              <Button className="bg-verified text-white hover:bg-verified/90" disabled={doneBlocked} onClick={() => decide('DONE')} data-testid="button-report-done"><Check className="mr-2 h-4 w-4" />{review.isPending ? 'Zapisywanie…' : 'Zastosuj poprawkę (DONE)'}</Button>
              <Button variant="outline" disabled={!noteOk || review.isPending || stale} onClick={() => decide('REJECTED')} data-testid="button-report-rejected"><X className="mr-2 h-4 w-4" />Odrzuć (REJECTED)</Button>
            </div>
            <p className="text-xs text-muted-foreground">DONE oznacza zatwierdzenie poprawki danych, a nie potwierdzenie sprawności urządzenia.</p>
          </div>
        )}
        {closed && <p className="text-sm text-muted-foreground">Decyzja zapisana{r.reviewNote ? `: „${r.reviewNote}”` : ''}. Rozmowa pozostaje otwarta.</p>}
      </div>
      <SubmissionThread kind="ERROR" id={r.id} />
    </div>
  );
}
