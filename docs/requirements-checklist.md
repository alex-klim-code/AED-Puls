# AED Puls — zgodność z wymaganiami

Stan pierwszej dostawy: **fundament MVP i podstawowa mapa**, zgodnie z kolejnością wskazaną w załączniku. Nie jest to deklaracja ukończenia obu dokumentów ani niezależna weryfikacja oficjalnego regulaminu HackNation.

Legenda: **wdrożone**, **częściowo**, **brak**.

| Wymaganie | Status | Zakres / ograniczenie |
|---|---|---|
| Oddzielny frontend i backend | Wdrożone | React/Vite i Fastify w osobnych aplikacjach, kontrakt OpenAPI, wspólne biblioteki |
| Polski interfejs | Wdrożone | Treści, nawigacja, formularze i błędy domenowe po polsku |
| PostgreSQL i model danych | Wdrożone | Osobne tabele użytkowników, organizacji, członkostw, sesji, AED, źródeł, obserwacji, zgłoszeń, importów, problemów, duplikatów, raportów i audytu |
| Google OAuth / OIDC | Częściowo | Konfiguracja OAuth dodana. Sprawdzono przekierowanie do Google, parametry PKCE/state/nonce i odrzucanie błędnego callbacku. Pełne logowanie konta pozostaje niezweryfikowane. |
| Jednorazowy administrator | Wdrożone | Zaufany skrypt według zweryfikowanego sub, blokada i trwały znacznik; nie uruchamiano bez konta Google |
| USER / PROVIDER / ADMIN demo | Wdrożone | Rzeczywiste sesje i standardowe uprawnienia danej roli na wspólnych danych, także dla produkcji na wyraźne życzenie użytkownika |
| Brak fikcyjnego zbioru demo | Wdrożone | Usunięto fikcyjne AED i przełączniki zbiorów; oznaczenie demo dotyczy tylko logowania. Zachowano kontrolę ról i własności |
| Publiczna mapa i szczegóły | Wdrożone | Leaflet, GPS za zgodą, lokalny filtr 5 km, zaimportowane rzeczywiste punkty, pochodzenie i licencje; te same dane dla każdego sposobu logowania |
| Wyszukiwanie i filtry | Wdrożone | Miasto/adres/nazwa, dostępność i status |
| Zgłoszenia AED | Wdrożone | Walidacja, trwały zapis, oryginał i status pending |
| Moderacja administratora | Wdrożone | Zatwierdzenie/odrzucenie oczekującego zgłoszenia i audyt |
| Panel dostawcy | Częściowo | Przegląd rekordów organizacji i zgłaszanie; bez edycji istniejących AED i importów |
| Import CSV/XLSX/JSON/GeoJSON | Wdrożone dla konektorów | Rzeczywiste importy plików, walidacja i błędy; bez kreatora przesyłania dowolnego pliku przez dostawcę |
| Co najmniej dwa niezależne źródła | Wdrożone | OpenAEDMap i źródło miejskie Przemyśla; dodatkowo katalog dane.gov.pl z Krosnem i Przemyślem. Katalogowe kopie nie są liczone jako kolejny niezależny wydawca |
| Metadane i zakres źródeł | Wdrożone | Rzeczywiste licencje, wydawcy, identyfikatory, pochodzenie i daty; różnice między kanałami zachowane |
| Zachowanie oryginalnych danych | Wdrożone | Osobna obserwacja źródłowa dla każdego rzeczywistego zgłoszenia i importu |
| Reguły rozstrzygania autorytatywności | Częściowo | Potwierdzane pochodzenie urzędowe i ręczne rozstrzyganie pól; bez automatycznego zastępowania opisów społecznościowych urzędowymi ani odwrotnie |
| Pochodzenie a ocena urządzenia | Wdrożone | Sześć kategorii źródeł; niezależne statusy oceny i sprawności, data i dowód, uprawnienia operatora/recenzenta, brak automatycznej weryfikacji importów |
| Reguły jakości 0–100 | Częściowo | Kompletność, źródło, licencja, dostępność, wyjaśnienia; bez panelu konfiguracji wag i pełnej walidacji granic |
| Duplikaty | Wdrożone | Konfigurowalna odległość, porównanie oryginałów, ręczna decyzja i audyt; połączenie zachowuje źródła, bez kopiowania pól i zmiany licencji |
| Konflikty danych | Wdrożone | Kolejka konfliktów, ręczne zachowanie/wybór pola przy zgodnej licencji; blokada automatycznego przelicencjonowania |
| CSV, JSON, GeoJSON | Wdrożone | Wyłącznie zatwierdzone dane; osobne tryby i pojedyncza licencja na plik |
| Standard XLSX | Wdrożone | `aed_data_standard.xlsx`, 27 definicji, osiem kolumn i osobny arkusz instrukcji |
| Zgodność z dane.gov.pl | Częściowo | Projekt metadanych i eksporty; aktualne wymagania urzędowe nie zostały jeszcze zweryfikowane |
| Publikacja na dane.gov.pl | Brak | Nie deklarujemy publikacji ani uprawnień do zapisu przez API publiczne |
| Kampania i oryginalne logo | Częściowo | Strona kampanii, hasła i znak SVG; bez finalnych materiałów konkursowych |
| Logo SVG/PNG/JPG/PDF i brand book PDF | Brak pełnego zestawu | Wymaga oddzielnego przygotowania i kontroli eksportów |
| Prezentacja min. pięć slajdów | Brak | Nie utworzono finalnej prezentacji ani nie udajemy jej ukończenia |
| Bezpieczeństwo | Częściowo | Sesje, CSRF, limity, walidacja, RBAC i audyt; brak pełnego audytu bezpieczeństwa |
| WCAG 2.2 AA | Częściowo | Responsywny interfejs i alternatywa listowa; zgodność wymaga audytu |
| Dokumentacja konfiguracji i ograniczeń | Wdrożone | README oraz ta checklista |

