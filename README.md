# AED Puls

**Jedna mapa. Jedne dane. Więcej uratowanych żyć.**

Polskojęzyczna platforma danych o AED. Ta wersja jest działającym fundamentem MVP, a nie ukończonym zgłoszeniem konkursowym. Interfejs i operacje użytkownika korzystają z oddzielnego API i PostgreSQL.

**W nagłym zagrożeniu życia dzwoń pod 112. Sam import ani kompletność opisu nie potwierdzają sprawności lub dostępności AED.**

## Architektura

- `artifacts/aed-puls`: frontend React, TypeScript, Vite, Tailwind, shadcn/ui, Leaflet i OpenStreetMap.
- `artifacts/api-server`: oddzielny backend Fastify, sesje serwerowe, RBAC, walidacja, moderacja i eksporty.
- `lib/db`: PostgreSQL i modele Drizzle. Oryginalne obserwacje źródłowe są oddzielone od kanonicznych AED.
- `lib/api-spec/openapi.yaml`: kontrakt REST/OpenAPI. Klient React Query i walidatory Zod są generowane z tego kontraktu.
- `artifacts/api-server/src/maintenance/remove-demo.ts`: zatwierdzone przez użytkownika, transakcyjne usuwanie wycofanych fikcyjnych AED i ich zależności przy uruchomieniu API; rzeczywiste dane i tożsamości logowania pozostają.
- `docs/requirements-checklist.md`: aktualny zakres i braki.

## Uruchamianie

Serwisy uruchamiają skonfigurowane procesy aplikacji:

```sh
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/aed-puls run dev
```

Platforma dostarcza zmienne `PORT`, `BASE_PATH` i połączenie PostgreSQL. Nie należy kopiować wartości połączenia do repozytorium. Frontend komunikuje się z `/api` przez wspólną domenę.

Polecenia deweloperskie:

```sh
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/db run push
pnpm run typecheck
```

Zmiany schematu przygotowuje się w bazie deweloperskiej. Nie ma automatycznych migracji wykonywanych przez aplikację przy starcie.

## Konfiguracja i sekrety

| Zmienna | Zastosowanie |
|---|---|
| `SESSION_SECRET` | Wymagany sekret podpisywania ciasteczek, co najmniej 16 znaków. Nigdy nie trafia do frontendu. |
| `DATABASE_URL` | Połączenie PostgreSQL zarządzane przez środowisko. |
| `DEMO_AUTH_ENABLED` | Logowanie demonstracyjne przy dokładnej wartości `true`. Na wyraźne życzenie użytkownika włączone dla development i produkcji. Role działają na rzeczywistych danych; publiczny wybór ADMIN daje pełne uprawnienia administratora. |
| `GOOGLE_CLIENT_ID` | Identyfikator klienta OAuth aplikacji webowej. |
| `GOOGLE_CLIENT_SECRET` | Sekret klienta Google OAuth. |
| `GOOGLE_CALLBACK_URL` | Pełny adres `https://<domena-aplikacji>/api/auth/google/callback`. Musi być identyczny z adresem w Google Cloud. |

Brak konfiguracji Google **nie blokuje działania aplikacji**. Strona logowania informuje, że Google nie jest skonfigurowane. Nie zastępuje logowania Google fikcyjną sesją.

### Google Cloud Console

1. Utwórz projekt i skonfiguruj ekran zgody OAuth z nazwą aplikacji, adresem wsparcia i wymaganymi informacjami o prywatności.
2. Utwórz identyfikator OAuth typu **Web application**.
3. Dodaj dokładny adres `/api/auth/google/callback` z domeną podglądu do autoryzowanych przekierowań. Dla aplikacji opublikowanej dodaj osobny adres z jej rzeczywistą domeną.
4. Dla aplikacji w trybie testowym dodaj konta testerów do ekranu zgody.
5. Zapisz wartości w narzędziu Secrets, nigdy w czacie ani w plikach źródłowych.
6. Ustaw odpowiedni `GOOGLE_CALLBACK_URL` i zrestartuj backend.
7. Sprawdź rzeczywisty przebieg „Kontynuuj z Google”. W tej dostawie nie był możliwy bez danych OAuth.

Przepływ korzysta z authorization code, PKCE S256, jednorazowego state, nonce, weryfikacji podpisu tokenu ID, wystawcy/odbiorcy przez bibliotekę Google i potwierdzenia adresu e-mail. Zweryfikowany `sub` jest identyfikatorem konta. Nowe konta otrzymują rolę `USER`.

### Pierwszy rzeczywisty administrator

Po pierwszym poprawnym logowaniu właściciela zaufany operator uruchamia:

```sh
pnpm --filter @workspace/scripts run bootstrap-admin <zweryfikowany-google-sub>
```

Identyfikator musi należeć do istniejącego konta utworzonego po weryfikacji Google. Bootstrap nie przyjmuje e-maila i nie ma publicznego endpointu. Transakcja, blokada i trwały znacznik blokują ponowne użycie. Kolejne zmiany ról wymagają osobnej funkcji administracyjnej, której ta wersja jeszcze nie zawiera.

## GPS i rzeczywiste punkty AED

