import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAssessDevice, getGetAedQueryKey, getListAedsQueryKey, type Aed, type DeviceAssessment } from '@workspace/api-client-react';
import { useSession } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { deviceVerificationLabel, operationalLabel } from './source-provenance';

export function DeviceAssessmentForm({ aed }: { aed: Aed }) {
  const { user } = useSession();
  const canAssess = !!user && !aed.isDemo && (user.role === 'ADMIN'
    || (user.role === 'PROVIDER' && !!user.organizationId && user.organizationId === aed.organizationId));
  const [status, setStatus] = useState<DeviceAssessment['recordVerificationStatus']>('UNVERIFIED');
  const [operational, setOperational] = useState<DeviceAssessment['operationalStatus']>(aed.operationalStatus);
  const [date, setDate] = useState('');
  const [evidence, setEvidence] = useState('');
  const [url, setUrl] = useState('');
  const mutation = useAssessDevice();
  const qc = useQueryClient();
  const { toast } = useToast();
  if (!canAssess) return null;
  const verified = status.startsWith('VERIFIED_');
  return <section className="rounded-2xl border bg-card p-6">
    <h2 className="font-display text-xl font-bold">Zapisz nową ocenę urządzenia z dowodem</h2>
    <p className="mt-2 text-xs text-muted-foreground">Nie jest to zatwierdzenie publikacji opisu. Zapisuj tylko rzeczywiste ustalenia. Twoja rola i decyzja zostaną odnotowane w audycie.</p>
    <form className="mt-4 space-y-3 text-sm" onSubmit={e => {
      e.preventDefault();
      mutation.mutate({ data: {
        aedId: aed.id, recordVerificationStatus: status, operationalStatus: verified ? operational : 'UNKNOWN',
        evidence, ...(url.trim() ? { evidenceUrl: url.trim() } : {}),
        ...(verified && date ? { verifiedAt: new Date(date).toISOString() } : {}),
      } }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetAedQueryKey(aed.id) });
          qc.invalidateQueries({ queryKey: getListAedsQueryKey() });
          toast({ title: 'Zapisano ocenę urządzenia i dowód' });
        },
        onError: e => toast({ title: 'Nie zapisano oceny', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }),
      });
    }}>
      <label className="block">Weryfikacja urządzenia
        <select className="mt-1 min-h-11 w-full rounded border bg-card p-2" value={status} onChange={e => { setStatus(e.target.value as typeof status); setOperational('UNKNOWN'); }}>
          {Object.entries(deviceVerificationLabel).filter(([key]) => !key.startsWith('VERIFIED_') || (user.role === 'ADMIN' ? key === 'VERIFIED_BY_AUTHORIZED_REVIEWER' : key === 'VERIFIED_BY_OPERATOR')).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label className="block">Sprawność według dowodu
        <select className="mt-1 min-h-11 w-full rounded border bg-card p-2" disabled={!verified} value={verified ? operational : 'UNKNOWN'} onChange={e => setOperational(e.target.value as typeof operational)}>
          {Object.entries(operationalLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      {verified && <label className="block">Data rzeczywistej kontroli
        <input type="datetime-local" required value={date} onChange={e => setDate(e.target.value)} className="mt-1 min-h-11 w-full rounded border bg-card p-2" />
      </label>}
      <label className="block">Opis dowodu
        <textarea required minLength={10} maxLength={2000} value={evidence} onChange={e => setEvidence(e.target.value)} className="mt-1 w-full rounded border bg-card p-2" rows={3} />
      </label>
      <label className="block">Link do dowodu lub protokołu
        <input type="url" value={url} onChange={e => setUrl(e.target.value)} maxLength={1000} className="mt-1 min-h-11 w-full rounded border bg-card p-2" />
      </label>
      <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Zapisywanie…' : 'Zapisz ocenę i dowód'}</Button>
    </form>
  </section>;
}
