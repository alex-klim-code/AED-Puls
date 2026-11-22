import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { getGetSubmissionThreadQueryKey, useAddSubmissionComment, useGetSubmissionThread } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ErrorState, ListSkeleton } from '@/components/aed-bits';
import { errorText } from '@/hooks/use-auth';
import { formatStamp, roleLabel, statusLabelFor } from '@/lib/proposals';
import { cn } from '@/lib/utils';
import { PhotoPicker, PrivatePhoto } from './photo-upload';

const ACTIONS: Record<string, string> = {
  SUBMITTED: 'Przekazano do weryfikacji', CREATED: 'Utworzono zgłoszenie', SAVE: 'Administrator zapisał zmiany', APPROVE: 'Zatwierdzono',
  REJECT: 'Odrzucono', REQUEST_INFO: 'Poproszono o uzupełnienie', RESUBMIT: 'Zgłaszający uzupełnił dane', RESUBMITTED: 'Zgłaszający uzupełnił dane',
  REVIEW: 'Decyzja administratora', DONE: 'Zakończono', REJECTED: 'Odrzucono', CORRECTION: 'Zastosowano poprawkę', STATUS: 'Zmiana statusu',
};

type Item = { t: 'c'; id: string; at: string; body: string; author: string; role: string; photoId?: string | null } | { t: 'h'; id: string; at: string; action: string; changes: Record<string, unknown> };

/** Prywatny wątek zgłoszenia: komentarze i historia. Dostęp kontroluje serwer. */
export function SubmissionThread({ kind, id }: { kind: 'AED' | 'ERROR'; id: string }) {
  const key = getGetSubmissionThreadQueryKey(kind, id);
  const q = useGetSubmissionThread(kind, id, { query: { enabled: !!id, queryKey: key } });
  const add = useAddSubmissionComment();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);

  const items = useMemo<Item[]>(() => {
    if (!q.data) return [];
    return [
      ...q.data.comments.map((c): Item => ({ t: 'c', id: c.id, at: c.createdAt, body: c.body, author: c.author, role: c.authorRole, photoId: c.photoId })),
      ...q.data.history.map((h): Item => ({ t: 'h', id: h.id, at: h.createdAt, action: h.action, changes: h.changes ?? {} })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [q.data]);

  const canSend = (body.trim().length > 0 || !!photoId) && !uploading && !add.isPending;
  const send = () => {
    if (!canSend) return;
    add.mutate({ kind, id, data: { body: body.trim(), ...(photoId ? { photoId } : {}) } }, {
      onSuccess: () => { setBody(''); setPhotoId(null); setPickerKey((k) => k + 1); qc.invalidateQueries({ queryKey: key }); },
    });
  };

  return (
    <section className="rounded-2xl border bg-card" aria-label="Rozmowa i historia zgłoszenia" data-testid={`thread-${kind}-${id}`}>
      <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3 sm:px-5">
        <h3 className="font-display text-lg font-bold">Rozmowa</h3>
        <span className="text-xs text-muted-foreground">Widoczna tylko dla zgłaszającego i administratora</span>
      </div>
      <div className="space-y-3 px-4 py-4 sm:px-5">
        {q.isLoading ? <ListSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} title="Nie udało się wczytać rozmowy" /> : !items.length ? (
          <p className="text-sm text-muted-foreground">Brak wpisów. Napisz pierwszy komentarz.</p>
        ) : (
          <ol className="space-y-3">
            {items.map((it) => it.t === 'h' ? (
              <li key={`h-${it.id}`} className="flex items-start gap-2 text-xs text-muted-foreground" data-testid={`history-${it.id}`}>
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{historyLabel(it.action, it.changes, kind)}</span> · {formatStamp(it.at)}
                  {typeof it.changes.note === 'string' && it.changes.note && <span className="block italic">„{it.changes.note}”</span>}
                </span>
              </li>
            ) : (
              <li key={`c-${it.id}`} className={cn('rounded-xl border p-3', it.role === 'ADMIN' ? 'border-primary/25 bg-accent/60' : 'bg-background')} data-testid={`comment-${it.id}`}>
                <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="font-semibold text-foreground">{it.author}</span>
                  <span className="text-muted-foreground">{roleLabel[it.role] ?? it.role}</span>
                  <span className="font-data text-muted-foreground">{formatStamp(it.at)}</span>
                </p>
                {it.body && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">{it.body}</p>}
                {it.photoId && <PrivatePhoto id={it.photoId} className="mt-2 max-w-sm" />}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="space-y-3 border-t px-4 py-4 sm:px-5">
        <Textarea rows={3} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} placeholder="Napisz komentarz lub odpowiedź…" disabled={add.isPending} aria-label="Treść komentarza" data-testid={`input-comment-${kind}-${id}`} />
        <PhotoPicker key={pickerKey} onChange={setPhotoId} onBusy={setUploading} disabled={add.isPending} label="Zdjęcie do komentarza (opcjonalnie)" testId={`comment-photo-${id}`} />
        {add.error && <p role="alert" className="text-sm text-primary">{errorText(add.error)}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{body.length}/4000 · samo zdjęcie też wystarczy</span>
          <Button type="button" onClick={send} disabled={!canSend} data-testid={`button-send-comment-${id}`}><Send className="mr-2 h-4 w-4" />{add.isPending ? 'Wysyłanie…' : 'Wyślij'}</Button>
        </div>
      </div>
    </section>
  );
}

function historyLabel(action: string, changes: Record<string, unknown>, kind: 'AED' | 'ERROR') {
  const to = typeof changes.status === 'string' ? changes.status : typeof changes.to === 'string' ? changes.to : null;
  const base = ACTIONS[action] ?? action;
  return to ? `${base} → ${statusLabelFor(to, kind)} (${to})` : base;
}