Mapa pokazuje rzeczywiste rekordy zaimportowane do PostgreSQL, także po logowaniu demonstracyjnym. Przeglądarka prosi o lokalizację, a po zgodzie pokazuje pozycję, dokładność i zaimportowane AED w promieniu 5 km. GPS wymaga HTTPS i zgody użytkownika. Jeśli osadzony podgląd blokuje tę funkcję, otwórz aplikację w osobnej karcie.

Po odmowie, błędzie GPS lub bez GPS można przesunąć mapę i nacisnąć **„Szukaj AED w tym obszarze”**. Wyszukiwarka tekstowa filtruje wyniki; nie jest geokoderem adresów. Odległości są orientacyjne, w linii prostej. Link do nawigacji otwiera OpenStreetMap.

Dokładna pozycja pozostaje w pamięci przeglądarki; filtrowanie zaimportowanych punktów jest lokalne. Mapa nie wysyła GPS do usług importujących dane. Nie zapisujemy historii GPS. Wybór „Pokaż całą Polskę” usuwa filtr 5 km, a filtr źródła zawęża wyniki do pochodzenia rekordu.

Starszy endpoint `/api/nearby-aeds` nadal obsługuje odczyt Overpass z ograniczeniami i cache, ale nie jest używany przez publiczną mapę, aby nie dublować zaimportowanych punktów OSM.

**Import nie potwierdza sprawności ani bieżącej dostępności AED.** Punkty mają status „Import — niezweryfikowany”, opis źródła i licencję. Importowane rekordy nie trafiają do eksportów zatwierdzonych danych bez ręcznej moderacji. Brak wyników nie oznacza braku defibrylatorów. Awaria źródła zachowuje ostatni import, nigdy nie zastępuje go punktami demo.

## Rzeczywiste importy i kontrola źródeł

Aktualizacja pochodzenia urzędowego i oceny urządzeń: [raport weryfikacji źródeł](docs/official-source-verification.md). Mapa i szczegóły rozróżniają źródła dane.gov.pl, miejskie, społecznościowe i zgłoszenia. Urzędowe pochodzenie nie ustawia automatycznie sprawności ani fizycznej weryfikacji. Ocena urządzenia wymaga osobnej decyzji uprawnionej osoby, dowodu i daty; istniejący status moderacji opisu pozostał niezależny.

Opis połączeń, pomiary i ograniczenia: [docs/real-data-integration.md](docs/real-data-integration.md).

Administrator Google z rolą ADMIN ma panel `/admin/sources` z historią, licznikami z bazy, oryginałami i błędami oraz `/admin/duplicates` z porównaniem i ręcznymi decyzjami. Demo ADMIN widzi tylko podsumowania, bez możliwości zmiany rzeczywistych danych. Sesje i role nie zostały zastąpione.

Synchronizacja obejmuje całą Polskę niezależnie od GPS. Serwer sprawdza co minutę, czy upłynęły 24 godziny od sukcesu; błędy sieci są ponawiane z opóźnieniem, a nieudana sesja może być wznowiona po godzinie. Atomowa blokada źródła zapobiega nakładaniu importów. **Harmonogram działa podczas pracy procesu API** — uśpiony autoscaling nie gwarantuje wykonania o konkretnej godzinie; produkcja wymaga stale działającej instancji albo zewnętrznego harmonogramu.

Zaufany operator środowiska może uruchomić istniejący importer bez logowania HTTP:

```sh
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run sync-data all
# zamiast all: dane-gov, openaedmap, przemysl, warszawa lub openaed-eu (wymaga konfiguracji dla Polski)
```

Oryginały zachowują wszystkie pola źródła i metadane. Braki pozostają UNKNOWN/unknown/null. Do kontroli granic używany jest uproszczony obrys Polski, nie urzędowy rejestr granic. Punkty graniczne trafiają do kontroli zamiast automatycznego publikowania. `AED_DUPLICATE_DISTANCE_METERS` określa próg kandydatów (domyślnie 50 m; zakres 10–200 m).

Potwierdzenie duplikatu łączy tożsamość, zachowuje oryginalne obserwacje i usuwa wtórny punkt z mapy. Nie kopiuje automatycznie pól ani nie przelicza licencji. Pola o tej samej licencji można rozstrzygać oddzielnie; różne licencje pozostają niezależne. ODbL nigdy nie jest automatycznie eksportowane jako CC0.

## Role i demonstracja

Na `/login` wybierz jedną z oddzielnych ról:

- **Użytkownik demo**: zgłaszanie AED i własne zgłoszenia.
- **Dostawca demo**: przegląd AED organizacji oraz zgłaszanie kolejnych.
- **Administrator demo**: rzeczywisty rejestr, zatwierdzanie/odrzucanie zgłoszeń, ocena urządzeń z dowodem, synchronizacja źródeł, rozstrzyganie konfliktów, scalanie i audyt — tak jak ADMIN po zwykłym logowaniu.

