import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { getGetSessionQueryKey, getListMcodInstitutionsQueryKey, useListMcodInstitutions, useSubmitMcodInstitutionRequest } from '@workspace/api-client-react';
import { ErrorState, ListSkeleton } from '@/components/aed-bits';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Field, Section, StatusPill, inputCls, str, useErr, useInvalidate } from './mcod-shared';

export function InstitutionPicker({ value, onChange }: { value: string; onChange: (id: string, name: string) => void }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const p = { page, search: search || undefined };
  const q = useListMcodInstitutions(p, { query: { queryKey: getListMcodInstitutionsQueryKey(p) } });
  return (
    <div className="space-y-2">
      <input className={inputCls} aria-label="Szukaj instytucji" placeholder="Szukaj instytucji w lokalnej kopii katalogu" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} data-testid="input-institution-search" />
      {q.isLoading ? <ListSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {q.data?.activationRequired ? 'Katalog instytucji MCOD nie został jeszcze pobrany. Integracja MCOD oczekuje na aktywację. Możesz złożyć wniosek o nową organizację.' : 'Brak wyników w lokalnej kopii katalogu.'}
        </p>
      ) : (
        <ul className="max-h-60 divide-y overflow-auto rounded-lg border">
          {q.data.items.map((i) => (
            <li key={i.id}>
              <button type="button" aria-pressed={value === i.id} onClick={() => onChange(i.id, str(i, 'name'))} className={cn('w-full px-3 py-2 text-left text-sm hover:bg-muted', value === i.id && 'bg-accent font-semibold')} data-testid={`button-institution-${i.id}`}>{str(i, 'name') || i.id}</button>
            </li>
          ))}
        </ul>
      )}
      {q.data && q.data.total > q.data.pageSize && (
        <div className="flex items-center justify-between text-xs">
          <Button type="button" size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Poprzednia</Button>
          <span>Strona {page} z {Math.ceil(q.data.total / q.data.pageSize)}</span>
          <Button type="button" size="sm" variant="outline" disabled={page * q.data.pageSize >= q.data.total} onClick={() => setPage(page + 1)}>Następna</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Wybór instytucji nie daje uprawnień. Administrator weryfikuje, że jesteś jej przedstawicielem.</p>
    </div>
  );
}

export function RegisterForm() {
  const qc = useQueryClient();
  const inv = useInvalidate();
  const err = useErr();
  const { toast } = useToast();
  const submit = useSubmitMcodInstitutionRequest();
  const [kind, setKind] = useState<'NEW' | 'EXISTING'>('EXISTING');
  const [inst, setInst] = useState({ id: '', name: '' });
  const [f, setF] = useState({ organizationName: '', representativeName: '', representativeRole: '', representativeEmail: '', fullName: '', shortName: '', institutionType: '', address: '', email: '', phone: '', website: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const [done, setDone] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (kind === 'EXISTING' && !inst.id) { toast({ title: 'Wybierz instytucję z katalogu', variant: 'destructive' }); return; }
    submit.mutate({
      data: {
        kind,
        representativeName: f.representativeName, representativeRole: f.representativeRole, representativeEmail: f.representativeEmail,
        ...(kind === 'EXISTING' ? { institutionId: inst.id, organizationName: inst.name || undefined } : {
          organizationName: f.organizationName,
          details: { fullName: f.fullName, shortName: f.shortName, institutionType: f.institutionType, address: f.address, email: f.email, phone: f.phone, website: f.website, additionalFields: {} },
        }),
      },
    }, {
      onSuccess: () => {
        setDone(true); inv(); qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
        toast({ title: 'Wniosek zapisany', description: 'Status: PENDING_VERIFICATION. Czeka na administratora.' });
      },
      onError: err('Nie udało się złożyć wniosku'),
    });
  };

  if (done) return (
    <div className="rounded-2xl border bg-card p-8" data-testid="status-application-submitted">
      <StatusPill status="PENDING_VERIFICATION" />
      <p className="mt-4 font-display text-2xl font-bold">Wniosek przyjęty do weryfikacji</p>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">Administrator sprawdzi, czy reprezentujesz organizację. Zatwierdzenie dotyczy wniosku w AED Puls i nie tworzy instytucji w MCOD.</p>
      <Button asChild className="mt-5"><Link href="/mcod">Przejdź do panelu MCOD</Link></Button>
    </div>
  );

  const t = (k: keyof typeof f, label: string, extra: Record<string, unknown> = {}) => <Field label={label}><input required className={inputCls} value={f[k]} onChange={set(k)} data-testid={`input-${k}`} {...extra} /></Field>;
  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div role="radiogroup" aria-label="Rodzaj wniosku" className="grid gap-2 sm:grid-cols-2">
        {([['EXISTING', 'Istniejąca instytucja', 'Reprezentuję instytucję z katalogu dane.gov.pl'], ['NEW', 'Nowa organizacja', 'Instytucji nie ma w katalogu']] as const).map(([k, l, d]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn('rounded-xl border-2 p-4 text-left transition-colors', kind === k ? 'border-primary bg-accent' : 'hover:border-foreground/40')} data-testid={`button-kind-${k.toLowerCase()}`}>
            <span className="block font-semibold">{l}</span><span className="text-xs text-muted-foreground">{d}</span>
          </button>
        ))}
      </div>
      <Section title={kind === 'EXISTING' ? 'Instytucja' : 'Dane organizacji'}>
        {kind === 'EXISTING' ? <InstitutionPicker value={inst.id} onChange={(id, name) => setInst({ id, name })} /> : (
          <div className="grid gap-4 sm:grid-cols-2">
            {t('organizationName', 'Nazwa organizacji', { minLength: 2 })}
            {t('fullName', 'Pełna nazwa')}
            {t('shortName', 'Nazwa skrócona')}
            {t('institutionType', 'Typ instytucji', { placeholder: 'np. jednostka samorządu, fundacja' })}
            {t('address', 'Adres')}
            {t('email', 'E-mail instytucji', { type: 'email' })}
            {t('phone', 'Telefon')}
            {t('website', 'Strona WWW', { type: 'url', placeholder: 'https://' })}
          </div>
        )}
      </Section>
      <Section title="Przedstawiciel">
        <div className="grid gap-4 sm:grid-cols-3">
          {t('representativeName', 'Imię i nazwisko', { minLength: 2 })}
          {t('representativeRole', 'Stanowisko / rola', { minLength: 2 })}
          {t('representativeEmail', 'Służbowy e-mail', { type: 'email' })}
        </div>
      </Section>
      <Button type="submit" size="lg" disabled={submit.isPending} data-testid="button-submit-application"><Send className="mr-2 h-4 w-4" />{submit.isPending ? 'Zapisywanie…' : 'Złóż wniosek do weryfikacji'}</Button>
    </form>
  );
}
