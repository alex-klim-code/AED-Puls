import { useState } from 'react';
import { Link } from 'wouter';
import { GitMerge, X } from 'lucide-react';
import { useResolveDataConflict, useResolveDuplicate, type Aed, type DuplicateReview, type FieldConflict } from '@workspace/api-client-react';
import { WorkspaceLayout } from '@/components/layout';
import { EmptyState, ErrorState, ListSkeleton, VerificationBadge } from '@/components/aed-bits';
import { JsonBlock, Pager, Panel, ReadOnlyNotice, StatusPill, errMsg, useIntegrationPanel, useInvalidateIntegrations } from '@/components/admin-integrations';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

function fmt(v: unknown) {
  if (v === null || v === undefined || v === '') return 'brak';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function AedColumn({ aed, keep, onKeep, disabled }: { aed: Aed; keep: boolean; onKeep: () => void; disabled: boolean }) {
  const sources = aed.provenance?.map((p) => `${p.sourceName} (${p.license})`).join(', ') || `${aed.sourceName} (${aed.license})`;
  return (
    <div className={cn('rounded-xl border p-4', keep && 'border-primary ring-1 ring-primary')} data-testid={`card-dup-aed-${aed.id}`}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/aed/${aed.id}`} className="font-semibold hover:underline">{aed.name}</Link>
        <VerificationBadge status={aed.verificationStatus} />
      </div>
      <p className="text-sm text-muted-foreground">{aed.address}, {aed.city}</p>
      <p className="mt-1 font-data text-xs">{aed.latitude==null||aed.longitude==null?'Brak lokalizacji':`${aed.latitude.toFixed(5)}, ${aed.longitude.toFixed(5)}`}</p>
      <p className="mt-2 text-xs"><span className="text-muted-foreground">Źródła i licencje:</span> {sources}</p>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="radio" checked={keep} onChange={onKeep} disabled={disabled} data-testid={`radio-keep-${aed.id}`} /> Zachowaj jako rekord główny
      </label>
    </div>
  );
}

function DuplicateCard({ d, readOnly, onAsk }: { d: DuplicateReview; readOnly: boolean; onAsk: (d: DuplicateReview, action: 'merge' | 'reject', keepId: string) => void }) {
  const [keepId, setKeepId] = useState(d.first.id);
  const open = d.status === 'open' || d.status === 'pending';
  return (
    <article className="rounded-2xl border bg-card p-5" data-testid={`card-duplicate-${d.id}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2"><StatusPill status={d.status} /><strong>{d.score??0}/100</strong><p className="text-sm">{d.reason}</p></div>
      {d.blockingConflict&&<p role="alert" className="mb-3 rounded-lg bg-muted p-3 text-sm font-semibold text-primary">Silny konflikt blokuje automatyczne scalenie. Ten sam budynek i bliskie współrzędne nie dowodzą, że to jedno urządzenie. Decyzję podejmij dopiero po sprawdzeniu dowodów.</p>}
      <details className="mb-3 text-sm"><summary className="cursor-pointer">Dowody i punktacja porównania</summary><JsonBlock value={d.evidence}/></details>
      <div className="grid gap-3 md:grid-cols-2">
        <AedColumn aed={d.first} keep={keepId === d.first.id} onKeep={() => setKeepId(d.first.id)} disabled={readOnly || !open} />
        <AedColumn aed={d.second} keep={keepId === d.second.id} onKeep={() => setKeepId(d.second.id)} disabled={readOnly || !open} />
      </div>
      {d.originals.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">Oryginalne rekordy źródłowe ({d.originals.length})</summary>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {d.originals.map((o) => (
              <div key={o.id}><p className="mb-1 font-data text-xs">{o.sourceRecordId} · {o.license} · {o.publisher ?? 'wydawca nieznany'}</p><JsonBlock value={o.originalRecord} /></div>
            ))}
          </div>
        </details>
      )}
      {open && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" disabled={readOnly} onClick={() => onAsk(d, 'merge', keepId)} data-testid={`button-merge-${d.id}`}><GitMerge className="mr-1 h-4 w-4" /> To samo urządzenie</Button>
          <Button size="sm" variant="outline" disabled={readOnly} onClick={() => onAsk(d, 'reject', keepId)} data-testid={`button-reject-dup-${d.id}`}><X className="mr-1 h-4 w-4" /> Różne urządzenia</Button>
        </div>
      )}
    </article>
  );
}