Sesje są oddzielne, a tożsamości demo dla danej przeglądarki i roli są zachowywane przez podpisane ciasteczko. `user.isDemo` oznacza wyłącznie sposób logowania. Wszystkie konta korzystają z tych samych rzeczywistych rekordów; obowiązują normalne ograniczenia roli, własności i organizacji, CSRF oraz audyt. Dostawcy nie przypisujemy cudzych importów: jego panel może być początkowo pusty. Techniczna organizacja logowania dostawcy nie potwierdza rzeczywistego operatora ani urzędowego pochodzenia danych.

Fikcyjne AED, ich oryginały i stare atrapy źródeł zostały wycofane. Nie ma przełącznika zbioru demo ani generatora punktów przykładowych. Nowe zgłoszenia także z kont demonstracyjnych są rzeczywiste, oczekują na zwykłą moderację i nie mogą być używane do wpisywania fikcyjnych urządzeń. Historyczny parametr API `demo` jest ignorowany; nigdy nie przełącza na syntetyczne dane. Czyszczenie przy starcie obejmie również pozostałości w produkcji po opublikowaniu tej aktualizacji.

Baza rzeczywistych danych zaczyna się pusta. Nie należy usuwać tego rozróżnienia tylko po to, by pokazać większe statystyki.

## Dane, weryfikacja i eksport

- Zgłoszenie jest zapisywane jako `pending`; nie trafia automatycznie na publiczną mapę.
- Moderacja jest decyzją redakcyjną o danych, nie przeglądem technicznym urządzenia.
- Współrzędne są sprawdzane względem orientacyjnego zakresu Polski. Kontrola rzeczywistej granicy administracyjnej pozostaje do zrobienia.
- Wykrywane są braki informacji oraz kandydaci na duplikaty przy zbliżonych współrzędnych. Nie ma automatycznego scalania.
- Stan techniczny nie jest domyślnie potwierdzany; pozostaje `unknown`.
- Ocena jakości oznacza kompletność i pewność informacji, nie niezawodność AED.
- Oryginalny zgłoszony rekord i jego pochodzenie są zachowywane w osobnej obserwacji.

Publiczne zasoby:

```text
GET /api/aeds
GET /api/aeds
GET /api/aeds/{id}
GET /api/stats
GET /api/sources
GET /api/exports/csv?demo=false&license=CC0-1.0
GET /api/exports/json?demo=false&license=CC0-1.0
GET /api/exports/geojson?demo=false&license=CC0-1.0
GET /api/metadata?demo=false
GET /api/standard.xlsx
GET /api/openapi.json
```

Eksport obejmuje tylko zatwierdzone rekordy, pojedynczą wybraną licencję oraz prawidłowy odnośnik źródłowy. Obsługiwane etykiety licencji: `CC0-1.0`, `CC-BY-4.0`, `ODbL-1.0`. Domyślne pobieranie dotyczy **wyłącznie CC0-1.0**, nie wszystkich rekordów. Sposób logowania nie wybiera innego zbioru. CSV ma kodowanie UTF-8 z BOM i zabezpieczenia przed wykonywaniem formuł.

`aed_data_standard.xlsx` zawiera 27 definicji pól oraz arkusz wersji i instrukcji. Pola obserwacji źródłowych nie są częścią publicznego rekordu kanonicznego.

### Publikowanie na dane.gov.pl

**Nie nastąpiła publikacja, nie ma aktywnego konektora publikującego i nie potwierdzono pełnej zgodności z aktualnym standardem urzędowym.**

Przygotowane pliki i metadane wymagają przeglądu przez uprawnionego dostawcę. Należy ustalić wydawcę, zakres geograficzny, częstotliwość aktualizacji, prawa do danych i warunki każdej licencji, a następnie zweryfikować zasoby według aktualnej dokumentacji portalu i opublikować je autoryzowanym kanałem dostawcy. Odczyt publicznego API katalogowego nie daje uprawnień publikacji.

## Bezpieczeństwo

Nieprzewidywalny identyfikator sesji jest przechowywany w podpisanym ciasteczku `HttpOnly`, `SameSite=Lax`, `Secure` w produkcji. Baza przechowuje skrót identyfikatora. Sesja jest rotowana po logowaniu, wygasa po ośmiu godzinach i jest unieważniana przy wylogowaniu.

Każda operacja zmieniająca dane wymaga tokenu CSRF; klient pobiera go z sesji. Sprawdzane jest pochodzenie żądań przeglądarkowych. Limity żądań chronią logowanie i raporty. Walidacja Zod działa po stronie serwera. Logi nie zawierają ciasteczek ani kodów OAuth w URL.

## Znane ograniczenia

Importery źródłowe obsługują CSV/XLSX/JSON/GeoJSON; nie ma ogólnego kreatora przesyłania dowolnych plików i mapowania ich kolumn przez dostawcę. Nie każdy zasób dane.gov.pl jest poprawny lub maszynowo dostępny — rzeczywiste błędy są widoczne w panelu. Pozostają: edycja organizacyjna, zarządzanie rolami, gwarantowany harmonogram w uśpionym autoscaling, gotowa księga marki PDF, pełny zestaw eksportów logo i finalna prezentacja konkursowa. Nie wykonano audytu WCAG ani pełnego logowania Google w przeglądarce. Szczegóły w checkliście.
