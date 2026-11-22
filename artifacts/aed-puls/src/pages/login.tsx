import { Link, useLocation } from 'wouter';
import { User, Building2, ShieldCheck } from 'lucide-react';
import type { DemoInputRole } from '@workspace/api-client-react';
import { SiteLayout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorText, useAuthActions, useSession } from '@/hooks/use-auth';

const mockRoles: { role: DemoInputRole; label: string; d: string; icon: typeof User }[] = [
  { role: 'USER', label: 'USER', d: 'Zgłaszaj AED i błędy.', icon: User },
  { role: 'ORGANIZATIONS', label: 'ORGANIZATIONS', d: 'Udostępniaj AED swojej organizacji.', icon: Building2 },
  { role: 'ADMIN', label: 'ADMIN', d: 'Weryfikuj dane i zgłoszenia.', icon: ShieldCheck },
];

export default function Login() {
  const { session, user, isLoading, error } = useSession();
  const { mockLogin } = useAuthActions();
  const [, setLoc] = useLocation();
  const google = session?.googleEnabled;

  return (
    <SiteLayout>
      <div className="mx-auto max-w-lg space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">Zaloguj się do AED Puls</h1>
          <p className="mt-1 text-sm text-muted-foreground">Wybierz sposób logowania.</p>
          {user && <p className="mt-3 rounded-xl border bg-card p-3 text-sm">Jesteś zalogowany jako <strong>{user.name}</strong>. <button className="font-semibold text-primary underline" onClick={() => setLoc('/dashboard')}>Przejdź do panelu</button></p>}
        </div>
        <div className="space-y-4">
          <section className="rounded-2xl border bg-card p-4" aria-labelledby="g-h">
            <h2 id="g-h" className="sr-only">Konto Google</h2>
            {isLoading ? <Skeleton className="h-12 w-full" /> : error ? (
              <p role="alert" className="mt-3 text-sm text-primary">Nie można pobrać konfiguracji logowania: {errorText(error)}</p>
            ) : (
              <>
                <Button size="lg" variant="outline" className="h-12 w-full text-base" disabled={!google} onClick={() => { window.open('/api/auth/google', '_top'); }} data-testid="button-google">
                  <span className="mr-3 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background" aria-hidden>G</span>
                  Kontynuuj z Google
                </Button>
                {!google && <p className="mt-3 text-sm text-muted-foreground">Logowanie Google nie jest jeszcze skonfigurowane na tym serwerze.</p>}
              </>
            )}
          </section>

          {session?.demoEnabled && (
            <section className="rounded-2xl border-2 border-dashed border-foreground/30 bg-card p-4" aria-labelledby="d-h">
              <h2 id="d-h" lang="en" className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold tracking-wide text-primary">FOR HACKATHON JUDGES ONLY</h2>
              <div className="mt-3 grid gap-2">
                {mockRoles.map((r) => (
                  <button
                    key={r.role}
                    disabled={mockLogin.isPending}
                    onClick={() => mockLogin.mutate({ data: { role: r.role } }, { onSuccess: () => setLoc('/dashboard') })}
                    className="flex items-center gap-3 rounded-xl border bg-background p-3 text-left transition-colors hover:border-foreground disabled:opacity-60"
                    data-testid={`button-mock-${r.label.toLowerCase()}`}
                  >
                    <r.icon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                    <span><span className="block text-sm font-semibold">{r.label}</span><span className="block text-xs text-muted-foreground">{r.d}</span></span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Konta współdzielone z pełnymi uprawnieniami. Zmiany są trwałe. Dodawaj tylko prawdziwe dane; ocenę sprawności uzasadnij dowodem.</p>
              {mockLogin.error && <p role="alert" className="mt-4 text-sm text-primary">{errorText(mockLogin.error)}</p>}
            </section>
          )}
          <p className="text-center text-sm text-muted-foreground">Reprezentujesz organizację? <Link href="/register-organization" className="font-semibold text-primary underline" data-testid="link-register-organization">Zarejestruj organizację</Link> po zalogowaniu.</p>
        </div>
      </div>
    </SiteLayout>
  );
}
