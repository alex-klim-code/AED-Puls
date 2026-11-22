import { Link } from 'wouter';
import { SiteLayout } from '@/components/layout';
import { LogoMark } from '@/components/logo';
import { Button } from '@/components/ui/button';

const principles = [
  ['Pochodzenie przede wszystkim', 'Każdy rekord ma źródło, licencję i historię. Obserwacje ze źródeł nie są nadpisywane podczas łączenia danych.'],
  ['Uczciwe statusy', 'Nie twierdzimy, że urządzenie działa lub jest dostępne całą dobę bez dowodu. Integracje pokazują swój prawdziwy stan.'],
  ['Demonstracyjne logowanie, rzeczywiste dane', 'Konta demonstracyjne mają standardowe uprawnienia wybranej roli. Korzystają ze wspólnego rejestru, a ich zmiany są trwałe i audytowane. Nie utrzymujemy fikcyjnych punktów AED.'],
  ['Uprawnienia po stronie serwera', 'Role Użytkownik, Dostawca i Administrator są sprawdzane przy każdej operacji zapisu.'],
];

export default function About() {
  return (
    <SiteLayout>
      <section className="border-b bg-paper">
        <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
          <LogoMark className="h-14 w-14" />
          <h1 className="mt-8 font-display text-5xl font-extrabold leading-[1.05] sm:text-6xl">Infrastruktura danych dla minut, które decydują.</h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            AED Puls powstał na HackNation 2026 w odpowiedzi na wyzwanie Ministerstwa Cyfryzacji „Misja AED — Dane na Ratunek”. Celem nie jest kolejna mapa, lecz system, który zbiera, standaryzuje, weryfikuje i przygotowuje dane o defibrylatorach do publikacji w dane.gov.pl.
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
        <h2 className="font-display text-3xl font-bold">Zasady platformy</h2>
        <dl className="mt-8 grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2">
          {principles.map(([t, d]) => (
            <div key={t} className="bg-card p-6"><dt className="font-display text-lg font-bold">{t}</dt><dd className="mt-2 text-muted-foreground">{d}</dd></div>
          ))}
        </dl>
      </section>
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
          <p className="font-data text-xs uppercase tracking-[0.2em] text-white/80">Kampania</p>
          <h2 className="mt-3 font-display text-4xl font-extrabold sm:text-5xl">Jedna mapa. Jedne dane. Więcej uratowanych żyć.</h2>
          <p className="mt-6 max-w-2xl text-white/90">
            Zapraszamy gminy, szpitale, uczelnie, przewoźników, sieci handlowe i organizacje pozarządowe do udostępniania danych o swoich defibrylatorach. Wspólny standard i przejrzysta weryfikacja oznaczają, że raz przekazane dane służą wszystkim — mieszkańcom, dyspozytorom i twórcom aplikacji.
          </p>
          <p className="mt-6 font-display text-2xl font-bold">Dodaj AED. Daj szansę.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-background text-foreground hover:bg-background/90"><Link href="/submit-aed">Zgłoś defibrylator</Link></Button>
            <Button asChild size="lg" variant="outline" className="border-white/60 bg-transparent text-white hover:bg-white/10"><a href="/api/standard.xlsx">Pobierz standard danych</a></Button>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
        <h2 className="font-display text-3xl font-bold">Stan realizacji</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border bg-card p-6">
            <p className="text-sm font-bold uppercase tracking-wider text-verified">Działa teraz</p>
            <ul className="mt-4 space-y-2 text-muted-foreground">
              <li>Publiczna mapa z wyszukiwaniem, filtrami i listą</li><li>Zgłoszenia AED i zgłoszenia błędów</li><li>Weryfikacja przez administratora</li><li>Eksport CSV, JSON, GeoJSON i metadane</li><li>Standard danych XLSX i dokumentacja API</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-dashed bg-card p-6">
            <p className="text-sm font-bold uppercase tracking-wider text-warn">Jeszcze niepodłączone</p>
            <ul className="mt-4 space-y-2 text-muted-foreground">
              <li>Import plików CSV/XLSX/GeoJSON od dostawców</li><li>Automatyczne konektory zewnętrznych źródeł</li><li>Wykrywanie duplikatów i konfliktów</li><li>Zarządzanie użytkownikami i rolami</li><li>Publikacja w dane.gov.pl (wymaga uprawnionego dostawcy)</li>
            </ul>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
