import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageBreadcrumbs } from '../src/lib/breadcrumbs';

test('home displays only the current home page', () => {
  assert.deepEqual(pageBreadcrumbs('/'), [{ href: '/', label: 'Strona główna' }]);
});
test('public pages have a working home ancestor', () => {
  for (const path of ['/map', '/data', '/status', '/about', '/report', '/login']) {
    const crumbs = pageBreadcrumbs(path);
    assert.equal(crumbs.length, 2);
    assert.equal(crumbs[0].href, '/');
    assert.equal(crumbs.at(-1)!.href, path);
    assert.notEqual(crumbs.at(-1)!.label, 'Nie znaleziono strony');
  }
});
test('nested administration includes every reachable parent', () => {
  assert.deepEqual(pageBreadcrumbs('/admin/sources'), [
    { href: '/', label: 'Strona główna' },
    { href: '/dashboard', label: 'Pulpit' },
    { href: '/admin', label: 'Administracja' },
    { href: '/admin/sources', label: 'Źródła danych' },
  ]);
});
test('organization records have organization and dashboard ancestors', () => {
  assert.deepEqual(pageBreadcrumbs('/provider/aeds').map(c => c.href), ['/', '/dashboard', '/provider', '/provider/aeds']);
});
test('all workspace routes have named, reachable breadcrumb chains', () => {
  for (const path of ['/dashboard', '/my-submissions', '/submit-aed', '/provider', '/provider/aeds',
    '/admin', '/admin/aeds', '/admin/submissions', '/admin/sources', '/admin/duplicates']) {
    const crumbs = pageBreadcrumbs(path);
    assert.equal(crumbs.at(-1)!.href, path);
    for (const crumb of crumbs) assert.notEqual(pageBreadcrumbs(crumb.href).at(-1)!.label, 'Nie znaleziono strony');
  }
});
test('AED details link to the map, not a nonexistent AED collection page', () => {
  assert.deepEqual(pageBreadcrumbs('/aed/example-id'), [
    { href: '/', label: 'Strona główna' },
    { href: '/map', label: 'Mapa AED' },
    { href: '/aed/example-id', label: 'Szczegóły AED' },
  ]);
});
test('queries, hashes and trailing slashes do not alter navigation hierarchy', () => {
  assert.deepEqual(pageBreadcrumbs('/admin/sources/?tab=imports#last'), pageBreadcrumbs('/admin/sources'));
});
test('unknown routes show a safe title with a home link', () => {
  assert.deepEqual(pageBreadcrumbs('/unknown/deep'), [
    { href: '/', label: 'Strona główna' }, { href: '/unknown/deep', label: 'Nie znaleziono strony' },
  ]);
});
