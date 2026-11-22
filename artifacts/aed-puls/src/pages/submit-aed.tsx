import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Keyboard, Navigation } from 'lucide-react';
import { useSubmitAed, type SubmissionLocation } from '@workspace/api-client-react';
import { WorkspaceLayout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { SubmissionGps } from '@/components/submission-gps';
import { ProposalFields } from '@/components/proposals/proposal-fields';
import { LicenseChoice } from '@/components/proposals/license-choice';
import { FileImport } from '@/components/proposals/file-import';
import { PhotoPicker } from '@/components/proposals/photo-upload';
import { errorText, useSession } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { draftProblems, draftToInput, emptyDraft, invalidateRegistry, type Draft } from '@/lib/proposals';

type Mode = 'MANUAL' | 'GPS' | 'FILE';
const MODES: { value: Mode; label: string; hint: string; icon: typeof Keyboard }[] = [
  { value: 'MANUAL', label: 'Dodaj ręcznie', hint: 'Wpisz adres, współrzędne i szczegóły', icon: Keyboard },
  { value: 'GPS', label: 'Dodaj przez GPS', hint: 'Stań przy urządzeniu i wyślij pozycję', icon: Navigation },
  { value: 'FILE', label: 'Importuj z pliku', hint: 'XLSX lub CSV, do 500 wierszy', icon: FileSpreadsheet },
];

export default function SubmitAed() {
  const { user } = useSession();
  const isUser = user?.role === 'USER';
  const [mode, setMode] = useState<Mode>('GPS');
  const effective: Mode = isUser ? 'GPS' : mode;
  return (
    <WorkspaceLayout roles={['USER', 'PROVIDER']} title="Dodaj defibrylator" kicker="Dodaj AED. Daj szansę.">
      {user?.isDemo && <p className="mb-6 rounded-xl bg-foreground px-4 py-3 text-sm text-background">Logowanie demonstracyjne: zgłaszasz rzeczywiste urządzenie do wspólnego rejestru. Nie dodawaj fikcyjnych punktów.</p>}
      {!isUser && (
        <div role="tablist" aria-label="Sposób dodania" className="mb-8 grid gap-3 sm:grid-cols-3">
          {MODES.map((m) => (
            <button key={m.value} type="button" role="tab" aria-selected={mode === m.value} onClick={() => setMode(m.value)}
              className={cn('rounded-2xl border p-4 text-left transition-colors', mode === m.value ? 'border-primary bg-accent' : 'bg-card hover:bg-muted')}
              data-testid={`tab-mode-${m.value.toLowerCase()}`}>
              <m.icon className={cn('h-5 w-5', mode === m.value ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
              <p className="mt-2 font-display text-lg font-bold">{m.label}</p>
              <p className="text-xs text-muted-foreground">{m.hint}</p>
            </button>
          ))}
        </div>
      )}
      {effective === 'FILE' ? <FileImport /> : <SingleForm key={effective} mode={effective} isUser={isUser} />}
    </WorkspaceLayout>
  );
}

function SingleForm({ mode, isUser }: { mode: 'MANUAL' | 'GPS'; isUser: boolean }) {
  const [draft, setDraft] = useState<Draft>(isUser ? { ...emptyDraft, license: 'CC-BY-4.0' } : emptyDraft);
  const [gps, setGps] = useState<SubmissionLocation | null>(null);
  const [consent, setConsent] = useState(false);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [, setLoc] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const submit = useSubmitAed();
  const isGps = mode === 'GPS';

  useEffect(() => {
    if (!isGps) return;
    setDraft((d) => ({
      ...d, address: gps?.address ?? '', city: gps?.city ?? '', postalCode: gps?.postalCode ?? '', voivodeship: gps?.voivodeship ?? '',
      latitude: gps ? String(gps.latitude) : '', longitude: gps ? String(gps.longitude) : '',
    }));
  }, [gps, isGps]);

  const problems = draftProblems(draft, false);
  const needConsent = isUser || draft.license !== 'UNKNOWN';
  const blocked = uploading || (isGps && !gps) || (needConsent && !consent) || problems.length > 0 || (isUser && draft.name.trim().length < 3);

  const send = () => {
    if (blocked) return;
    const data = draftToInput(draft, {
      sourceName: '', submissionMethod: mode,
      ...(isGps && gps ? { locationToken: gps.locationToken } : {}),
      ...(isUser ? { license: 'CC-BY-4.0', sourceUrl: '' } : {}),
      publicationConsent: needConsent ? consent : false,
      ...(photoId ? { photoId } : {}),
    });
    submit.mutate({ data }, {
      onSuccess: () => {
        invalidateRegistry(qc);
        toast({ title: 'Zgłoszenie w kolejce', description: 'Administrator sprawdzi dane przed publikacją. Status znajdziesz w zgłoszeniach.' });
        setLoc('/my-submissions');
      },
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); send(); }} noValidate className="space-y-10">
      <fieldset className="grid gap-6 border-t pt-8 lg:grid-cols-[220px_1fr]">
        <legend className="sr-only">Dane AED</legend>
        <div>
          <p className="font-data text-xs text-muted-foreground">01</p>
          <p className="font-display text-lg font-bold">Miejsce i dostęp</p>
          {!isGps && <p className="mt-2 text-xs text-muted-foreground">Niekompletne pola są dozwolone. Administrator uzupełni braki przed publikacją.</p>}
        </div>
        <div className="space-y-5">
          {isGps && <div className="grid"><SubmissionGps value={gps} onChange={setGps} /></div>}
          <ProposalFields value={draft} onChange={setDraft} locked={isGps} showSourceUrl={!isUser} />
          <PhotoPicker onChange={setPhotoId} onBusy={setUploading} disabled={submit.isPending} label="Zdjęcie urządzenia (opcjonalnie)" testId="submit-photo" />
        </div>
      </fieldset>
      <fieldset className="grid gap-6 border-t pt-8 lg:grid-cols-[220px_1fr]">
        <legend className="sr-only">Licencja</legend>
        <div>
          <p className="font-data text-xs text-muted-foreground">02</p>
          <p className="font-display text-lg font-bold">{isUser ? 'Zgoda na publikację' : 'Źródło i licencja'}</p>
        </div>
        {isUser ? (
          <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" data-testid="checkbox-publication-consent" />
            <span>Potwierdzam, że opisuję rzeczywisty AED w miejscu przesłanym przez GPS i zgadzam się na udostępnienie mojego zgłoszenia na <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className="underline">CC BY 4.0</a>. Źródło przypisuje aplikacja; adres zachowuje oznaczenia Geoapify i OpenStreetMap.</span>
          </label>
        ) : (
          <div className="space-y-3">
            <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm">Źródłem będzie nazwa Twojej organizacji, ustalana przez serwer na podstawie konta.{isGps && ' W trybie GPS licencja jest opcjonalna. Bez niej administrator wyjaśni ją przed publikacją.'}</p>
            <LicenseChoice value={draft.license} onChange={(license) => setDraft({ ...draft, license })} consent={consent} onConsent={setConsent} />
          </div>
        )}
      </fieldset>
      {problems.length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-xl border border-primary/30 bg-accent p-4 pl-8 text-sm text-accent-foreground">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {submit.error && <p role="alert" className="rounded-xl border border-primary/30 bg-accent p-4 text-sm text-accent-foreground">Serwer odrzucił zgłoszenie: {errorText(submit.error)}</p>}
      <div className="flex flex-wrap items-center gap-4 border-t pt-8">
        <Button type="submit" size="lg" disabled={submit.isPending || blocked} data-testid="button-submit-aed">{submit.isPending ? 'Wysyłanie…' : 'Wyślij do weryfikacji'}</Button>
        <p className="text-sm text-muted-foreground">Nic nie zostanie opublikowane bez zatwierdzenia przez administratora. Zgłoszenie nie potwierdza sprawności urządzenia.</p>
      </div>
    </form>
  );
}
