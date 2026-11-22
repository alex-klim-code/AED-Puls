import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { Pencil, Send } from 'lucide-react';
import { useSaveMcodAedDraft, useSubmitMcodAedDraft, useUpdateMcodAedDraft, type Aed, type McodEntity } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Field, MISSING_REVISION, StatusPill, inputCls, rev, useErr, useInvalidate } from './mcod-shared';

export type DraftForm = { name: string; address: string; city: string; postalCode: string; voivodeship: string; latitude: string; longitude: string; description: string; placement: string; accessibility: string; openingHours: string; sourceUrl: string; license: string; responsibleOrganization: string; notes: string; publicAccess: '' | 'true' | 'false'; deviceStatus: string; lastVerifiedAt: string };
export const emptyDraft: DraftForm = { name: '', address: '', city: '', postalCode: '', voivodeship: '', latitude: '', longitude: '', description: '', placement: 'unknown', accessibility: 'unknown', openingHours: '', sourceUrl: '', license: 'CC-BY-4.0', responsibleOrganization: '', notes: '', publicAccess: '', deviceStatus: 'UNKNOWN', lastVerifiedAt: '' };

export function fromPayload(p: Record<string, unknown> | undefined): DraftForm {
  const o = { ...emptyDraft };
  for (const k of Object.keys(o) as (keyof DraftForm)[]) {
    if (k === 'publicAccess') o.publicAccess = p?.publicAccess === true ? 'true' : p?.publicAccess === false ? 'false' : '';
    else if (k === 'lastVerifiedAt') o.lastVerifiedAt = p?.lastVerifiedAt ? String(p.lastVerifiedAt).slice(0, 10) : '';
    else if (p?.[k] != null) (o as Record<string, string>)[k] = String(p[k]);
  }
  return o;
}

function toPayload(f: DraftForm): Record<string, unknown> {
  const n = (v: string) => (v.trim() === '' ? null : Number(v));
  const { publicAccess, lastVerifiedAt, ...rest } = f;
  // Brak deklaracji = null; deklaracje źródła nie oznaczają weryfikacji urządzenia.
  return { ...rest, latitude: n(f.latitude), longitude: n(f.longitude), publicAccess: publicAccess ? publicAccess === 'true' : null, lastVerifiedAt: lastVerifiedAt || null };
}

/** Tylko pola danych rekordu; bez przenoszenia deklaracji o sprawności czy weryfikacji fizycznej. */
export function fromAed(a: Aed): DraftForm {
  return {
    ...emptyDraft, name: a.name, address: a.address, city: a.city, postalCode: a.postalCode ?? '', voivodeship: a.voivodeship ?? '',
    latitude: a.latitude == null ? '' : String(a.latitude), longitude: a.longitude == null ? '' : String(a.longitude),
    description: a.description ?? '', placement: a.placement ?? 'unknown', accessibility: a.accessibility, openingHours: a.openingHours ?? '',
    sourceUrl: a.sourceUrl, license: a.license, responsibleOrganization: a.responsibleOrganization ?? '',
  };
}

