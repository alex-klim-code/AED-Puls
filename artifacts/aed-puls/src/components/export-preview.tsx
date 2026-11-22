import { Scale, ShieldAlert } from 'lucide-react';
import type { ExportPreview } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { Link } from 'wouter';
import { useSession } from '@/hooks/use-auth';

const n = (v: number) => v.toLocaleString('pl-PL');

export function PreviewBody({ pv, stale }: { pv: ExportPreview; stale: boolean }) {
  const { user } = useSession();
  const sources = pv.sources ?? [];
  const reasons = pv.reasons ?? [];
  return (
    <div className={cn('transition-opacity', stale && 'opacity-50')}>
      <dl className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-border">
        <div className="bg-card p-3"><dt className="text-xs text-muted-foreground">AED do eksportu</dt><dd className="font-display text-3xl font-bold tabular-nums" data-testid="text-preview-records">{n(pv.recordCount)}</dd></div>
        <div className="bg-card p-3"><dt className="text-xs text-muted-foreground">Kandydaci</dt><dd className="font-display text-2xl font-bold tabular-nums text-muted-foreground" data-testid="text-preview-candidates">{n(pv.candidateRecordCount)}</dd></div>
        <div className="bg-card p-3"><dt className="text-xs text-muted-foreground">Pominięte AED</dt><dd className={cn('font-display text-2xl font-bold tabular-nums', pv.skippedRecordCount > 0 && 'text-warn')} data-testid="text-preview-skipped">{n(pv.skippedRecordCount)}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        <span data-testid="text-preview-publications">{n(pv.publicationCount)}</span> publikacji w pliku, {n(pv.skippedPublicationCount)} pominiętych.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">Do ręcznej oceny praw: <strong>{n(pv.manualReviewCount ?? 0)}</strong>. Nie zatrzymuje to eksportu pozostałych, dopuszczonych AED. Brak GPS oznacza INCOMPLETE, a nie zakaz eksportu.</p>
      {!!pv.decisionSamples?.length && <details className="mt-3 rounded-lg border p-3 text-xs">
        <summary className="cursor-pointer font-semibold">Decyzje dla rekordów — próbka {pv.decisionSamples.length}</summary>
        <p className="mt-2 text-muted-foreground">Pełny raport każdej decyzji jest w ZIP i arkuszu walidacji XLSX. Przypadki do ręcznej oceny pokazujemy jako pierwsze. Uzupełnienie adresu ani techniczna edycja nie zatwierdzają praw.</p>
        <ul className="mt-2 space-y-3">{pv.decisionSamples.map(d => <li key={d.aedId} className="break-words border-t pt-2">
          <p className="font-semibold">{d.decision === 'EXPORTED' ? 'Eksportowany' : d.decision === 'MANUAL_REVIEW' ? 'Ręczna ocena praw' : 'Pominięty'}</p>
          <p className="break-all font-data">{d.aedId}</p>
          <p>{d.reasons.join('; ')} · {d.licenses.join(', ')} · {d.relationship}</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">{d.publicationChecks?.map((check,index) => <li key={`${check.publicationId}-${index}`} className="break-all">
            {check.license}: {check.verified ? 'dowód źródłowy potwierdzony' : check.reason}
            {check.evidenceUrl && <> · <a href={check.evidenceUrl} target="_blank" rel="noreferrer" className="underline">Dowód licencji</a></>}
          </li>)}</ul>
          {user?.role === 'ADMIN' && d.decision === 'MANUAL_REVIEW' && <Link href={`/admin/aeds?search=${encodeURIComponent(d.aedId)}`} className="mt-1 inline-block font-semibold text-primary underline">Sprawdź rekord i jego pochodzenie w panelu administratora</Link>}
        </li>)}</ul>
      </details>}

      {pv.recordCount === 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-warn" data-testid="text-zero-safe">
          <p className="flex gap-2 font-semibold"><ShieldAlert className="h-4 w-4 shrink-0" /> Żaden AED nie przeszedł polityki dla tego wyboru.</p>
          <p className="mt-1">Sprawdź poniższe powody dotyczące konkretnych rekordów. ODbL samo w sobie nie blokuje eksportu, a różne licencje niezależnych AED nie blokują się wzajemnie. Pobierz ZIP ze szczegółowym raportem decyzji; pliki danych są dostępne po dopuszczeniu co najmniej jednego rekordu.</p>
        </div>
      )}

      <dl className="mt-4 space-y-3 text-sm">
        <div><dt className="text-xs text-muted-foreground">Wybrane licencje (filtr)</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5" data-testid="list-selected-licenses">{pv.selectedLicenses.map((l) => <span key={l} className="rounded bg-foreground px-2 py-0.5 font-data text-xs text-background">{l}</span>)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Obowiązki licencyjne w pliku (mogą obejmować licencje źródeł połączonych rekordów)</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">{pv.licenses.length ? pv.licenses.map((l) => <span key={l} className="rounded border px-2 py-0.5 font-data text-xs">{l}</span>) : <span className="text-muted-foreground">brak</span>}</dd></div>
        <div className="flex flex-wrap gap-6">
          <div><dt className="text-xs text-muted-foreground">Schemat</dt><dd className="font-data">{pv.schemaVersion}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Polityka</dt><dd className="font-data" data-testid="text-policy-version">{pv.policyVersion}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Pola</dt><dd className="font-data">{pv.fields.length}</dd></div>
        </div>
        {pv.fields.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Lista pól (wspólna dla wszystkich formatów)</summary><p className="mt-2 break-words font-data leading-relaxed">{pv.fields.join(', ')}</p></details>}
      </dl>

      {sources.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border">
          <table className="w-full text-xs" data-testid="table-preview-sources">
            <caption className="border-b bg-muted/60 px-3 py-1.5 text-left font-data text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Źródła i deklarowane licencje</caption>
            <thead><tr className="text-muted-foreground"><th className="px-3 py-1.5 text-left font-medium">Źródło</th><th className="px-2 text-left font-medium">Deklaracja</th><th className="px-2 text-right font-medium">Kand.</th><th className="px-2 text-right font-medium">Eksport</th><th className="px-3 text-right font-medium">Pomin.</th></tr></thead>
            <tbody>{sources.map((s) => (
              <tr key={s.id} className="border-t" data-testid={`row-source-${s.id}`}>
                <td className="max-w-[12rem] truncate px-3 py-1.5" title={s.name}>{s.name}</td>
                <td className="px-2 font-data" title="Licencja deklarowana przez źródło, nie certyfikat prawny">{s.license || 'nieznana'}</td>
                <td className="px-2 text-right font-data tabular-nums">{n(s.recordCount)}</td>
                <td className="px-2 text-right font-data tabular-nums">{n(s.exportedRecordCount)}</td>
                <td className={cn('px-3 text-right font-data tabular-nums', s.skippedRecordCount > 0 && 'text-warn')}>{n(s.skippedRecordCount)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {reasons.length > 0 && (
        <div className="mt-4" data-testid="list-preview-reasons">
          <p className="text-xs font-semibold">Powody pominięcia</p>
          <p className="text-[11px] text-muted-foreground">Jeden AED może mieć kilka powodów — liczb nie należy sumować.</p>
          <ul className="mt-2 divide-y rounded-lg border">
            {reasons.map((r) => (
              <li key={r.code} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
                <span><span className="block font-data text-[10px] uppercase text-muted-foreground">{r.code}</span>{r.message}</span>
                <span className="shrink-0 text-right font-data tabular-nums">{n(r.recordCount)} AED<span className="block text-muted-foreground">{n(r.publicationCount)} publ.</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pv.legalDisclaimer && <p className="mt-3 border-l-2 border-foreground/30 pl-3 text-[11px] leading-relaxed text-muted-foreground" data-testid="text-legal-disclaimer">{pv.legalDisclaimer}</p>}
    </div>
  );
}

export function PolicyExplainer() {
  const items = [
    ['Filtr nie usuwa obowiązków', 'Wybór licencji ogranicza publikacje, ale jeśli AED powstał z połączenia źródeł, obowiązki każdego z nich pozostają w pliku i w LICENSES.txt.'],
    ['Zasada fail-closed', 'Rekordy o nieznanych lub niezweryfikowanych prawach oraz nierozstrzygnięte kombinacje licencji są blokowane, a nie przepuszczane.'],
    ['ODbL i CC BY razem', 'Niezależne rekordy zachowują odrębne licencje i mogą być eksportowane razem. Nierozstrzygnięte połączenie praw w jednym AED wymaga ręcznej oceny tylko tego rekordu. Obowiązki ODbL pozostają.'],
    ['Deklaracja to nie weryfikacja', 'Nazwa licencji to deklaracja źródła. Polityka jest zachowawczą regułą techniczną, a nie certyfikacją prawną ani poradą.'],
  ];
  return (
    <section className="mt-10 rounded-2xl border bg-card p-5" aria-labelledby="pol-h">
      <h2 id="pol-h" className="inline-flex items-center gap-2 font-semibold"><Scale className="h-4 w-4" /> Jak działa polityka licencyjna eksportu</h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([t, d]) => <div key={t} className="border-l-2 border-primary pl-3"><dt className="text-sm font-semibold">{t}</dt><dd className="mt-1 text-xs text-muted-foreground">{d}</dd></div>)}
      </dl>
    </section>
  );
}
