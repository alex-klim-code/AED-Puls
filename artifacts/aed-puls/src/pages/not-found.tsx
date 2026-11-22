import { Link } from 'wouter';
import { SiteLayout } from '@/components/layout';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <SiteLayout>
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
        <svg viewBox="0 0 400 60" className="h-12 w-full max-w-sm text-primary" aria-hidden>
          <path d="M0 30h400" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <p className="mt-8 font-data text-sm text-muted-foreground">Błąd 404</p>
        <h1 className="mt-2 font-display text-5xl font-bold">Brak sygnału pod tym adresem.</h1>
        <p className="mt-4 text-muted-foreground">Strona nie istnieje lub została przeniesiona.</p>
        <div className="mt-8 flex gap-3">
          <Button asChild><Link href="/">Strona główna</Link></Button>
          <Button asChild variant="outline"><Link href="/map">Mapa AED</Link></Button>
        </div>
      </div>
    </SiteLayout>
  );
}
