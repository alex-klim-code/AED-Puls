import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { LogIn, LogOut, Phone, FlaskConical, LayoutDashboard, ListChecks, PlusCircle, Building2, Inbox, Database, MessageSquareWarning, Map as MapIcon, UploadCloud, BadgeCheck, Download, Flag } from 'lucide-react';
import { useHealthCheck } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Logo, LogoMark } from '@/components/logo';
import { useAuthActions, useSession } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { PageBreadcrumbs } from '@/components/page-breadcrumbs';

const publicNav = [
  { href: '/map', label: 'Maps', icon: MapIcon },
  { href: '/status', label: 'Baza', icon: Database },
  { href: '/data', label: 'Export', icon: Download },
];
const reportNav = { href: '/report', label: 'Zgłoś błąd', icon: Flag };

const roleLabel: Record<string, string> = { USER: 'Użytkownik', PROVIDER: 'Organizacja', ADMIN: 'Administrator' };

function NavLink({ href, children, onClick, label }: { href: string; children: ReactNode; onClick?: () => void; label?: string }) {
  const [loc] = useLocation();
  const active = loc === href || (href !== '/' && loc.startsWith(href + '/'));
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={cn('relative inline-flex items-center gap-2 rounded-lg px-2 py-2.5 text-[15px] font-medium transition-colors hover:bg-muted sm:px-3', active ? 'text-foreground' : 'text-muted-foreground')}
      data-testid={`link-nav-${href.replace(/\//g, '') || 'home'}`}
    >
      {children}
      {active && <span className="absolute inset-x-2 bottom-0.5 h-0.5 rounded bg-primary" aria-hidden />}
    </Link>
  );
}

