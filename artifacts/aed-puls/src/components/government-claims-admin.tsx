import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useListGovernmentOrganizationClaims, useApproveGovernmentOrganizationClaim, useRejectGovernmentOrganizationClaim, type GovernmentEntity } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/aed-bits';
import { useToast } from '@/hooks/use-toast';
import { inputCls } from '@/components/mcod/mcod-shared';
import { governmentStatus } from './government-organizations';

function ClaimReview({ claim }: { claim: GovernmentEntity }) {
  const [note, setNote] = useState(''), [verified, setVerified] = useState(false);
  const approve = useApproveGovernmentOrganizationClaim(), reject = useRejectGovernmentOrganizationClaim();
  const qc = useQueryClient(), { toast } = useToast();
  const review = (yes: boolean) => (yes ? approve : reject).mutate({ id: claim.id, data: { note, representativeVerified: verified } }, {
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast({ title: 'Nie udało się zapisać decyzji', variant: 'destructive' }),
  });
  const busy = approve.isPending || reject.isPending;
  return <article className="space-y-2 rounded-xl border p-4 text-sm">
    <h3 className="font-semibold">{claim.name}</h3>
    <p>Konto: {claim.userName} · Przedstawiciel: {claim.representative}</p>
    <p className="whitespace-pre-wrap">Podstawa reprezentowania: {claim.evidence}</p>
    <p>{governmentStatus(claim.status)}</p>
    {claim.status === 'PENDING' ? <>
      <label className="block">Notatka z weryfikacji / powód odrzucenia
        <textarea className={inputCls} minLength={8} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} />
      </label>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />Potwierdzono uprawnienie do reprezentowania instytucji</label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !verified || note.trim().length < 8} onClick={() => review(true)}>Zatwierdź przedstawiciela</Button>
        <Button variant="outline" disabled={busy || note.trim().length < 8} onClick={() => review(false)}>Odrzuć wniosek</Button>
      </div>
    </> : <p>{claim.note}</p>}
  </article>;
}
export function GovernmentClaimsAdmin() {
  const q = useListGovernmentOrganizationClaims({ query: { refetchInterval: 10000 } });
  return <section className="space-y-3 rounded-2xl border bg-card p-5">
    <h2 className="text-xl font-bold">Przedstawiciele instytucji dane.gov.pl</h2>
    {q.isLoading ? <p>Wczytywanie wniosków…</p> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> :
      q.data?.length ? q.data.map(c => <ClaimReview key={c.id} claim={c} />) : <p className="text-sm text-muted-foreground">Brak wniosków do weryfikacji.</p>}
  </section>;
}