function ConflictRow({ c, readOnly, busy, onChoose }: { c: FieldConflict; readOnly: boolean; busy: boolean; onChoose: (c: FieldConflict, choice: 'current' | 'incoming') => void }) {
  const open = c.status === 'open' || c.status === 'pending';
  return (
    <li className="rounded-xl border p-4" data-testid={`row-conflict-${c.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-data font-semibold">{c.field}</span><StatusPill status={c.status} /><Link href={`/aed/${c.aedId}`} className="text-xs text-primary underline">rekord</Link></div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-muted p-3"><p className="text-xs uppercase tracking-wider text-muted-foreground">Obecna wartość</p><p className="mt-1 break-words font-data text-sm">{fmt(c.currentValue)}</p>
          {open && <Button size="sm" variant="outline" className="mt-2" disabled={readOnly || busy} onClick={() => onChoose(c, 'current')} data-testid={`button-keep-current-${c.id}`}>Zachowaj obecną</Button>}</div>
        <div className="rounded-lg bg-muted p-3"><p className="text-xs uppercase tracking-wider text-muted-foreground">Wartość przychodząca</p><p className="mt-1 break-words font-data text-sm">{fmt(c.incomingValue)}</p>
          {open && <Button size="sm" variant="outline" className="mt-2" disabled={readOnly || busy||c.field.startsWith('source:')} onClick={() => onChoose(c, 'incoming')} data-testid={`button-take-incoming-${c.id}`}>Przyjmij przychodzącą</Button>}</div>
      </div>
    </li>
  );
}

export default function AdminDuplicatesPage() {
  const [page, setPage] = useState(1);
  const panel = useIntegrationPanel({ page });
  const resolveDup = useResolveDuplicate();
  const [undoCandidate,setUndoCandidate]=useState<string|null>(null);
  const resolveConflict = useResolveDataConflict();
  const invalidate = useInvalidateIntegrations();
  const { toast } = useToast();
  const [ask, setAsk] = useState<{ d: DuplicateReview; action: 'merge' | 'reject'; keepId: string } | null>(null);
  const data = panel.data;

  const confirm = () => {
    if (!ask) return;
    const { d, action, keepId } = ask;
    resolveDup.mutate({ data: { candidateId: d.id, action, ...(action === 'merge' ? { keepId } : {}) } }, {
      onSuccess: () => { toast({ title: action === 'merge' ? 'Połączono jako to samo urządzenie' : 'Oznaczono jako różne urządzenia' }); invalidate(); setAsk(null); },
      onError: (e) => { toast({ title: 'Serwer odrzucił decyzję', description: errMsg(e), variant: 'destructive' }); setAsk(null); },
    });
  };
  const choose = (c: FieldConflict, choice: 'current' | 'incoming') =>
    resolveConflict.mutate({ data: { conflictId: c.id, choice } }, {
      onSuccess: () => { toast({ title: 'Konflikt rozstrzygnięty', description: `${c.field}: ${choice === 'current' ? 'zachowano obecną' : 'przyjęto przychodzącą'}` }); invalidate(); },
      onError: (e) => toast({ title: 'Nie udało się rozstrzygnąć konfliktu', description: errMsg(e), variant: 'destructive' }),
    });
  const keeper = ask && (ask.keepId === ask.d.first.id ? ask.d.first : ask.d.second);

  return (
    <WorkspaceLayout roles={['ADMIN']} title="Duplikaty i konflikty" kicker="Administrator · przegląd ręczny" actions={<Button asChild variant="outline"><Link href="/admin/sources" data-testid="link-sources">Źródła danych</Link></Button>}>
      {panel.isLoading ? <ListSkeleton /> : panel.error || !data ? <ErrorState error={panel.error} onRetry={() => panel.refetch()} /> : (
        <div className="space-y-8">
          {data.demoReadOnly && <ReadOnlyNotice />}
          <p className="rounded-2xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
            Połączenie oznacza wyłącznie, że dwa rekordy opisują to samo fizyczne urządzenie. Nie zmienia licencji: pola z różnych licencji nie są mieszane, a wszystkie oryginalne rekordy i powiązania zostają zachowane. Drugi rekord jest ukrywany, nigdy usuwany.
          </p>
          <Panel title={`Kandydaci na duplikaty (${data.duplicateTotal})`}>
            {!data.duplicates.length ? <EmptyState title="Brak kandydatów na duplikaty">Nowe pary pojawią się po kolejnych importach.</EmptyState> : (
              <div className="space-y-4">{data.duplicates.map((d) => <DuplicateCard key={d.id} d={d} readOnly={data.demoReadOnly} onAsk={(dd, action, keepId) => setAsk({ d: dd, action, keepId })} />)}</div>
            )}
            <Pager page={data.page} pageSize={data.pageSize} total={data.duplicateTotal} onPage={setPage} label="Duplikaty" />
          </Panel>
          <Panel title={`Konflikty pól (${data.conflictTotal})`}>
            {!data.conflicts.length ? <EmptyState title="Brak konfliktów">Wartości przychodzące zgadzają się z obecnymi.</EmptyState> : (
              <ul className="space-y-3">{data.conflicts.map((c) => <ConflictRow key={c.id} c={c} readOnly={data.demoReadOnly} busy={resolveConflict.isPending} onChoose={choose} />)}</ul>
            )}
            <Pager page={data.page} pageSize={data.pageSize} total={data.conflictTotal} onPage={setPage} label="Konflikty" />
          </Panel>
          <Panel title="Historia scaleń i rozdzielanie urządzeń">
            {!data.mergeHistory?.length&&<p className="text-sm text-muted-foreground">Brak nowych scaleń. Każde kolejne scalenie zapisze odwracalne powiązania; oryginalne rekordy nie są kasowane.</p>}
            <ul className="space-y-3">{data.mergeHistory?.map(h=><li key={h.id} className="rounded-xl border p-4 text-sm">
              <p>{h.mode==='automatic'?'Automatyczne':'Ręczne'} · {new Date(h.createdAt).toLocaleString('pl-PL')}</p>
              <p className="break-all">Centralne AED: {h.keeperId} · dołączony rekord: {h.loserId}</p>
              {h.undoneAt?<p>Scalenie cofnięte: {new Date(h.undoneAt).toLocaleString('pl-PL')}</p>:<Button className="mt-2" variant="outline" disabled={resolveDup.isPending} onClick={()=>setUndoCandidate(h.candidateId)}>Cofnij scalenie</Button>}
            </li>)}</ul>
          </Panel>
          <Panel title="Historia decyzji administratorów">
            <ul className="space-y-2 text-sm">{data.decisionHistory?.map(d=><li key={d.id}>{new Date(d.createdAt).toLocaleString('pl-PL')} · {d.action}</li>)}</ul>
            <div className="mt-3 flex gap-2"><Button variant="outline" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Poprzednia strona historii</Button><Button variant="outline" disabled={(data.mergeHistory?.length??0)<20&&(data.decisionHistory?.length??0)<20} onClick={()=>setPage(p=>p+1)}>Dalsza historia</Button></div>
          </Panel>
        </div>
      )}
      <AlertDialog open={!!undoCandidate} onOpenChange={o=>!o&&setUndoCandidate(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Rozdzielić wcześniej scalone urządzenia?</AlertDialogTitle><AlertDialogDescription>Przywrócimy poprzednie powiązania i osobne punkty. Nie usuniemy oryginałów ani nowszych ocen urządzeń. Jeśli wykonano późniejsze scalenia tej grupy, trzeba je najpierw cofnąć.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Anuluj</AlertDialogCancel><AlertDialogAction disabled={resolveDup.isPending} onClick={e=>{e.preventDefault();if(undoCandidate)resolveDup.mutate({data:{candidateId:undoCandidate,action:'undo'}},{onSuccess:()=>{invalidate();setUndoCandidate(null);toast({title:'Przywrócono osobne urządzenia'});},onError:err=>toast({title:'Nie można cofnąć scalenia',description:errMsg(err),variant:'destructive'})});}}>Rozdziel urządzenia</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ask?.action === 'merge' ? 'Potwierdzić to samo urządzenie?' : 'Oznaczyć jako różne urządzenia?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {ask?.action === 'merge'
                ? `Rekord główny: ${keeper?.name}. Drugi rekord zostanie ukryty, a jego oryginalne dane i odwołania zachowane. Licencje nie są łączone ani zmieniane.`
                : 'Para zostanie oznaczona jako fałszywy alarm. Oba rekordy pozostaną bez zmian.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirm(); }} disabled={resolveDup.isPending} data-testid="button-confirm-duplicate">{resolveDup.isPending ? 'Zapisywanie…' : 'Potwierdź'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspaceLayout>
  );
}
