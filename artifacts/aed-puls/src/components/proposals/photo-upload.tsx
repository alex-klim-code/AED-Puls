import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useCompleteSubmissionPhoto, useRequestSubmissionPhoto, type SubmissionPhotoInputContentType } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { errorText } from '@/hooks/use-auth';
import { photoSrc } from '@/lib/proposals';
import { cn } from '@/lib/utils';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX = 5 * 1024 * 1024;

/** Prywatne zdjęcie zgłoszenia: widoczne wyłącznie dla uprawnionych (ciasteczka sesji tego samego źródła). */
export function PrivatePhoto({ id, alt = 'Zdjęcie dołączone do zgłoszenia', className }: { id: string; alt?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Nie można wyświetlić zdjęcia (brak dostępu lub plik usunięty).</p>;
  return (
    <a href={photoSrc(id)} target="_blank" rel="noreferrer" className={cn('block overflow-hidden rounded-xl border bg-muted', className)} data-testid={`img-photo-${id}`}>
      <img src={photoSrc(id)} alt={alt} loading="lazy" onError={() => setFailed(true)} className="max-h-72 w-full object-contain" />
    </a>
  );
}

type State = { phase: 'idle' } | { phase: 'uploading'; name: string } | { phase: 'ready'; id: string; name: string } | { phase: 'error'; message: string };

/** Jedno zdjęcie JPG/PNG/WebP do 5 MiB. Plik trafia bezpośrednio do magazynu, do API wysyłamy tylko metadane. */
export function PhotoPicker({ onChange, onBusy, disabled, label = 'Zdjęcie (opcjonalnie)', testId = 'photo' }: {
  onChange: (id: string | null) => void; onBusy?: (busy: boolean) => void; disabled?: boolean; label?: string; testId?: string;
}) {
  const [state, setState] = useState<State>({ phase: 'idle' });
  const input = useRef<HTMLInputElement>(null);
  const gen = useRef(0);
  const request = useRequestSubmissionPhoto();
  const complete = useCompleteSubmissionPhoto();
  const cbs = useRef({ onChange, onBusy });
  cbs.current = { onChange, onBusy };
  const busy = state.phase === 'uploading';
  useEffect(() => { cbs.current.onBusy?.(busy); }, [busy]);

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    const run = ++gen.current;
    cbs.current.onChange(null);
    if (!TYPES.includes(file.type)) { setState({ phase: 'error', message: 'Dozwolone formaty: JPG, PNG lub WebP.' }); return; }
    if (file.size < 1 || file.size > MAX) { setState({ phase: 'error', message: 'Plik musi mieć od 1 B do 5 MiB.' }); return; }
    setState({ phase: 'uploading', name: file.name });
    try {
      const meta = await request.mutateAsync({ data: { name: file.name.slice(0, 200), size: file.size, contentType: file.type as SubmissionPhotoInputContentType } });
      const put = await fetch(meta.uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type }, credentials: 'omit' });
      if (!put.ok) throw new Error(`Magazyn odrzucił plik (HTTP ${put.status}).`);
      const done = await complete.mutateAsync({ id: meta.id });
      if (run !== gen.current) return;
      setState({ phase: 'ready', id: done.id, name: file.name });
      cbs.current.onChange(done.id);
    } catch (e) {
      if (run !== gen.current) return;
      setState({ phase: 'error', message: errorText(e) || 'Nie udało się przesłać zdjęcia.' });
    }
  };
  const clear = () => { gen.current++; setState({ phase: 'idle' }); cbs.current.onChange(null); };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <p className="font-data text-[11px] text-muted-foreground">JPG · PNG · WebP · max 5 MiB i 20 MP · 1 plik</p>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => void pick(e.target.files?.[0])} data-testid={`input-${testId}`} />
      {state.phase === 'ready' ? (
        <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
          <PrivatePhoto id={state.id} alt={`Podgląd: ${state.name}`} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()} data-testid={`button-${testId}-replace`}><RefreshCw className="mr-2 h-4 w-4" />Zamień</Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={clear} data-testid={`button-${testId}-remove`}><Trash2 className="mr-2 h-4 w-4" />Usuń</Button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()}
          className="flex w-full items-center gap-3 rounded-xl border border-dashed bg-card p-3 text-left text-sm transition-colors hover:border-foreground disabled:opacity-60" data-testid={`button-${testId}-pick`}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden /> : <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden />}
          <span>{busy ? `Przesyłanie: ${state.phase === 'uploading' ? state.name : ''}` : 'Wybierz zdjęcie'}<span className="block text-xs text-muted-foreground">Zdjęcie jest prywatne: widzą je tylko administrator i zgłaszający.</span></span>
        </button>
      )}
      {state.phase === 'error' && <p role="alert" className="text-sm text-primary" data-testid={`text-${testId}-error`}>{state.message}</p>}
    </div>
  );
}