export function DraftEditor({ initial, draft, targetAedId, onDone }: { initial: DraftForm; draft?: McodEntity; targetAedId?: string; onDone: () => void }) {
  const [f, setF] = useState(initial);
  const set = (k: keyof DraftForm) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useSaveMcodAedDraft();
  const update = useUpdateMcodAedDraft();
  const inv = useInvalidate();
  const err = useErr();
  const { toast } = useToast();
  const pending = save.isPending || update.isPending;
  const revision = draft ? rev(draft) : null;
  const revisionMissing = !!draft && revision == null;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const payload = toPayload(f);
    const ok = () => { inv(); toast({ title: 'Szkic zapisany lokalnie' }); onDone(); };
    if (draft) { if (revision == null) return; update.mutate({ id: draft.id, data: { payload, expectedRevision: revision } }, { onSuccess: ok, onError: err('Nie zapisano szkicu') }); }
    else save.mutate({ data: { payload, ...(targetAedId ? { targetAedId } : {}) } }, { onSuccess: ok, onError: err('Nie zapisano szkicu') });
  };
  const t = (k: keyof DraftForm, label: string, extra: Record<string, unknown> = {}) => <Field label={label}><input className={inputCls} value={f[k]} onChange={set(k)} data-testid={`input-draft-${k}`} {...extra} /></Field>;
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border-2 border-primary/30 bg-card p-5" data-testid="form-draft">
      <p className="font-display text-lg font-bold">{draft ? 'Edycja szkicu' : targetAedId ? 'Zmiana istniejącego AED (szkic)' : 'Nowy szkic AED'}</p>
      {targetAedId && <p className="text-xs text-muted-foreground">Po zatwierdzeniu zmieni się ten sam rekord, bez tworzenia duplikatu.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {t('name', 'Nazwa miejsca', { required: true, maxLength: 160 })}
        {t('address', 'Adres', { required: true, maxLength: 240 })}
        {t('city', 'Miejscowość', { required: true, maxLength: 120 })}
        {t('postalCode', 'Kod pocztowy', { maxLength: 10 })}
        {t('voivodeship', 'Województwo')}
        {t('openingHours', 'Godziny dostępności')}
        {t('latitude', 'Szerokość geogr.', { inputMode: 'decimal', placeholder: '52.2297' })}
        {t('longitude', 'Długość geogr.', { inputMode: 'decimal', placeholder: '21.0122' })}
        <Field label="Umiejscowienie"><select className={inputCls} value={f.placement} onChange={set('placement')} data-testid="select-draft-placement"><option value="indoor">Wewnątrz</option><option value="outdoor">Na zewnątrz</option><option value="unknown">Nieznane</option></select></Field>
        <Field label="Dostępność"><select className={inputCls} value={f.accessibility} onChange={set('accessibility')} data-testid="select-draft-accessibility"><option value="24/7">24/7</option><option value="limited">Ograniczona</option><option value="unknown">Nieznana</option></select></Field>
        {t('sourceUrl', 'Adres źródła (URL)', { type: 'url' })}
        {t('license', 'Licencja')}
        {t('responsibleOrganization', 'Organizacja odpowiedzialna')}
        <Field label="Dostęp publiczny" hint="Deklaracja organizacji, nie weryfikacja w terenie."><select className={inputCls} value={f.publicAccess} onChange={set('publicAccess')} data-testid="select-draft-publicAccess"><option value="">Nie deklaruję</option><option value="true">Tak, dostępny publicznie</option><option value="false">Nie, dostęp ograniczony</option></select></Field>
      </div>
      <fieldset className="rounded-xl border border-dashed p-4">
        <legend className="px-1 text-sm font-semibold">Deklaracje źródła (opcjonalne)</legend>
        <p className="mb-3 text-xs text-muted-foreground">To oświadczenie organizacji zapisane jako deklaracja źródła. AED Puls nie oznacza na tej podstawie urządzenia jako zweryfikowanego.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Stan urządzenia według organizacji"><select className={inputCls} value={f.deviceStatus} onChange={set('deviceStatus')} data-testid="select-draft-deviceStatus"><option value="UNKNOWN">Nie deklaruję / nieznany</option><option value="OPERATIONAL">Sprawne (deklaracja)</option><option value="OUT_OF_SERVICE">Wyłączone z użytku (deklaracja)</option></select></Field>
          <Field label="Data sprawdzenia przez organizację"><input type="date" className={inputCls} value={f.lastVerifiedAt} max={new Date().toISOString().slice(0, 10)} onChange={set('lastVerifiedAt')} data-testid="input-draft-lastVerifiedAt" /></Field>
        </div>
      </fieldset>
      <Field label="Opis lokalizacji"><textarea className={inputCls} rows={2} value={f.description} onChange={set('description')} data-testid="input-draft-description" /></Field>
      <Field label="Notatki wewnętrzne" hint="Nie wpisuj deklaracji o sprawności urządzenia bez dowodu."><textarea className={inputCls} rows={2} value={f.notes} onChange={set('notes')} data-testid="input-draft-notes" /></Field>
      <p className="text-xs text-muted-foreground">Nazwę źródła ustala serwer. Współrzędne możesz też wskazać na mapie w formularzu <Link href="/submit-aed" className="underline">Dodaj AED</Link>.</p>
      {revisionMissing && <p role="alert" className="text-sm text-primary">{MISSING_REVISION}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || revisionMissing} data-testid="button-save-draft">{pending ? 'Zapisywanie…' : 'Zapisz szkic'}</Button>
        <Button type="button" variant="outline" onClick={onDone}>Anuluj</Button>
      </div>
    </form>
  );
}

export function DraftRow({ d, onEdit }: { d: McodEntity; onEdit: () => void }) {
  const submit = useSubmitMcodAedDraft();
  const inv = useInvalidate();
  const err = useErr();
  const { toast } = useToast();
  const [consent, setConsent] = useState(false);
  const p = (d.payload ?? {}) as Record<string, unknown>;
  const status = d.status ?? '';
  const proposalStatus = String(d.proposalStatus ?? '');
  const reviewStatus = String(d.reviewStatus ?? '');
  const isDraft = status === 'DRAFT';
  const needsInfo = status === 'UNCOMPLETED' || proposalStatus === 'UNCOMPLETED' || reviewStatus === 'UNCOMPLETED';
  const revision = rev(d);
  return (
    <li className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between" data-testid={`row-draft-${d.id}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{String(p.name || 'Bez nazwy')}</p><StatusPill status={status} />{needsInfo && status !== 'UNCOMPLETED' && <StatusPill status="UNCOMPLETED" />}{d.targetAedId ? <span className="font-data text-xs text-muted-foreground">korekta AED {String(d.targetAedId).slice(0, 8)}</span> : null}</div>
        <p className="text-sm text-muted-foreground">{[p.address, p.city].filter(Boolean).join(', ')}</p>
      </div>
      {needsInfo ? (
        <Button asChild size="sm" variant="outline"><Link href="/my-submissions" data-testid={`link-draft-uncompleted-${d.id}`}>Uzupełnij w zgłoszeniach</Link></Button>
      ) : isDraft ? (
        revision == null ? <p role="alert" className="text-xs text-primary">{MISSING_REVISION}</p> : (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid={`checkbox-consent-${d.id}`} />Zgoda na publikację</label>
            <Button size="sm" variant="outline" onClick={onEdit} data-testid={`button-edit-draft-${d.id}`}><Pencil className="mr-1 h-3.5 w-3.5" />Edytuj</Button>
            <Button size="sm" disabled={!consent || submit.isPending} onClick={() => submit.mutate({ id: d.id, data: { expectedRevision: revision, publicationConsent: consent } }, { onSuccess: () => { inv(); toast({ title: 'Wysłano do moderacji', description: 'Status: PENDING_APPROVAL' }); }, onError: err('Nie wysłano szkicu') })} data-testid={`button-submit-draft-${d.id}`}><Send className="mr-1 h-3.5 w-3.5" />Wyślij do zatwierdzenia</Button>
          </div>
        )
      ) : status === 'PENDING_APPROVAL' ? (
        <Button asChild size="sm" variant="ghost"><Link href="/my-submissions">Zobacz w zgłoszeniach</Link></Button>
      ) : null}
    </li>
  );
}
