export type PageCrumb = { href: string; label: string };
type Page = { label: string; parent?: string };

const pages: Record<string, Page> = {
  '/': { label: 'Strona główna' },
  '/map': { label: 'Mapa AED', parent: '/' },
  '/data': { label: 'Otwarte dane', parent: '/' },
  '/status': { label: 'Baza', parent: '/' },
  '/about': { label: 'O projekcie', parent: '/' },
  '/report': { label: 'Zgłoś błąd', parent: '/' },
  '/login': { label: 'Logowanie', parent: '/' },
  '/dashboard': { label: 'Pulpit', parent: '/' },
  '/my-submissions': { label: 'Moje zgłoszenia', parent: '/dashboard' },
  '/submit-aed': { label: 'Dodaj AED', parent: '/dashboard' },
  '/provider': { label: 'Organizacja', parent: '/dashboard' },
  '/provider/aeds': { label: 'Rekordy organizacji', parent: '/provider' },
  '/provider/red-map': { label: 'Red Map', parent: '/dashboard' },
  '/admin': { label: 'Administracja', parent: '/dashboard' },
  '/admin/aeds': { label: 'Wszystkie rekordy', parent: '/admin' },
  '/admin/submissions': { label: 'Zgłoszenia AED', parent: '/dashboard' },
  '/admin/reports': { label: 'Zgłoszenia błędów', parent: '/dashboard' },
  '/admin/sources': { label: 'Źródła danych', parent: '/admin' },
  '/register-organization': { label: 'Rejestracja organizacji', parent: '/dashboard' },
  '/mcod': { label: 'Publikacja MCOD', parent: '/dashboard' },
  '/admin/mcod': { label: 'Integracja MCOD', parent: '/admin' },
  '/admin/duplicates': { label: 'Duplikaty', parent: '/admin' },
};

/** Hierarchy, not browsing history: direct links and browser back/forward work identically. */
export function pageBreadcrumbs(location: string): PageCrumb[] {
  const path = location.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const page = pages[path] ?? (/^\/aed\/[^/]+$/.test(path)
    ? { label: 'Szczegóły AED', parent: '/map' }
    : { label: 'Nie znaleziono strony', parent: '/' });
  const result: PageCrumb[] = [{ href: path, label: page.label }];
  let parent = page.parent;
  while (parent) {
    const ancestor = pages[parent];
    result.unshift({ href: parent, label: ancestor.label });
    parent = ancestor.parent;
  }
  return result;
}