function AccountArea({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const { user, isLoading } = useSession();
  const { logout } = useAuthActions();
  const { toast } = useToast();
  const [, setLoc] = useLocation();
  if (isLoading) return <div className={cn('h-10 animate-pulse rounded-lg bg-muted', compact ? 'w-9 sm:w-28' : 'w-28')} />;
  if (!user)
    return (
      <Button asChild data-testid="link-login" aria-label="Zaloguj się" title="Zaloguj się" className={cn(compact && 'h-9 w-9 p-0 sm:h-10 sm:w-auto sm:px-4')}>
        <Link href="/login" onClick={onDone}>
          <LogIn className={cn('h-4 w-4', compact ? 'sm:mr-2' : 'mr-2')} aria-hidden />
          <span className={cn(compact && 'hidden sm:inline')}>Zaloguj się</span>
        </Link>
      </Button>
    );
  return (
    <div className={cn('flex items-center', compact ? 'gap-1' : 'flex-wrap gap-2')}>
      {user.isDemo && (
        <span className={cn('items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-background', compact ? 'hidden xl:inline-flex' : 'inline-flex')} data-testid="status-demo-mode">
          <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Logowanie demo · rzeczywiste dane
        </span>
      )}
      <Button asChild variant="outline" data-testid="link-dashboard" aria-label="Panel użytkownika" title="Panel użytkownika" className={cn(compact && 'h-9 w-9 p-0 sm:h-10 sm:w-auto sm:px-4')}>
        <Link href="/dashboard" onClick={onDone}>
          <LayoutDashboard className={cn('h-4 w-4', compact ? 'sm:mr-2' : 'mr-2')} aria-hidden />
          <span className={cn(compact && 'hidden sm:inline')}>Panel</span>
        </Link>
      </Button>
      <Button
        variant="ghost"
        aria-label="Wyloguj się"
        title="Wyloguj się"
        className={cn(compact && 'h-9 w-9 p-0 sm:h-10 sm:w-10')}
        disabled={logout.isPending}
        data-testid="button-logout"
        onClick={() =>
          logout.mutate(undefined, {
            onSuccess: () => {
              onDone?.();
              setLoc('/');
            },
            onError: (e) => toast({ title: 'Nie udało się wylogować', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }),
          })
        }
      >
        <LogOut className="h-4 w-4" />
        <span className={cn('ml-2', compact ? 'hidden' : 'lg:hidden')}>Wyloguj</span>
      </Button>
    </div>
  );
}

export function SiteLayout({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a href="#tresc" className="skip-link rounded-lg bg-foreground px-4 py-2 text-background">Przejdź do treści</a>
      <div className="bg-foreground text-[13px] text-background/90">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-1.5 sm:px-6">
          <Phone className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span>
            Nagłe zatrzymanie krążenia? <strong className="text-background">Dzwoń 112</strong> — postępuj zgodnie z poleceniami dyspozytora.
          </span>
        </div>
      </div>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:px-6">
          <Link href="/" aria-label="AED Puls — strona główna" data-testid="link-home" className="shrink-0">
            <Logo className="hidden lg:inline-flex" />
            <LogoMark className="lg:hidden" />
          </Link>
          <nav aria-label="Główna nawigacja" className="flex items-center gap-0.5 sm:gap-1">
            {publicNav.map((n) => (
              <NavLink key={n.href+n.label} href={n.href} label={n.label}>
                <n.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                <span className="hidden md:inline">{n.label}</span>
              </NavLink>
            ))}
            <span className="hidden xl:inline-flex"><NavLink href={reportNav.href} label={reportNav.label}>{reportNav.label}</NavLink></span>
          </nav>
          <div className="flex shrink-0 items-center gap-1">
          <AccountArea compact />
          </div>
        </div>
      </header>
      <PageBreadcrumbs />
      <main id="tresc" className="flex-1">{children}</main>
      {!bare && <SiteFooter />}
    </div>
  );
}

function SiteFooter() {
  const health = useHealthCheck();
  const ok = health.data?.status === 'ok';
  return (
    <footer className="mt-24 bg-foreground text-background/80">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo invert />
          <p className="mt-4 max-w-sm text-sm leading-relaxed">
            Projekt społeczny przygotowany na HackNation 2026 w odpowiedzi na wyzwanie „Misja AED — Dane na Ratunek” Ministerstwa Cyfryzacji. Nie jest serwisem ratunkowym.
          </p>
          <p className="mt-4 text-xs">Podkład mapy: © współtwórcy OpenStreetMap (ODbL).</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-background">Platforma</p>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link href="/map" className="hover:text-background">Mapa AED</Link></li>
            <li><Link href="/submit-aed" className="hover:text-background">Dodaj AED</Link></li>
            <li><Link href="/report" className="hover:text-background">Zgłoś nieprawidłowe dane</Link></li>
            <li><Link href="/about" className="hover:text-background">O projekcie i kampanii</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-background">Dane</p>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link href="/status" className="hover:text-background">Baza — aktualny stan</Link></li>
            <li><Link href="/data" className="hover:text-background">Eksport i metadane</Link></li>
            <li><a href="/api/standard.xlsx" className="hover:text-background">Standard danych (XLSX)</a></li>
            <li><a href="/api/openapi.json" className="hover:text-background">Dokumentacja API</a></li>
          </ul>
          <p className="mt-6 inline-flex items-center gap-2 text-xs" data-testid="status-api">
            <span className={cn('h-2 w-2 rounded-full', ok ? 'bg-verified' : health.isLoading ? 'bg-background/40' : 'bg-primary')} aria-hidden />
            API: {health.isLoading ? 'sprawdzanie…' : ok ? 'działa' : 'niedostępne'}
          </p>
        </div>
      </div>
      <div className="border-t border-background/10">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs sm:px-6">Jedna mapa. Jedne dane. Więcej uratowanych żyć.</p>
      </div>
    </footer>
  );
}

const workspaceNav = [
  { href: '/dashboard', label: 'Pulpit', icon: LayoutDashboard, roles: ['USER', 'PROVIDER', 'ADMIN'] },
  { href: '/my-submissions', label: 'Moje zgłoszenia', icon: ListChecks, roles: ['USER'] },
  { href: '/my-submissions', label: 'Zgłoszenia', icon: ListChecks, roles: ['PROVIDER'] },
  { href: '/submit-aed', label: 'Dodaj AED', icon: PlusCircle, roles: ['USER'] },
  { href: '/report', label: 'Zgłoś błąd', icon: Flag, roles: ['USER'] },
  { href: '/provider', label: 'Organizacja', icon: Building2, roles: ['PROVIDER'] },
  { href: '/provider/aeds', label: 'Rekordy organizacji', icon: Database, roles: ['PROVIDER'] },
  { href: '/provider/red-map', label: 'Red Map', icon: MapIcon, roles: ['PROVIDER', 'ADMIN'] },
  { href: '/register-organization', label: 'Rejestracja organizacji', icon: BadgeCheck, roles: ['USER'] },
  { href: '/mcod', label: 'Publikacja MCOD', icon: UploadCloud, roles: ['PROVIDER'] },
  { href: '/admin/mcod', label: 'Integracja MCOD', icon: UploadCloud, roles: ['ADMIN'] },
  { href: '/admin/submissions', label: 'Zgłoszenia AED', icon: Inbox, roles: ['ADMIN'] },
  { href: '/admin/reports', label: 'Zgłoszenia błędów', icon: MessageSquareWarning, roles: ['ADMIN'] },
];

/** Strona chroniona z boczną nawigacją zależną od roli. */
export function WorkspaceLayout({ roles, title, kicker, actions, children }: { roles: string[]; title: string; kicker?: string; actions?: ReactNode; children: ReactNode }) {
  const { user, isLoading, error, refetch } = useSession();
  const [loc] = useLocation();
  let body: ReactNode;
  if (isLoading) body = <div className="h-64 animate-pulse rounded-2xl bg-muted" />;
  else if (error)
    body = (
      <div role="alert" className="rounded-2xl border bg-card p-8">
        <p className="font-display text-xl font-bold">Nie można sprawdzić sesji</p>
        <p className="mt-2 text-muted-foreground">{error instanceof Error ? error.message : ''}</p>
        <Button className="mt-4" variant="outline" onClick={() => refetch()}>Spróbuj ponownie</Button>
      </div>
    );
  else if (!user)
    body = (
      <div className="rounded-2xl border bg-card p-8 sm:p-12">
        <LogoMark className="h-12 w-12" />
        <h1 className="mt-6 font-display text-3xl font-bold">Ta część wymaga zalogowania</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">Zaloguj się, aby zgłaszać defibrylatory, śledzić weryfikację i zarządzać danymi organizacji.</p>
        <Button asChild className="mt-6" data-testid="link-login-required"><Link href="/login">Przejdź do logowania</Link></Button>
      </div>
    );
  else if (!roles.includes(user.role))
    body = (
      <div className="rounded-2xl border bg-card p-8 sm:p-12">
        <h1 className="font-display text-3xl font-bold">Brak uprawnień</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Twoja rola ({roleLabel[user.role] ?? user.role}) nie ma dostępu do tej sekcji. Uprawnienia są sprawdzane po stronie serwera.
        </p>
        <Button asChild variant="outline" className="mt-6"><Link href="/dashboard">Wróć do pulpitu</Link></Button>
      </div>
    );
  else
    body = (
      <>
        <div className="mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {kicker && <p className="font-data text-xs uppercase tracking-[0.2em] text-primary">{kicker}</p>}
            <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl" data-testid="text-page-title">{title}</h1>
          </div>
          {actions}
        </div>
        {children}
      </>
    );

  return (
    <SiteLayout>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        {user && (
          <aside aria-label="Nawigacja panelu" className="min-w-0">
            <div className="min-w-0 rounded-2xl border bg-card p-4 lg:sticky lg:top-24">
              <nav className={cn('min-w-0 gap-1 lg:flex lg:flex-col',user.role==='USER'?'grid grid-cols-2':'flex overflow-x-auto')}>
                {workspaceNav.filter((n) => n.roles.includes(user.role)).map((n) => {
                  const active = loc === n.href;
                  return (
                    <Link
                      key={n.href+n.label}
                      href={n.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn('flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors', active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
                      data-testid={`link-ws-${n.href.replace(/\//g, '-').slice(1)}`}
                    >
                      <n.icon className="h-4 w-4" aria-hidden /> {n.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </aside>
        )}
        <div className={cn('min-w-0', !user && 'lg:col-span-2')}>{body}</div>
      </div>
    </SiteLayout>
  );
}
