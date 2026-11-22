# AED Puls — integracja MCOD przygotowana offline

## Stan i granice

Adres backendu: `https://mcod-backend-danegovpl.replit.app/api`.

Ta implementacja powstała **bez wysyłania zapytań do MCOD**. Nie pobierano ponownie OpenAPI, instytucji, zbiorów ani zasobów. Nie wykonano publikacji. Nie zmieniano projektu ani bazy MCOD. Istniejące logowanie Google, konta dla sędziów, mapa, import dane.gov.pl i moderacja pozostają osobnymi działającymi częściami aplikacji.

Domyślna konfiguracja:

```text
MCOD_API_BASE_URL=https://mcod-backend-danegovpl.replit.app/api
MCOD_API_ENABLED=false
MCOD_WRITE_ENABLED=false
MCOD_SYNC_ENABLED=false
MCOD_INTEGRATION_ENABLED=false
```

`AED_INTEGRATION_SECRET` jest sekretem wyłącznie backendowym. Nie jest zwracany przez API, dołączany do adresów URL ani logowany. Stara flaga `MCOD_INTEGRATION_ENABLED` **nie aktywuje** nowego klienta.

- `MCOD_API_ENABLED`: nadrzędne pozwolenie na odczyt; bez niego każdy zdalny odczyt i zapis jest zablokowany.
- `MCOD_WRITE_ENABLED`: dodatkowe pozwolenie na operacje zapisu.
- `MCOD_SYNC_ENABLED`: dodatkowe pozwolenie na **ręczne** pobieranie AED.
- Nie ma automatycznego harmonogramu MCOD. Pole zgodności `automaticSyncEnabled` pozostaje `false`; ręczne pozwolenie ma nazwę `syncEnabled`.
- Flagi nie potwierdzają kontraktów ani praw do instytucji. Nie ma przełącznika aktywacji w interfejsie.

Komunikat przy wyłączeniu: **„Integracja MCOD oczekuje na aktywację”**.

## Architektura

- Fastify: `artifacts/api-server/src/modules/mcod*.ts`.
- Jedyny klient zewnętrzny: `src/integrations/mcod/client.ts`.
- Walidowane wewnętrzne DTO i jawnie pusta lista potwierdzonych powiązań zdalnych: `src/integrations/mcod/contracts.ts`.
- Drizzle: `lib/db/src/schema/mcod.ts`, dodatkowe opcjonalne powiązanie korekty w istniejącym `aed-proposals.ts`.
- Kontrakt lokalnego API: `lib/api-spec/openapi.yaml`, klient React i walidatory generowane przez istniejący generator.
- Frontend: `src/pages/mcod.tsx` i małe komponenty `src/components/mcod/`.

Klient ma metody instytucji, zbiorów, zasobów, pobierania plików, publikacji i stronicowanej synchronizacji. Żadna metoda nie zgaduje zdalnego URL, body lub formatu odpowiedzi. Pełny `ContractBinding` wymaga przeglądu specyfikacji, jej SHA-256, daty przeglądu, kodowania żądania i dekodowania odpowiedzi. Pusta lista wiązań oznacza `MCOD_CONTRACT_UNCONFIRMED`, również po włączeniu flag.

Ograniczenia transportu: zatwierdzony origin HTTPS, brak przekazywania Bearer do innego hosta, brak przekierowań, timeout 12 sekund, kontrola rozmiaru i typu odpowiedzi, brak automatycznych ponowień. YAML OpenAPI ma limit 1 MiB; odpowiedzi operacyjne 42 MiB, dane pliku 40 MiB. Schematy i zewnętrzne `$ref` nie są automatycznie pobierane. Odpowiedzi i surowe wyjątki dostawcy nie trafiają do logów ani komunikatów.

## Organizacja i weryfikacja przedstawiciela

`/register-organization` wymaga istniejącego logowania. Nie wprowadza nowego systemu kont.

1. Użytkownik wybiera istniejącą instytucję z **lokalnej pamięci rzeczywistych odpowiedzi** albo nową organizację.
2. Nowa instytucja: pełna i skrócona nazwa, typ, adres, e-mail, telefon, WWW; przedstawiciel podaje imię i nazwisko, funkcję i e-mail. Dodatkowe wymagania MCOD są niepotwierdzone, nie oznaczono formularza jako zgodnego ze zdalnym schematem.
3. Powstaje lokalna organizacja/członkostwo, jeśli konto jeszcze jej nie ma, oraz wniosek `PENDING_VERIFICATION`. Rola organizacji w AED Puls **nie daje uprawnień do instytucji MCOD**.
4. Administrator na `/admin/mcod` sprawdza umocowanie przedstawiciela i zapisuje uzasadnienie. Sama znajomość nazwy/ID instytucji nie wystarcza. Rewizja chroni przed równoczesną oceną.
5. `APPROVED` oznacza wyłącznie lokalne zatwierdzenie wniosku. Instytucja nie została jeszcze utworzona zdalnie.
6. Oddzielne wykonanie, możliwe dopiero po aktywacji i potwierdzeniu kontraktu, sprawdza istniejącą instytucję lub ją tworzy. **Dopiero rzeczywista poprawna odpowiedź** zapisuje jej MCOD ID i stan `REGISTERED`.

