import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileUp } from 'lucide-react';
import { useImportAedProposals, type AedProposalFileLicense, type AedProposalImportResult } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { errorText } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { invalidateRegistry } from '@/lib/proposals';
import { LicenseChoice } from './license-choice';

const MAX = 5 * 1024 * 1024;

function toBase64(file: File) {
  return new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('Nie udało się odczytać pliku.'));
    r.readAsDataURL(file);
  });
}

export function FileImport() {
  const [file, setFile] = useState<File | null>(null);
  const [license, setLicense] = useState('UNKNOWN');
  const [consent, setConsent] = useState(false);
  const [local, setLocal] = useState('');
  const [result, setResult] = useState<AedProposalImportResult | null>(null);
  const imp = useImportAedProposals();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLoc] = useLocation();
  const needsConsent = license !== 'UNKNOWN';

  const pick = (f: File | null) => {
    setResult(null); imp.reset(); setLocal('');
    if (f && !/\.(xlsx|csv)$/i.test(f.name)) { setLocal('Obsługiwane są pliki XLSX oraz CSV w kodowaniu UTF-8.'); setFile(null); return; }
    if (f && f.size > MAX) { setLocal('Plik przekracza 5 MiB.'); setFile(null); return; }
    setFile(f);
  };
  const send = async () => {
    if (!file) return;
    let contentBase64: string;
    try { contentBase64 = await toBase64(file); } catch (e) { setLocal(errorText(e)); return; }
    imp.mutate({ data: { filename: file.name.slice(0, 150), contentBase64, license: license as AedProposalFileLicense, publicationConsent: needsConsent ? consent : false } }, {
      onSuccess: (r) => {
        setResult(r); invalidateRegistry(qc);
        toast({ title: 'Plik przekazany do kolejki administratora', description: `Przyjęte wiersze: ${r.created}, pominięte: ${r.skipped}.` });
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Szablon XLSX</p>
          <p className="text-sm text-muted-foreground">Polskie nagłówki kolumn i instrukcja. Do 500 niepustych wierszy, maks. 5 MiB. Niekompletne wiersze trafią do uzupełnienia.</p>
        </div>
        <Button asChild variant="outline"><a href="/api/aed-proposals/template.xlsx" download data-testid="link-template-download"><Download className="mr-2 h-4 w-4" />Pobierz szablon</a></Button>
      </div>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-muted/30 p-8 text-center hover:bg-muted/60">
        <FileUp className="h-7 w-7 text-primary" aria-hidden />
        <span className="font-semibold">{file ? file.name : 'Wybierz plik XLSX lub CSV'}</span>
        <span className="text-xs text-muted-foreground">{file ? `${(file.size / 1024).toFixed(1)} KiB` : 'Kliknij, aby wskazać plik z dysku'}</span>
        <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} data-testid="input-import-file" />
      </label>
      <div>
        <p className="mb-3 font-display text-lg font-bold">Domyślna licencja danych z pliku</p>
        <p className="mb-3 text-sm text-muted-foreground">Licencja wpisana w wierszu ma pierwszeństwo. Potwierdzenie poniżej dotyczy wybranej tu licencji; wiersze z inną licencją wymagają osobnej oceny praw przez administratora.</p>
        <LicenseChoice value={license} onChange={setLicense} consent={consent} onConsent={setConsent} />
      </div>
      {(local || imp.error) && <p role="alert" className="rounded-xl border border-primary/30 bg-accent p-4 text-sm text-accent-foreground">{local || `Serwer odrzucił plik: ${errorText(imp.error)}`}</p>}
      {result && (
        <div role="status" className="rounded-2xl border bg-card p-5" data-testid="text-import-result">
          <p className="font-semibold">W kolejce administratora: {result.created} · pominięte: {result.skipped}</p>
          {result.errors.length > 0 && (
            <ul className="mt-3 max-h-56 space-y-1 overflow-auto text-sm">
              {result.errors.map((e, i) => {
                const warn = e.message.startsWith('Zapisano do oceny');
                return <li key={i}><span className={warn ? 'mr-1 rounded bg-[hsl(var(--warn)/0.12)] px-1.5 text-xs font-semibold text-warn' : 'mr-1 rounded bg-accent px-1.5 text-xs font-semibold text-accent-foreground'}>{warn ? 'Przyjęty z uwagą' : 'Pominięty'}</span><span className="font-data text-xs text-muted-foreground">wiersz {e.row}</span> {e.message}</li>;
              })}
            </ul>
          )}
          <Button className="mt-4" variant="outline" onClick={() => setLoc('/my-submissions')} data-testid="button-go-submissions">Przejdź do zgłoszeń</Button>
        </div>
      )}
      <Button size="lg" onClick={send} disabled={!file || imp.isPending || (needsConsent && !consent)} data-testid="button-import-submit">
        {imp.isPending ? 'Przesyłanie…' : 'Importuj do weryfikacji'}
      </Button>
    </div>
  );
}
