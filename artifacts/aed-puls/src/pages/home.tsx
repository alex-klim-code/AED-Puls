import { Link } from 'wouter';
import { ArrowRight, MapPin, PlusCircle, FileSpreadsheet, GitMerge, ShieldCheck, Share2, Building2, Users, Flag } from 'lucide-react';
import { getListAedsQueryKey, useListAeds } from '@workspace/api-client-react';
import { SiteLayout } from '@/components/layout';
import { AedMap } from '@/components/aed-map';
import { EmergencyNotice } from '@/components/aed-bits';
import { Button } from '@/components/ui/button';

const steps = [
  { icon: FileSpreadsheet, t: 'Zbieramy', d: 'Rekordy od gmin, szpitali, firm i społeczności trafiają do jednego miejsca — z zachowaniem oryginału i licencji.' },
  { icon: GitMerge, t: 'Standaryzujemy', d: 'Jeden model danych: współrzędne WGS84, adres, dostępność, godziny, źródło. Rozbieżności są widoczne, nie ukryte.' },
  { icon: ShieldCheck, t: 'Weryfikujemy', d: 'Administratorzy zatwierdzają zgłoszenia. Wskaźnik jakości mówi, jak kompletny jest rekord — i dlaczego.' },
  { icon: Share2, t: 'Udostępniamy', d: 'Zatwierdzone dane w CSV, JSON i GeoJSON z metadanymi, gotowe do przeglądu przed publikacją w dane.gov.pl.' },
];

const problems = [
  ['Rozproszenie', 'Lokalizacje AED żyją w dziesiątkach rejestrów gmin, uczelni, przewoźników i aplikacji. Żaden nie jest pełny.'],
  ['Niespójność', 'Ten sam defibrylator potrafi mieć trzy adresy, dwie pary współrzędnych i sprzeczne godziny dostępu.'],
  ['Brak pochodzenia', 'Bez źródła i daty weryfikacji nie wiadomo, czy wpisowi można zaufać ani kto może go poprawić.'],
];

