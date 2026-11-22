import { Navigation, X } from 'lucide-react';
import type { ExternalAed } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { directionsUrl } from '@/components/aed-bits';

export function ExternalAedDetail({ aed, onClose }: { aed: ExternalAed; onClose: () => void }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-lg" data-testid="card-external-aed">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-xl font-bold">{aed.name}</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Zamknij szczegóły"><X className="h-4 w-4" /></Button>
      </div>
      <p className="mt-2 text-sm font-semibold text-blue-700">OpenStreetMap · niepotwierdzony przez AED Puls</p>
      <p className="mt-2 text-sm">{[aed.address, aed.city].filter(Boolean).join(', ') || 'Brak adresu w źródle — sprawdź położenie na mapie.'}</p>
      {aed.location && <p className="mt-3 text-sm">{aed.location}</p>}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt>Godziny</dt><dd>{aed.openingHours || 'Brak danych'}</dd>
        <dt>Dostęp</dt><dd>{aed.access === 'yes' || aed.access === 'public' ? 'Publiczny (deklaracja OSM)' : aed.access === 'private' ? 'Prywatny — może być niedostępny' : aed.access === 'no' ? 'Brak publicznego dostępu' : aed.access || 'Nieznany'}</dd>
        <dt>Data kontroli w OSM</dt><dd>{aed.checkDate || 'Brak danych'}</dd>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">Wpis społecznościowy nie potwierdza sprawności ani bieżącej dostępności urządzenia. W nagłym wypadku dzwoń 112 i postępuj według poleceń dyspozytora.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild size="sm"><a href={directionsUrl(aed)} target="_blank" rel="noreferrer"><Navigation className="mr-1 h-4 w-4" /> Wyznacz trasę</a></Button>
        <Button asChild size="sm" variant="outline"><a href={aed.sourceUrl} target="_blank" rel="noreferrer">Źródło i aktualizacja w OSM</a></Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">© współtwórcy OpenStreetMap · <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">ODbL 1.0</a></p>
    </div>
  );
}
