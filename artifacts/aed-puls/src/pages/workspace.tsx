import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Check, PlusCircle, X, Flag, FileSpreadsheet, Inbox, MessageSquareWarning } from 'lucide-react';
import {
  getGetStatsQueryKey, getGetWorkspaceQueryKey, getListAedsQueryKey,
  useGetStats, useGetWorkspace, useListAedProposals, useListAeds, useListConflictReports, useReviewAed, type Aed,
} from '@workspace/api-client-react';
import { WorkspaceLayout } from '@/components/layout';
import { AdminRecordsBrowser } from '@/components/admin-records/admin-records-browser';
import { KpiCard, RecordsTable } from '@/components/records-table';
import { EmptyState, ErrorState, ListSkeleton, formatDate } from '@/components/aed-bits';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useSession } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { MySubmissionsView } from '@/components/proposals/my-submissions';
import { AdminProposalQueue } from '@/components/proposals/admin-proposal-review';
import { AdminReportQueue } from '@/components/proposals/admin-report-review';
import { MyGovernmentOrganizations } from '@/components/government-organizations';
import { GovernmentClaimsAdmin } from '@/components/government-claims-admin';
import { Tabs } from '@/components/proposals/proposal-bits';

const ALL = ['USER', 'PROVIDER', 'ADMIN'];

function useWs() {
  const { user } = useSession();
  return useGetWorkspace({ query: { enabled: !!user, queryKey: getGetWorkspaceQueryKey() } });
}

function AddButton() {
  return <Button asChild data-testid="link-submit-aed"><Link href="/submit-aed"><PlusCircle className="mr-2 h-4 w-4" /> Dodaj AED</Link></Button>;
}
function UserActions(){
  const {user}=useSession();
  return <div className="flex flex-wrap gap-2"><AddButton/>{(user?.role==='USER'||user?.role==='PROVIDER')&&<Button asChild variant="outline" data-testid="link-report-error"><Link href="/report"><Flag className="mr-2 h-4 w-4"/>Zgłoś błąd</Link></Button>}</div>;
}

function ProposalCounts() {
  const pending = useListAedProposals({ status: 'NEW' });
  const info = useListAedProposals({ status: 'UNCOMPLETED' });
  const rejected = useListAedProposals({ status: 'REJECTED' });
  const v = (q: typeof pending) => (q.isLoading ? '…' : q.data?.total ?? '—');
  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold">Zgłoszenia w weryfikacji</h2>
        <Button asChild variant="outline" size="sm"><Link href="/my-submissions" data-testid="link-dashboard-submissions">Zobacz zgłoszenia</Link></Button>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Czekają na administratora" value={v(pending)} />
        <KpiCard label="Do uzupełnienia" value={v(info)} tone="red" />
        <KpiCard label="Odrzucone" value={v(rejected)} />
      </div>
    </section>
  );
}

function RecordsBlock({ records, empty }: { records: Aed[] | undefined; empty: string }) {
  if (!records?.length) return <EmptyState title={empty} action={<AddButton />}>Zgłoszone rekordy pojawią się tutaj wraz ze statusem weryfikacji.</EmptyState>;
  return <RecordsTable records={records} />;
}

function Body({ children }: { children: (ws: NonNullable<ReturnType<typeof useWs>['data']>) => ReactNode }) {
  const ws = useWs();
  if (ws.isLoading) return <ListSkeleton />;
  if (ws.error || !ws.data) return <ErrorState error={ws.error} onRetry={() => ws.refetch()} />;
  return <>{children(ws.data)}</>;
}