export default function Home() {
  const demo = false;
  const params = { demo };
  const aeds = useListAeds(params, { query: { queryKey: getListAedsQueryKey(params) } });

  return (
    <SiteLayout>
      {/* HERO */}
      <section className="relative overflow-hidden border-b bg-paper">
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div>
            <p className="rise inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 font-data text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <span className="relative flex h-2 w-2"><span className="beat absolute inset-0 rounded-full bg-primary" /><span className="relative h-2 w-2 rounded-full bg-primary" /></span>
              Otwarte dane o defibrylatorach w Polsce
            </p>
            <h1 className="rise rise-2 mt-6 font-display text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl lg:text-[4.4rem]">
              Jedna mapa.<br />Jedne dane.<br />
              <span className="text-primary">Więcej uratowanych żyć.</span>
            </h1>
            <svg viewBox="0 0 520 40" className="rise rise-3 mt-6 h-8 w-full max-w-md text-primary" aria-hidden>
              <path className="ecg" d="M0 20h170l12-16 16 32 12-24 8 8h302" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="rise rise-3 mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              AED Puls pomaga zbierać i porządkować informacje o defibrylatorach. Zgłaszaj lokalizacje, sprawdzaj pochodzenie danych i przygotowuj otwarte zbiory do publikacji.
            </p>
            <div className="rise rise-4 mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-12 px-6 text-base" data-testid="link-find-aed">
                <Link href="/map"><MapPin className="mr-2 h-5 w-5" /> Znajdź AED</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 bg-card px-6 text-base" data-testid="link-add-aed">
                <Link href="/submit-aed"><PlusCircle className="mr-2 h-5 w-5" /> Dodaj AED</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 bg-card px-6 text-base" data-testid="link-report-error">
                <Link href="/report"><Flag className="mr-2 h-5 w-5" aria-hidden /> Zgłoś błąd</Link>
              </Button>
            </div>
            <EmergencyNotice className="rise rise-4 mt-10 max-w-xl" />
          </div>

          {/* Map preview */}
          <div className="rise rise-3 flex flex-col overflow-hidden rounded-3xl border bg-card shadow-[0_30px_60px_-30px_hsl(222_47%_11%/0.35)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
              <div>
                <p className="text-sm font-semibold">Podgląd mapy</p>
                <p className="text-xs text-muted-foreground">
                  Rzeczywiste wpisy AED — źródło i stan weryfikacji znajdziesz w szczegółach
                </p>
              </div>
            </div>
            <div className="relative h-[360px] lg:h-[440px]">
              <AedMap aeds={aeds.data ?? []} label="Podgląd mapy AED" />
              {demo && (
                <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-md bg-foreground px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-background">
                  Demo · nie do użytku ratunkowego
                </div>
              )}
              {!aeds.isLoading && !aeds.error && (aeds.data?.length ?? 0) === 0 && (
                <div className="absolute inset-x-4 bottom-4 z-[500] rounded-xl border bg-card/95 p-4 text-sm">
                  <strong>Zbiór produkcyjny jest jeszcze pusty.</strong> Pierwsze rekordy pojawią się po weryfikacji zgłoszeń i importów.
                </div>
              )}
              {aeds.error && (
                <div role="alert" className="absolute inset-x-4 bottom-4 z-[500] rounded-xl border border-primary/30 bg-card p-4 text-sm">
                  Nie udało się wczytać punktów: {aeds.error instanceof Error ? aeds.error.message : 'błąd serwera'}
                </div>
              )}
            </div>
            <Link href="/map" className="flex items-center justify-between border-t px-5 py-3 text-sm font-semibold hover:bg-muted" data-testid="link-open-map">
              Otwórz pełną mapę z wyszukiwarką i listą <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="font-data text-xs uppercase tracking-[0.2em] text-primary">Problem</p>
            <h2 className="mt-3 font-display text-4xl font-bold leading-tight">Defibrylator jest. Danych o nim — nie do końca.</h2>
            <p className="mt-4 text-muted-foreground">W nagłym zatrzymaniu krążenia każda minuta bez defibrylacji zmniejsza szansę przeżycia. A informacja o tym, gdzie jest najbliższy AED, bywa niepełna.</p>
          </div>
          <ol className="divide-y border-y">
            {problems.map(([t, d], i) => (
              <li key={t} className="grid gap-2 py-6 sm:grid-cols-[80px_200px_1fr]">
                <span className="font-data text-sm text-muted-foreground">0{i + 1}</span>
                <span className="font-display text-xl font-bold">{t}</span>
                <span className="text-muted-foreground">{d}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* HOW */}
      <section className="border-y bg-card">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <p className="font-data text-xs uppercase tracking-[0.2em] text-primary">Jak działa platforma</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl font-bold leading-tight">Od rozproszonych plików do jednego zbioru, któremu można ufać.</h2>
          <ol className="relative mt-14 grid gap-10 md:grid-cols-4 md:gap-6">
            <div className="absolute left-0 right-0 top-6 hidden h-px bg-border md:block" aria-hidden />
            {steps.map((st, i) => (
              <li key={st.t} className="relative">
                <span className="relative flex h-12 w-12 items-center justify-center rounded-full border-2 border-primary bg-card text-primary">
                  <st.icon className="h-5 w-5" aria-hidden />
                </span>
                <p className="mt-5 font-data text-xs text-muted-foreground">Krok {i + 1}</p>
                <h3 className="mt-1 font-display text-xl font-bold">{st.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{st.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* AUDIENCES */}
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-24 sm:px-6 lg:grid-cols-5">
        <div className="rounded-3xl border bg-card p-8 lg:col-span-2">
          <Users className="h-7 w-7 text-primary" aria-hidden />
          <h2 className="mt-5 font-display text-2xl font-bold">Dla mieszkańców</h2>
          <ul className="mt-5 space-y-3 text-muted-foreground">
            <li>Wyszukiwanie po mieście i adresie, mapa oraz dostępna lista tekstowa.</li>
            <li>Jasne ostrzeżenia, gdy dostępność jest nieznana lub niepotwierdzona.</li>
            <li>Nawigacja do punktu w zewnętrznej aplikacji mapowej.</li>
            <li>Zgłoszenie błędu jednym formularzem — bez zakładania konta.</li>
          </ul>
        </div>
        <div className="rounded-3xl bg-foreground p-8 text-background lg:col-span-3">
          <Building2 className="h-7 w-7 text-primary" aria-hidden />
          <h2 className="mt-5 font-display text-2xl font-bold">Dla instytucji i dostawców danych</h2>
          <div className="mt-5 grid gap-5 text-background/80 sm:grid-cols-2">
            <p>Wspólny standard pól z opisem, typami i regułami walidacji — do pobrania jako XLSX.</p>
            <p>Wskaźnik kompletności z wyjaśnieniem, czego brakuje w każdym rekordzie.</p>
            <p>Pełna ścieżka pochodzenia: źródło, licencja, data weryfikacji.</p>
            <p>Eksport zatwierdzonych danych z metadanymi do przeglądu przed publikacją w dane.gov.pl.</p>
          </div>
          <Button asChild variant="secondary" className="mt-8 bg-background text-foreground hover:bg-background/90">
            <Link href="/data">Zobacz standard i eksport <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>
      </section>

      {/* CAMPAIGN */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <svg viewBox="0 0 1200 200" className="absolute inset-x-0 top-1/2 h-40 w-full -translate-y-1/2 text-white/10" preserveAspectRatio="none" aria-hidden>
          <path d="M0 100h420l30-70 40 140 30-100 20 30h660" fill="none" stroke="currentColor" strokeWidth="6" />
        </svg>
        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <p className="font-data text-xs uppercase tracking-[0.2em] text-white/80">Kampania AED Puls</p>
          <h2 className="mt-3 font-display text-5xl font-extrabold leading-none sm:text-7xl">Dodaj AED.<br />Daj szansę.</h2>
          <p className="mt-6 max-w-xl text-lg text-white/90">
            Masz defibrylator w urzędzie, sklepie, szkole lub na stacji? Zgłoś go albo udostępnij rejestr swojej instytucji. Każdy poprawny rekord to krótsza droga do pomocy.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-12 bg-background px-6 text-foreground hover:bg-background/90" data-testid="link-campaign-add">
              <Link href="/submit-aed">Zgłoś defibrylator</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 border-white/60 bg-transparent px-6 text-white hover:bg-white/10">
              <Link href="/about">Jak dołączyć jako instytucja</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* OPEN DATA */}
      <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="font-data text-xs uppercase tracking-[0.2em] text-primary">Otwarte dane</p>
            <h2 className="mt-3 font-display text-4xl font-bold leading-tight">Dane, które można sprawdzić i ponownie wykorzystać.</h2>
            <p className="mt-4 text-muted-foreground">Jeden rekord na AED, z zachowaniem licencji i pochodzenia każdej publikacji. Pusty zbiór produkcyjny to uczciwy stan — nie zastępujemy go danymi przykładowymi.</p>
          </div>
          <div className="rounded-2xl border bg-card p-6">
            <p className="text-sm text-muted-foreground">Wybierz dostawców, sprawdź podgląd unikalnych AED i licencji, a następnie pobierz CSV, JSON lub GeoJSON. Standard pól XLSX i dokumentacja API są dostępne na tej samej stronie.</p>
            <Link href="/data" className="mt-5 inline-flex items-center gap-2 font-semibold text-primary hover:underline" data-testid="link-open-data">Przejdź do otwartych danych <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