## Sprawdzenia wykonane dla pierwszej dostawy

- Kontrola typów backendu, modeli i skryptów: pozytywna.
- Backend uruchomił się i odpowiedział na `/api/healthz`.
- Publiczny rzeczywisty zbiór: 0 rekordów; demonstracyjny: 9 rekordów.
- Każda z ról USER, PROVIDER i ADMIN uzyskała odrębną sesję demo i odpowiedź z właściwego workspace.
- Niezalogowany odbiorca otrzymał 401 dla workspace.
- Żądanie zmieniające dane bez CSRF otrzymało 403.
- USER i PROVIDER nie mogły wywołać moderacji administratora: 403.
- Próba ponownej moderacji już zatwierdzonego rekordu przez ADMIN: 409.
- Eksport JSON i GeoJSON: 9 punktów demo; CSV: nagłówek i 9 wierszy danych.
- Wygenerowany XLSX otwarto biblioteką arkuszy: dwa arkusze i 27 definicji pól.
- OpenAPI zwraca poprawny dokument wersji 3.1.0.
- Po dodaniu konfiguracji Google sprawdzono aktywację przycisku, przekierowanie HTTP 302 do Google, parametry state/nonce/PKCE S256 i odrzucenie błędnego callbacku kodem 400. Nie odczytywano ani nie wyświetlano wartości sekretów.
- Podgląd strony głównej na komputerze i mapy na ekranie 402 × 874 wyświetlił się bez błędów konsoli. Widoki po zalogowaniu sprawdzono przez API, nie w zalogowanej przeglądarce.
- Pełna kontrola typów projektu wykryła konflikt typów dwóch wariantów tej samej wersji Vite w nieużywanym serwerze Canvas. Frontend AED Puls, backend, modele i skrypty przeszły własną kontrolę typów. Konflikt Canvas nie blokuje działania AED Puls.

## Sprawdzenia GPS i warstwy OpenStreetMap