Pusta pamięć instytucji jest uczciwie pusta; nie jest symulowaną odpowiedzią aktualnego MCOD. Jej odświeżanie jest operacją administratora wymagającą aktywacji.

## AED i istniejąca moderacja

`/mcod` udostępnia lokalne szkice i istniejące własne rekordy organizacji:

`DRAFT → PENDING_APPROVAL → APPROVED / REJECTED → PUBLISHED`.

- Szkic może być niekompletny i nie pojawia się na publicznej mapie.
- Wysłanie szkicu tworzy istniejące zgłoszenie AED (`NEW`), nie publiczny rekord.
- Dotychczasowe dodawanie ręczne, przez GPS i z pliku jest dostępne przez istniejący formularz; ograniczenie zwykłego USER do GPS pozostaje bez zmian.
- Korekta własnego AED wiąże szkic z `targetAedId`; administrator zmienia **ten sam rekord**, a nie tworzy drugi. Dokładna wersja `updated_at` zachowuje mikrosekundy. Równoczesna zmiana powoduje konflikt, nie nadpisanie.
- Korekty nie zmieniają ustalonej licencji i nie nadpisują pochodzenia importowanego. Stare obserwacje i zgłoszenia pozostają w historii.
- Pola dotyczące dostępu/stanu/kontroli są deklaracją organizacji. Przyjęcie danych i publikacja w MCOD nie nadają fizycznej weryfikacji urządzenia.
- Zgłoszenia wymagające uzupełnienia nadal obsługuje `/my-submissions`. Weryfikacja AED/błędów pozostaje w istniejących ekranach administratora.

## Projekt zbioru i plan publikacji

Model: **instytucja → zbiór → zasób formatu → wiele AED**. Nie tworzymy zbioru dla każdego AED.

1. Dla lokalnie zatwierdzonego wniosku można utworzyć projekt zbioru. Ponowienie tej samej nazwy i opisu zwraca istniejący projekt.
2. Przygotowanie CSV/GeoJSON zbiera pełną aktualną listę własnych, rzeczywistych, nieimportowanych AED zaakceptowanych w istniejącej moderacji.
3. Utrwalany jest niezmienny snapshot, dokładne rewizje źródłowe, raport decyzji dla rekordów, obowiązki licencyjne i klucz idempotencji.
4. Zgoda na publikację musi odpowiadać licencji. Nieustalone prawa, importowane/domieszane pochodzenie, nieoceniona zależność geokodowania i potencjalne duplikaty blokują plan. Nie usuwają żadnych rekordów z bazy.
5. CC0, CC BY i ODbL są dopuszczone. Sama obecność ODbL i CC BY nie blokuje lokalnego pliku. Każdy rekord zachowuje własną licencję i obowiązkową atrybucję; nie przypisujemy plikowi jednej wspólnej licencji.
6. Brak GPS nie blokuje CSV. GeoJSON ma wtedy prawidłowe `geometry: null`, nie fikcyjny punkt. Raport pokazuje brak lokalizacji.
7. Lokalny podgląd/pobranie pliku wymaga dostępu do organizacji. Plan z błędami praw nie udostępnia pliku.
8. Identyczny snapshot zwraca ten sam plan. Przy późniejszym wysyłaniu dane są ponownie porównywane z planem.

Dotychczasowy publiczny moduł eksportu CSV/JSON/GeoJSON/XLSX i jego pakiety licencyjne nie został zastąpiony tym prywatnym przygotowaniem publikacji.

## Przygotowany przebieg zdalny — obecnie zablokowany

Po potwierdzeniu kontraktów i świadomej aktywacji:

1. Sprawdź członkostwo, instytucję `REGISTERED`, aktualny zatwierdzony snapshot i prawa.
2. Zarezerwuj plan i zbiór, aby drugi proces nie rozpoczął równoległej publikacji.
3. Użyj zapisanego własnego MCOD ID zbioru lub utwórz zbiór. ID zapisuj wyłącznie z potwierdzonej odpowiedzi.
4. Sprawdź instytucję i zbiór istniejącego zasobu przed aktualizacją; nie nadpisuj cudzych zasobów.
5. Utwórz/aktualizuj pełny plik zasobu; opublikuj zbiór i zasób.
6. Zweryfikuj ID, status `PUBLISHED`, datę oraz ponownie pobrany plik względem snapshotu.
7. Dopiero wtedy zapisz `PUBLISHED`, `published_at` i historię.

Mieszane licencje wymagają dodatkowo potwierdzenia, że zdalne metadane obsługują oznaczenia per rekord; samo istnienie uploadu nie wystarcza.

Niejasny wynik zapisu, przekierowanie po zapisie, timeout lub utrata lokalnego zapisu potwierdzenia oznaczają `UNKNOWN_OUTCOME`, bez automatycznego powtórzenia. Blokada obejmuje także nowe plany tego samego zbioru. Przerwany `PROCESSING` wymaga ręcznego sprawdzenia — nie resetuj go na ślepo. Kontrakt idempotencji/wyszukiwania po kluczu musi zostać potwierdzony przed pierwszym LIVE.