function AdminDashboard() {
  const p = { NEW: useListAedProposals({ status: 'NEW' }), UNCOMPLETED: useListAedProposals({ status: 'UNCOMPLETED' }), DONE: useListAedProposals({ status: 'DONE' }), REJECTED: useListAedProposals({ status: 'REJECTED' }) };
  const r = { NEW: useListConflictReports({ status: 'NEW' }), UNCOMPLETED: useListConflictReports({ status: 'UNCOMPLETED' }), DONE: useListConflictReports({ status: 'DONE' }), REJECTED: useListConflictReports({ status: 'REJECTED' }) };
  const v = (q: { isLoading: boolean; error: unknown; data?: { total: number } }) => (q.isLoading ? '…' : q.error ? '—' : q.data?.total ?? 0);
  const failed = [...Object.values(p), ...Object.values(r)].find((q) => q.error);
  const block = (title: string, href: string, icon: typeof Inbox, qs: typeof p | typeof r, kind: 'AED' | 'ERROR') => {
    const Icon = icon;
    return (
      <section className="rounded-2xl border bg-card p-5" data-testid={`section-admin-${kind.toLowerCase()}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-xl font-bold"><Icon className="h-5 w-5 text-primary" aria-hidden />{title}</h2>
          <Button asChild size="sm"><Link href={href} data-testid={`link-admin-queue-${kind.toLowerCase()}`}>Otwórz kolejkę ({v(qs.NEW)} nowych)</Link></Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Nowe · NEW" value={v(qs.NEW)} tone="red" />
          <KpiCard label={kind === 'AED' ? 'Do uzupełnienia · UNCOMPLETED' : 'Starsze · UNCOMPLETED'} value={v(qs.UNCOMPLETED)} />
          <KpiCard label={kind === 'AED' ? 'Zatwierdzone · DONE' : 'Poprawione · DONE'} value={v(qs.DONE)} tone="green" />
          <KpiCard label="Odrzucone · REJECTED" value={v(qs.REJECTED)} />
        </div>
      </section>
    );
  };
  return (
    <div className="space-y-6">
      {failed && <ErrorState error={failed.error} onRetry={() => [...Object.values(p), ...Object.values(r)].forEach((q) => q.refetch())} title="Nie udało się pobrać części liczników" />}
      {block('Zgłoszenia AED', '/admin/submissions', Inbox, p, 'AED')}
      {block('Zgłoszenia błędów', '/admin/reports', MessageSquareWarning, r, 'ERROR')}
      <GovernmentClaimsAdmin />
      <p className="text-sm text-muted-foreground">Administrator weryfikuje i moderuje zgłoszenia. DONE zatwierdza dane, nie potwierdza sprawności urządzenia.</p>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useSession();
  if (user?.role === 'ADMIN') return <WorkspaceLayout roles={ALL} title="Pulpit" kicker="Moderacja zgłoszeń"><AdminDashboard /></WorkspaceLayout>;
  return (
    <WorkspaceLayout roles={ALL} title="Pulpit" actions={<UserActions />}>
      <Body>
        {(ws) => {
          const r = ws.ownRecords;
          return (
            <div className="space-y-10">
              <MyGovernmentOrganizations />
              <ProposalCounts />
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="Opublikowane rekordy" value={r.length} />
                <KpiCard label="Zweryfikowane" value={r.filter((a) => ['verified','VERIFIED'].includes(a.verificationStatus)).length} tone="green" />
                <KpiCard label="Oczekujące" value={r.filter((a) => ['pending','unverified','NOT_VERIFIED'].includes(a.verificationStatus)).length} tone="red" />
                <KpiCard label="Śr. kompletność" value={r.length ? `${Math.round(r.reduce((s, a) => s + a.qualityScore, 0) / r.length)}` : '—'} hint="Jakość danych, nie sprawność AED" />
              </div>
              <div className="grid gap-8 xl:grid-cols-[1.6fr_1fr]">
                <section>
                  <h2 className="mb-4 font-display text-xl font-bold">Ostatnie rekordy</h2>
                  <RecordsBlock records={r.slice(0, 5)} empty="Nie masz jeszcze rekordów" />
                </section>
                <section>
                  <h2 className="mb-4 font-display text-xl font-bold">Aktywność</h2>
                  {ws.activity.length ? (
                    <ol className="space-y-3 border-l-2 pl-5">
                      {ws.activity.slice(0, 10).map((a) => (
                        <li key={a.id} className="text-sm"><p className="font-medium">{a.action}</p><p className="text-xs text-muted-foreground">{formatDate(a.createdAt)}</p></li>
                      ))}
                    </ol>
                  ) : <p className="text-sm text-muted-foreground">Brak zarejestrowanej aktywności.</p>}
                </section>
              </div>
            </div>
          );
        }}
      </Body>
    </WorkspaceLayout>
  );
}

export function MySubmissionsPage() {
  const { user } = useSession();
  return (
    <WorkspaceLayout roles={['USER', 'PROVIDER']} title={user?.role === 'USER' ? 'Moje zgłoszenia' : 'Zgłoszenia'} kicker="Kolejka weryfikacji" actions={<UserActions />}>
      <MySubmissionsView />
    </WorkspaceLayout>
  );
}

export function ProviderPage() {
  const { user } = useSession();
  return (
    <WorkspaceLayout roles={['PROVIDER']} title="Panel organizacji" kicker="Dostawca danych" actions={<UserActions />}>
      <Body>
        {(ws) => {
          const org = ws.records.filter((a) => !user?.organizationId || a.organizationId === user.organizationId);
          return (
            <div className="space-y-8">
              <div className="grid gap-4 sm:grid-cols-3">
                <KpiCard label="Rekordy organizacji" value={org.length} />
                <KpiCard label="Zweryfikowane" value={org.filter((a) => ['verified','VERIFIED'].includes(a.verificationStatus)).length} tone="green" />
                <KpiCard label="Z brakami danych" value={org.filter((a) => a.qualityIssues.length > 0).length} tone="red" />
              </div>
              <div className="flex flex-col gap-4 rounded-2xl border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <p className="font-semibold">Dodawaj ręcznie, przez GPS lub importuj plik XLSX/CSV.</p>
                  <p className="mt-1 text-muted-foreground">Każdy rekord trafia najpierw do weryfikacji administratora. Szablon pliku pobierzesz w zakładce importu.</p>
                </div>
                <Button asChild variant="outline"><Link href="/submit-aed" data-testid="link-provider-import"><FileSpreadsheet className="mr-2 h-4 w-4" />Importuj z pliku</Link></Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline"><Link href="/provider/aeds">Rekordy organizacji</Link></Button>
                <Button asChild variant="outline"><Link href="/my-submissions">Zgłoszenia</Link></Button>
                <Button asChild><Link href="/mcod" data-testid="link-provider-mcod">Publikacja w dane.gov.pl (MCOD)</Link></Button>
              </div>
            </div>
          );
        }}
      </Body>
    </WorkspaceLayout>
  );
}

export function ProviderAedsPage() {
  const { user } = useSession();
  return (
    <WorkspaceLayout roles={['PROVIDER']} title="Rekordy organizacji" kicker="Dostawca danych" actions={<UserActions />}>
      <Body>{(ws) => <RecordsBlock records={ws.records.filter((a) => !user?.organizationId || a.organizationId === user.organizationId)} empty="Organizacja nie ma rekordów" />}</Body>
    </WorkspaceLayout>
  );
}

export function AdminPage() {
  const { user } = useSession();
  const p = { demo: false };
  const stats = useGetStats(p, { query: { enabled: !!user, queryKey: getGetStatsQueryKey(p) } });
  const s = stats.data;
  return (
    <WorkspaceLayout roles={['ADMIN']} title="Administracja" kicker="Administrator · rzeczywiste dane">
      {stats.isLoading ? <ListSkeleton rows={2} /> : stats.error || !s ? <ErrorState error={stats.error} onRetry={() => stats.refetch()} /> : (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard label="Wszystkie rekordy" value={s.total} />
            <KpiCard label="Zweryfikowane" value={s.verified} tone="green" />
            <KpiCard label="Do weryfikacji" value={s.pending} tone="red" />
            <KpiCard label="Miejscowości" value={s.cities} />
            <KpiCard label="Źródła" value={s.sources} />
            <KpiCard label="Śr. kompletność" value={`${Math.round(s.averageQuality)}/100`} hint="Kompletność i wiarygodność danych" />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild><Link href="/admin/submissions">Przejrzyj zgłoszenia ({s.pending})</Link></Button>
            <Button asChild variant="outline"><Link href="/admin/aeds">Wszystkie rekordy</Link></Button>
            <Button asChild variant="outline"><Link href="/admin/sources" data-testid="link-admin-sources">Źródła i importy</Link></Button>
            <Button asChild variant="outline"><Link href="/admin/duplicates" data-testid="link-admin-duplicates">Duplikaty i konflikty</Link></Button>
            <Button asChild variant="outline"><Link href="/data">Eksport</Link></Button>
          </div>
          <p className="rounded-2xl border border-dashed bg-card p-5 text-sm text-muted-foreground">Zarządzanie użytkownikami nie jest jeszcze podłączone w tej wersji.</p>
        </div>
      )}
    </WorkspaceLayout>
  );
}

export function AdminAedsPage() {
  const { user } = useSession();
  return (
    <WorkspaceLayout roles={['ADMIN']} title="Wszystkie rekordy" kicker="Administrator">
      <AdminRecordsBrowser enabled={user?.role === 'ADMIN'} />
    </WorkspaceLayout>
  );
}

export function AdminSubmissionsPage() {
  const [tab, setTab] = useState<'proposals' | 'legacy'>('proposals');
  return (
    <WorkspaceLayout roles={['ADMIN']} title="Zgłoszenia AED" kicker="Moderacja">
      <Tabs value={tab} onChange={(v) => setTab(v as typeof tab)} items={[
        { value: 'proposals', label: 'Zgłoszenia od użytkowników i organizacji' }, { value: 'legacy', label: 'Importy krajowe' },
      ]} />
      {tab === 'proposals' ? <AdminProposalQueue /> : <LegacyReview />}
    </WorkspaceLayout>
  );
}

export function AdminReportsPage() {
  return (
    <WorkspaceLayout roles={['ADMIN']} title="Zgłoszenia błędów" kicker="Moderacja">
      <AdminReportQueue />
    </WorkspaceLayout>
  );
}

function LegacyReview() {
  const { user } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [queue, setQueue] = useState('pending');
  const [page, setPage] = useState(1);
  const p = { verificationStatus: queue, demo: false, page, limit: 50 };
  const list = useListAeds(p, { query: { enabled: !!user, queryKey: getListAedsQueryKey(p) } });
  const review = useReviewAed();
  const [pending, setPending] = useState<{ aed: Aed; decision: 'verified' | 'rejected' } | null>(null);

  const confirm = () => {
    if (!pending) return;
    const { aed, decision } = pending;
    review.mutate({ id: aed.id, data: { decision } }, {
      onSuccess: () => {
        toast({ title: decision === 'verified' ? 'Rekord zatwierdzony' : 'Rekord odrzucony', description: aed.name });
        qc.invalidateQueries({ queryKey: getListAedsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
        qc.invalidateQueries({ queryKey: getGetStatsQueryKey() });
        qc.invalidateQueries({ queryKey: [`/api/aeds/${aed.id}`] });
        setPending(null);
      },
      onError: (e) => { toast({ title: 'Serwer odrzucił decyzję', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }); setPending(null); },
    });
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2">
        <Button variant={queue === 'pending' ? 'default' : 'outline'} onClick={() => { setQueue('pending'); setPage(1); }}>Rekordy oczekujące</Button>
        <Button variant={queue === 'unverified' ? 'default' : 'outline'} onClick={() => { setQueue('unverified'); setPage(1); }}>Importy do sprawdzenia</Button>
        <Button asChild variant="outline"><Link href="/admin/sources">Źródła i oryginały</Link></Button>
      </div>
      {list.isLoading ? <ListSkeleton /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data?.length ? (
        <EmptyState title="Kolejka jest pusta">Wszystkie zgłoszenia zostały rozpatrzone.</EmptyState>
      ) : (
        <RecordsTable
          records={list.data}
          actions={(a) => (
            <div className="flex gap-2 md:justify-end">
              <Button size="sm" className="bg-verified text-white hover:bg-verified/90" onClick={() => setPending({ aed: a, decision: 'verified' })} data-testid={`button-approve-${a.id}`}><Check className="mr-1 h-4 w-4" /> Zatwierdź</Button>
              <Button size="sm" variant="outline" onClick={() => setPending({ aed: a, decision: 'rejected' })} data-testid={`button-reject-${a.id}`}><X className="mr-1 h-4 w-4" /> Odrzuć</Button>
            </div>
          )}
        />
      )}
      <div className="my-4 flex items-center justify-between gap-3 text-sm">
        <Button variant="outline" disabled={page === 1 || list.isFetching} onClick={() => setPage(p => p - 1)}>Poprzednia</Button>
        <span>Strona {page} · do 50 rekordów</span>
        <Button variant="outline" disabled={(list.data?.length ?? 0) < 50 || list.isFetching} onClick={() => setPage(p => p + 1)}>Następna</Button>
      </div>
      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.decision === 'verified' ? 'Zatwierdzić rekord?' : 'Odrzucić rekord?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.aed.name}, {pending?.aed.city}. {pending?.decision === 'verified' ? 'Rekord stanie się publiczny. Eksport wymaga także znanej licencji i poprawnego adresu źródła. Nie potwierdzasz sprawności urządzenia.' : 'Rekord nie będzie widoczny publicznie.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirm(); }} disabled={review.isPending} data-testid="button-confirm-review">
              {review.isPending ? 'Zapisywanie…' : 'Potwierdź'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