- Kontrola typów bibliotek po generowaniu kontraktu, backendu i frontendu: pozytywna.
- Osiem testów automatycznych: mapowanie źródła i geometrii, brak fałszywej weryfikacji, odrzucanie niepełnych danych, zaokrąglanie pozycji, deduplikacja zapytań, cache sukcesów i błędów, globalny zakres poza Polską oraz odległości w linii prostej.
- Rzeczywiste wywołanie `/api/nearby-aeds` dla testowego obszaru centrum Warszawy zwróciło 628 wpisów OSM, licencję ODbL-1.0 i promień 5000 m. Kolejne wywołanie korzystało z cache. Liczba wpisów zależy od obszaru i aktualizacji źródła.
- Nieprawidłowe i brakujące współrzędne otrzymały HTTP 400.
- Baza kanoniczna pozostała oddzielna: 0 zatwierdzonych rzeczywistych rekordów oraz 9 demonstracyjnych. Warstwa OSM nie zmienia eksportów.
- Podgląd mapy pokazał obsługę odmowy lokalizacji, stan pusty i ręczne wyszukiwanie obszaru bez błędów konsoli. Zgody GPS na fizycznym urządzeniu nie przetestowano.

## Aktualizacja: importy rzeczywistych danych

Szczegółowe raporty: [importy](real-data-integration.md) oraz [pochodzenie urzędowe i ocena urządzeń](official-source-verification.md). W development zapisano 18 070 rzeczywistych rekordów AED bez potwierdzonej oceny urządzenia oraz oryginały z trzech kanałów. Aktualnie przeszły 33 sprawdzenia jednostkowe i integracyjne. Harmonogram sprawdza źródła co 24 h podczas pracy API; uśpiony autoscaling wymaga dodatkowej konfiguracji wyzwalania.

Nie wykonano pełnego logowania Google, pełnych testów end-to-end ani audytu dostępności. Nie należy przedstawiać tych sprawdzeń jako dowodu ukończenia wszystkich wymagań konkursowych.

## Aktualizacja: tylko demonstracyjne logowanie, bez fikcyjnych AED

Na wyraźne życzenie użytkownika zniesiono izolację kont demonstracyjnych od rzeczywistych danych, również dla publikowanej aplikacji. Ostrzeżono, że publiczny wybór ADMIN umożliwi trwałe zmiany; użytkownik zaakceptował ten zakres. Nie oznacza to uprawnienia do fikcyjnego potwierdzania sprawności.

W development usunięto 9 fikcyjnych AED, ich oryginały i 3 stare atrapy źródeł; zachowano 18 070 rzeczywistych rekordów. Usunięto generator danych przykładowych. Idempotentne czyszczenie przy uruchomieniu API obejmie także pozostałości w produkcji po publikacji. Konta i techniczny kontekst organizacji dostawcy pozostają wyłącznie dla logowania.

Nowy przebieg testu integracyjnego zakończył się 10 poprawnymi wynikami runnera, obejmując dostęp demo ADMIN do prawdziwego modelu danych na niepublicznych, tymczasowych rekordach testowych, ograniczenia dostawcy do własnej organizacji i odmowę administracji dla USER. Dane testowe usunięto.

W przeglądarce sprawdzono logowanie i zmianę USER/PROVIDER/ADMIN, pusty panel własnej organizacji bez przykładów, odmowę administracji dla USER, dostęp ADMIN do importów i źródeł, formularz oceny oraz zachowanie roli po przeładowaniu. Nie uruchamiano synchronizacji ani nie zmieniano urządzeń. Pełne renderowanie ogólnopolskiej mapy pozostaje niezweryfikowane: pobranie dużego zbioru wyczerpywało pamięć hosta nagrywającego test i zatrzymywało procesy podglądu. Diagnostyczny widok ograniczony do 500 prawdziwych punktów działał, ale nie jest dowodem działania pełnego zbioru. Limit produkcyjny nie został zmieniony.
