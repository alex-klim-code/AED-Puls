import { useState } from 'react';
import { Link } from 'wouter';
import { Building2, Lock, Pencil } from 'lucide-react';
import type { McodEntity, McodWorkspace } from '@workspace/api-client-react';
import { SiteLayout, WorkspaceLayout } from '@/components/layout';
import { EmptyState } from '@/components/aed-bits';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/use-auth';
import { EventsList, IntegrationBanner, Section, StatusPill, WsBody, str } from '@/components/mcod/mcod-shared';
import { GovernmentOrganizationForm } from '@/components/government-organizations';
import { DraftEditor, DraftRow, emptyDraft, fromAed, fromPayload, type DraftForm } from '@/components/mcod/mcod-drafts';
import { DatasetBlock } from '@/components/mcod/mcod-publication';
import { AdminView } from '@/components/mcod/mcod-admin';

export function RegisterOrganizationPage() {
  const { user, isLoading } = useSession();
  if (!isLoading && !user) return (
    <SiteLayout>
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="rounded-2xl border bg-card p-8">
          <Lock className="h-8 w-8 text-primary" aria-hidden />
          <h1 className="mt-4 font-display text-3xl font-bold">Rejestracja organizacji wymaga logowania</h1>
          <p className="mt-2 text-muted-foreground">Zaloguj się, a następnie złóż wniosek. Administrator zweryfikuje, że reprezentujesz organizację, zanim uzyskasz dostęp do panelu danych.</p>
          <Button asChild className="mt-6" data-testid="link-login-required"><Link href="/login">Przejdź do logowania</Link></Button>
        </div>
      </div>
    </SiteLayout>
  );
  return (
    <WorkspaceLayout roles={['USER', 'PROVIDER']} title="Rejestracja organizacji" kicker="Wniosek przedstawiciela">
      <GovernmentOrganizationForm />
    </WorkspaceLayout>
  );
}

function RecordState({ ws, id }: { ws: McodWorkspace; id: string }) {
  const st = (ws as McodWorkspace & { recordStates?: McodEntity[] }).recordStates?.find((r) => r.id === id)?.status;
  return st ? <StatusPill status={st} /> : <span className="text-xs text-muted-foreground" data-testid={`status-record-unknown-${id}`}>status publikacji nieznany</span>;
}

function McodOrgView({ ws }: { ws: McodWorkspace }) {
  const [editor, setEditor] = useState<{ initial: DraftForm; draft?: McodEntity; target?: string } | null>(null);
  return (
    <>
      <IntegrationBanner ws={ws} />
      <Section title="Organizacja" aside={<Button asChild size="sm" variant="outline"><Link href="/register-organization" data-testid="link-register-org">Nowy wniosek</Link></Button>}>
        {ws.organization && <p className="mb-3 flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-primary" aria-hidden />{ws.organization.name}</p>}
        {!ws.institutionRequests.length ? <p className="text-sm text-muted-foreground">Brak wniosków. Złóż wniosek, aby powiązać konto z organizacją.</p> : (
          <ul className="divide-y">{ws.institutionRequests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid={`row-request-${r.id}`}>
              <span><strong>{str(r, 'organizationName') || str(r, 'institutionId')}</strong> <span className="text-muted-foreground">· {str(r, 'kind')}</span></span><StatusPill status={r.status} />
            </li>
          ))}</ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">APPROVED oznacza zatwierdzenie przedstawiciela w AED Puls, a nie utworzenie instytucji w MCOD.</p>
      </Section>

      <Section title="Szkice AED" aside={!editor && <Button size="sm" onClick={() => setEditor({ initial: emptyDraft })} data-testid="button-new-draft">Nowy szkic</Button>}>
        <div className="mb-4 flex flex-wrap gap-1.5 text-xs">{['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PUBLISHED'].map((s, i) => <span key={s} className="flex items-center gap-1.5">{i > 0 && <span aria-hidden className="text-muted-foreground">/</span>}<StatusPill status={s} /></span>)}</div>
        {editor && <div className="mb-4"><DraftEditor key={editor.draft?.id ?? editor.target ?? 'new'} initial={editor.initial} draft={editor.draft} targetAedId={editor.target} onDone={() => setEditor(null)} /></div>}
        {ws.drafts.length ? <ul className="divide-y">{ws.drafts.map((d) => <DraftRow key={d.id} d={d} onEdit={() => setEditor({ initial: fromPayload(d.payload as Record<string, unknown>), draft: d })} />)}</ul> : !editor && <EmptyState title="Brak szkiców">Szkic zapisuje się lokalnie. Po wysłaniu trafia do moderacji administratora.</EmptyState>}
        <p className="mt-4 text-xs text-muted-foreground">Zatwierdzenie redakcyjne i publikacja nie są fizyczną weryfikacją urządzenia.</p>
      </Section>

      <Section title="Rekordy organizacji" aside={<div className="flex gap-2"><Button asChild size="sm" variant="outline"><Link href="/submit-aed">Dodaj AED</Link></Button><Button asChild size="sm" variant="outline"><Link href="/my-submissions">Zgłoszenia</Link></Button></div>}>
        {!ws.records.length ? <p className="text-sm text-muted-foreground">Organizacja nie ma jeszcze zatwierdzonych rekordów.</p> : (
          <ul className="divide-y">{ws.records.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm" data-testid={`row-record-${a.id}`}>
              <span className="min-w-0"><Link href={`/aed/${a.id}`} className="font-semibold hover:underline">{a.name}</Link> <span className="text-muted-foreground">· {a.city}</span> <RecordState ws={ws} id={a.id} /></span>
              <Button size="sm" variant="ghost" onClick={() => setEditor({ initial: fromAed(a), target: a.id })} data-testid={`button-edit-record-${a.id}`}><Pencil className="mr-1 h-3.5 w-3.5" />Zaproponuj zmianę</Button>
            </li>
          ))}</ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Zatwierdzony rekord to zaakceptowane dane, nie potwierdzenie sprawności ani dostępności urządzenia w terenie.</p>
      </Section>

      <DatasetBlock ws={ws} />
      <EventsList ws={ws} />
    </>
  );
}

export function McodPage() {
  return (
    <WorkspaceLayout roles={['PROVIDER', 'USER']} title="Publikacja danych" kicker="Organizacja · dane.gov.pl">
      <WsBody>{(ws) => <McodOrgView ws={ws} />}</WsBody>
    </WorkspaceLayout>
  );
}

export function AdminMcodPage() {
  return (
    <WorkspaceLayout roles={['ADMIN']} title="Integracja MCOD" kicker="Administrator · dane.gov.pl">
      <WsBody>{(ws) => <AdminView ws={ws} />}</WsBody>
    </WorkspaceLayout>
  );
}
