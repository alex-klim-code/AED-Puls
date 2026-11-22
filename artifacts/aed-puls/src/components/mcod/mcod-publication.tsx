import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { useExecuteMcodPublication, usePrepareMcodDataset, usePrepareMcodPublication, type McodEntity, type McodWorkspace } from '@workspace/api-client-react';
import { formatDateTime } from '@/components/aed-bits';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { BlockedNote, Field, Section, StatusPill, inputCls, remoteBlock, str, useErr, useInvalidate } from './mcod-shared';

type Validation = { issues?: { id: string; reason: string }[]; exported?: number; omitted?: number };

export function PlanCard({ plan, ws }: { plan: McodEntity; ws: McodWorkspace }) {
  const exec = useExecuteMcodPublication();
  const inv = useInvalidate();
  const err = useErr();
  const { toast } = useToast();
  const [preview, setPreview] = useState<string | null>(null);
  const v = (plan.validation ?? {}) as Validation;
  const issues = Array.isArray(v.issues) ? v.issues : [];
  const failed = plan.status === 'VALIDATION_FAILED';
  const block = remoteBlock(ws, ws.status.writesEnabled);
  const url = `/api/mcod/publications/${plan.id}/download`;
  const license = str(plan, 'license');
  const loadPreview = async () => {
    try { const r = await fetch(url, { credentials: 'include' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); setPreview((await r.text()).slice(0, 3000)); }
    catch (e) { err('Podgląd niedostępny')(e); }
  };
  return (
    <li className="rounded-xl border bg-card p-4" data-testid={`card-plan-${plan.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><StatusPill status={plan.status} /><span className="font-data text-xs uppercase">{str(plan, 'format')}</span></div>
        <span className="text-xs text-muted-foreground">{formatDateTime(str(plan, 'createdAt'))}</span>
      </div>
      <p className="mt-2 text-sm"><strong className="font-data">{str(plan, 'recordCount') || 0}</strong> rekordów · wyeksportowane {v.exported ?? 0} · pominięte {v.omitted ?? 0}</p>
      {issues.length > 0 && (
        <details className="mt-2 text-xs" open={failed}>
          <summary className="cursor-pointer font-semibold text-primary">Problemy w rekordach ({issues.length})</summary>
          <ul className="mt-1 space-y-1">{issues.map((i, n) => <li key={`${i.id}-${n}`}><span className="font-data">{String(i.id).slice(0, 8)}</span>: {i.reason}</li>)}</ul>
        </details>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Obowiązki licencyjne: {license ? `${license}. ` : ''}Przy ponownym wykorzystaniu podaj źródło (AED Puls oraz organizację). Rekordy bez znanej licencji i zgody na publikację są pomijane.</p>
      {str(plan, 'lastError') && <p className="mt-2 text-xs text-primary">Błąd: {str(plan, 'lastError')}</p>}
      {plan.status === 'PUBLISHED' && <p className="mt-2 text-xs text-verified">Opublikowano {formatDateTime(str(plan, 'publishedAt'))}</p>}
      {failed ? (
        <p role="alert" className="mt-3 text-xs text-primary">Plan nie przeszedł walidacji. Pobieranie i publikacja są zablokowane. Popraw rekordy i przygotuj nowy plan.</p>
      ) : (
        <div className="mt-3 space-y-1">
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline"><a href={url} download data-testid={`link-download-plan-${plan.id}`}><Download className="mr-1 h-3.5 w-3.5" />Pobierz plik</a></Button>
            <Button size="sm" variant="ghost" onClick={loadPreview} data-testid={`button-preview-plan-${plan.id}`}><FileText className="mr-1 h-3.5 w-3.5" />Podgląd</Button>
            {plan.status === 'PREPARED' && (
              <Button size="sm" disabled={!!block || exec.isPending} onClick={() => exec.mutate({ id: plan.id }, {
                onSuccess: (r) => { inv(); if (r.status === 'PUBLISHED') toast({ title: 'Opublikowano w MCOD' }); else toast({ title: 'Publikacja nie została potwierdzona', description: `Status: ${r.status ?? 'nieznany'}`, variant: 'destructive' }); },
                onError: err('Publikacja zablokowana'),
              })} data-testid={`button-publish-plan-${plan.id}`}>Opublikuj w MCOD</Button>
            )}
          </div>
          {plan.status === 'PREPARED' && <BlockedNote reason={block} />}
        </div>
      )}
      {preview != null && <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-muted p-3 font-data text-[11px]">{preview}</pre>}
    </li>
  );
}

export function DatasetBlock({ ws }: { ws: McodWorkspace }) {
  const eligible = ws.institutionRequests.filter((r) => r.status === 'APPROVED' || r.status === 'REGISTERED');
  const [reqId, setReqId] = useState(eligible[0]?.id ?? '');
  const [title, setTitle] = useState('Defibrylatory AED');
  const [desc, setDesc] = useState('');
  const [format, setFormat] = useState<'csv' | 'geojson'>('csv');
  const ds = usePrepareMcodDataset();
  const pub = usePrepareMcodPublication();
  const inv = useInvalidate();
  const err = useErr();
  const { toast } = useToast();
  const chosen = reqId || eligible[0]?.id || '';
  return (
    <Section title="Zbiór danych i publikacja">
      {!eligible.length ? <p className="text-sm text-muted-foreground">Projekt zbioru można utworzyć po zatwierdzeniu wniosku organizacji przez administratora.</p> : (
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); ds.mutate({ data: { institutionRequestId: chosen, title, description: desc } }, { onSuccess: () => { inv(); toast({ title: 'Utworzono lokalny projekt zbioru' }); }, onError: err('Nie utworzono projektu') }); }}>
          <Field label="Wniosek"><select className={inputCls} value={chosen} onChange={(e) => setReqId(e.target.value)} data-testid="select-dataset-request">{eligible.map((r) => <option key={r.id} value={r.id}>{str(r, 'organizationName') || r.id} ({r.status})</option>)}</select></Field>
          <Field label="Tytuł"><input required minLength={2} className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-dataset-title" /></Field>
          <Button type="submit" disabled={ds.isPending || !chosen} data-testid="button-prepare-dataset">Utwórz projekt</Button>
          <div className="sm:col-span-3"><Field label="Opis"><textarea className={inputCls} rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} data-testid="input-dataset-description" /></Field></div>
        </form>
      )}
      {ws.datasets.length > 0 && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm"><span>Format pliku:</span>
            {(['csv', 'geojson'] as const).map((x) => <Button key={x} size="sm" type="button" variant={format === x ? 'default' : 'outline'} aria-pressed={format === x} onClick={() => setFormat(x)} data-testid={`button-format-${x}`}>{x.toUpperCase()}</Button>)}
          </div>
          {ws.datasets.map((d) => {
            const plans = ws.plans.filter((p) => str(p, 'datasetId') === d.id);
            return (
              <div key={d.id} className="rounded-xl bg-muted/50 p-4" data-testid={`card-dataset-${d.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="font-semibold">{d.title || str(d, 'name') || d.id}</p><p className="text-xs text-muted-foreground">Lokalny projekt · {d.status}{str(d, 'remoteId') ? ` · MCOD ${str(d, 'remoteId')}` : ' · nie istnieje jeszcze w MCOD'}</p></div>
                  <Button size="sm" disabled={pub.isPending} onClick={() => pub.mutate({ data: { datasetId: d.id, format } }, { onSuccess: (r) => { inv(); toast({ title: r.status === 'PREPARED' ? 'Plan przygotowany' : 'Walidacja nieudana', description: `${str(r, 'recordCount') || 0} rekordów`, variant: r.status === 'PREPARED' ? undefined : 'destructive' }); }, onError: err('Nie przygotowano planu') })} data-testid={`button-prepare-publication-${d.id}`}>Przygotuj plan publikacji</Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Plan obejmuje wszystkie zatwierdzone, własne i nieimportowane AED organizacji.</p>
                {plans.length > 0 && <ul className="mt-3 space-y-3">{plans.map((p) => <PlanCard key={p.id} plan={p} ws={ws} />)}</ul>}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