## Przygotowany import MCOD → AED Puls

Oddzielna ręczna akcja administratora stronicuje instytucje, zbiory i zasoby, odczytuje CSV/JSON/GeoJSON, używa istniejących parserów i normalizacji:

- zachowuje oryginał, rzeczywistego wydawcę, licencję, identyfikatory zbioru/zasobu i historię wersji obserwacji;
- aktualizuje obserwacje idempotentnie, nie usuwa nieobecnych rekordów;
- nie przypisuje fizycznego `VERIFIED`; nie wymyśla lokalizacji;
- nie nadpisuje ręcznie zmienionych, zaakceptowanych ani mieszanych pól;
- łączy automatycznie wyłącznie bardzo mocne zgodności istniejącego mechanizmu tożsamości; niepewne dane pozostają do oceny;
- zachowuje wpisy bez GPS/adresu; nieprzetwarzalne obiekty zachowuje jako obserwacje do kontroli;
- nie pobiera ponownie zasobów opublikowanych przez tę aplikację i nigdy nie kwalifikuje importowanych AED do publikacji wychodzącej;
- MCOD jest kanałem dystrybucji, nie kolejnym niezależnym wydawcą. Nie nadaje kategorii „oficjalne” wyłącznie na podstawie nazwy domeny.

Publiczna widoczność importu wymaga potwierdzonych praw i poprawnej lokalizacji. Wewnętrzne `rightsVerified` nie może być bezwarunkowo ustawione na `true` przez adapter: konieczny jest przegląd rzeczywistych metadanych i dowód `rightsEvidence`. Domyślnie pozostaje `false`. Import jest lokalnym przygotowaniem, nie potwierdzonym testem z rzeczywistym MCOD.

## Najważniejsze lokalne endpointy

- `GET /api/mcod/workspace`, `GET /api/mcod/institutions`: wyłącznie lokalny odczyt.
- `POST /api/mcod/institution-requests`: wniosek organizacji.
- `POST /api/admin/mcod/institution-requests/:id/review`: ocena reprezentanta.
- `POST /api/mcod/aed-drafts`, `PUT /api/mcod/aed-drafts/:id`, `POST .../:id/submit`: szkice i istniejąca moderacja.
- `POST /api/mcod/datasets`, `POST /api/mcod/publications`, `GET .../publications/:id/download`: lokalne plany/pliki.
- Końcówki `execute`, `/admin/mcod/institutions/refresh`, `/admin/mcod/sync` oraz dotychczasowe `/admin/mcod/contract` są zdalne i wymagają flag/kontraktów.

Mutacje korzystają z istniejącej sesji, CSRF i kontroli ról. Administrator widzi wszystkie wnioski; organizacja wyłącznie własne. Dane przedstawicieli nie są publiczną częścią pliku AED.

## Bezpieczna aktywacja i pierwszy test LIVE

**Nie wykonano tych kroków. Nie włączaj flag automatycznie po publikacji ani po upływie daty.**

1. Uzyskaj zgodę na połączenia i aktualny lokalny plik OpenAPI. Sprawdź braki z `MCOD_MISSING_ENDPOINTS.md`.
2. Zweryfikuj schematy, paginację, Bearer, upload/download, politykę licencji oraz idempotencję; dopiero potem dodaj odpowiednie wiązania w kodzie i testy mockowane.
3. Najpierw włącz wyłącznie `MCOD_API_ENABLED=true`; zapisy i sync pozostaw wyłączone. Ręcznie sprawdź listę rzeczywistych instytucji i negatywny test Bearer. Nie utożsamiaj publicznego GET z udzieleniem uprawnień zapisu.
4. Potwierdź przedstawiciela jednej rzeczywistej instytucji i jej zdalne ID.
5. Po osobnej zgodzie ustaw `MCOD_WRITE_ENABLED=true`. Przygotuj jeden plik CSV rzeczywistych, zatwierdzonych, prawidłowo licencjonowanych AED. Sprawdź podgląd i raport.
6. Opublikuj raz, zweryfikuj MCOD ID, widoczność i zgodność pliku. Powtórzenie tego samego planu nie może stworzyć drugiego zbioru/zasobu.
7. Sprawdź aktualizację całego zasobu po dodaniu drugiego prawdziwego AED, obcą organizację (odmowa), mieszane/nieznane prawa (właściwa blokada), timeout (bez ponowienia).
8. Dopiero po oddzielnej zgodzie włącz `MCOD_SYNC_ENABLED=true` i ręcznie wykonaj ograniczony import. Sprawdź historię, niekompletność, deduplikację i brak pętli ponownej publikacji.
9. Przy problemie wyłącz trzy flagi; zachowaj lokalne plany, rekordy, błędy i historię do wyjaśnienia.

Zmiany schematu lokalnego stosuj przez istniejący proces Drizzle. Nie dodano DDL uruchamianego przy starcie serwera. Produkcyjnego schematu i danych nie modyfikowano podczas tej implementacji.
