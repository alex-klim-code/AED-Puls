# Agregacja rzeczywistych źródeł AED

## Stan sprawdzony 21 listopada 2026

| Kanał | Oryginały | Poprawne lokalizacje / centralne AED | Faktyczny stan |
|---|---:|---:|---|
| OpenAEDMap / OSM Polska | 18 297 | 18 007 | Zaimportowano; 290 punktów wstrzymanych przez walidację granic |
| Przemyśl, bezpośredni portal | 21 | 21 | Ponowny rzeczywisty import: 21 pominiętych jako niezmienione, 0 nowych, 0 błędów |
| dane.gov.pl | 50 | 42 | Częściowy import. 21 Przemyśl, 21 Krosno; 8 rekordów Marki bez poprawnej lokalizacji |
| Geoportal GUGiK | 0 | 0 | Dostępny WMS, ale wydawcą danych jest OSM. Obrazy nie są importowane jako nowe AED |
| Warszawa | 0 | 0 | Zweryfikowana pozycja katalogowa; niedostępny działający plik/API z tego środowiska |
| OpenAED.eu | 0 | 0 | Dokumentacja wymienia tylko instancję holenderską i wymagany token. Nie potwierdzono polskiej instancji |

Rejestr: **18 070 centralnych AED**, **18 368 oryginałów**, **0 syntetycznych AED**.
Ocena podobieństwa wskazała **272 pary do przeglądu**; **60 wcześniejszych propozycji** spadło poniżej progu.
**0 rzeczywistych automatycznych scaleń** — nie wymuszamy scalenia dla poprawienia statystyki.
Na tym etapie **0 centralnych AED ma więcej niż jedną publikację lub więcej niż jednego niezależnego wydawcę**.
Są **2 otwarte konflikty pól**. Liczby są stanem z kontroli, a nie stałymi wartościami interfejsu.

Trzy kanały z rekordami nie oznaczają trzech potwierdzeń każdego AED. Przemyśl bezpośrednio i jego dystrybucja w dane.gov.pl mają wspólnego pierwotnego wydawcę. Prawidłowe lokalizacje pochodzą obecnie od trzech rozpoznanych wydawców: OSM, Przemyśl i Krosno. Same metadane urzędowe nie potwierdzają sprawności urządzeń.

Publiczny licznik źródeł obejmuje **wszystkie 6 zarejestrowanych kanałów**, także publikujących wspólne punkty, zależnych i obecnie niedostępnych. Nie jest licznikiem działających importów ani niezależnych wydawców. Przy pojedynczym AED pokazujemy wszystkich faktycznie powiązanych dostawców danych; deduplikacja punktu nie usuwa ich publikacji.

## Rozstrzyganie tożsamości

- Odległość jest wskazówką, nigdy samodzielnym powodem scalenia.
- Porównywane są: współrzędne, adres, nazwa, opis miejsca, operator, fizyczny numer seryjny oraz konflikty godzin, kondygnacji, licencji i deklaracji sprawności.
- Próg przeglądu: domyślnie 70; próg automatyczny: domyślnie 95. Konfiguracja: `AED_REVIEW_SCORE` i `AED_AUTO_MERGE_SCORE`.
- Automatyczne scalenie wymaga jawnego fizycznego identyfikatora i braku silnych konfliktów. OSM ID i ID wpisu katalogowego nie są numerem urządzenia.
- Różne numery seryjne, sporne oceny, sprzeczne godziny lub licencje zatrzymują automatyczne scalenie. Próg punktowy sam nie wystarcza.
- Zgodność identyfikatora może wskazać błędne współrzędne. Bez identyfikatora wspólny budynek nie wyklucza kilku AED.
- Najnowsza udokumentowana ocena ma pierwszeństwo przy automatycznym wyborze rekordu nadrzędnego. Import i scalenie nie nadają klinicznego statusu sprawności.

## Powiązania i historia

Oryginały pozostają przy swoich źródłach i zachowują licencję oraz ID. Mapa pokazuje tylko rekordy nadrzędne. Punkt ma liczniki publikacji i niezależnych wydawców oraz szczegóły atrybutów każdej publikacji.

Kolejny import rozpoznaje `(źródło, ID rekordu)` i nie tworzy nowego AED. Zmieniona obserwacja odkłada poprzednią wersję do historii. Przy konfliktach aktualizowany jest dokument źródłowy, nie zatwierdzony opis centralny.

Każde nowe scalenie ma odwracalny zapis. Administrator cofa późniejsze scalenia przed wcześniejszymi. Cofnięcie nie usuwa późniejszych zmian źródłowych ani ocen urządzenia; konflikty wracają do właściwych punktów. Decyzja o rozdzieleniu blokuje kolejne automatyczne scalenie, również przez pośredni rekord.

Brak rekordu w kompletnym, niepustym i poprawnie pobranym snapshocie oznacza nieobecność obserwacji. Błąd API lub częściowy import tego nie robi. Canonical AED nie jest automatycznie kasowany. Pusty snapshot wymaga wyjaśnienia zamiast masowego oznaczania wszystkich rekordów.

## Synchronizacja i eksporty

Przemyśl obsługuje odnośniki następnej strony i liczbę stron, z wykrywaniem pętli oraz limitem bezpieczeństwa. dane.gov.pl jest przeglądane przez metadane oficjalnego API. Publiczny downloader kontroluje HTTPS, przekierowania, publiczne adresy IP, limit rozmiaru, timeouty i ponowienia.

Ręczna synchronizacja jest w panelu administratora. Harmonogram sprawdza źródła co minutę, import docelowo co 24 godziny, po błędzie z co najmniej godzinną przerwą. **Działa tylko podczas pracy procesu API**; nie jest zewnętrznym harmonogramem wybudzającym uśpione wdrożenie.

Publiczne CSV / JSON / GeoJSON nadal obejmują wyłącznie zatwierdzone rekordy o wyjaśnionej licencji. Nowy eksport **do przeglądu**, dostępny wyłącznie dla ADMIN, może zawierać niezweryfikowane dane. Jest odróżniony nazwą pliku i nagłówkiem; statusy i pochodzenie pozostają w każdym rekordzie.

ODbL, CC BY i CC0 nie są automatycznie zamieniane. Bezpośredni Przemyśl deklaruje CC BY 4.0, a jego dystrybucja katalogowa CC0; różnica pozostaje widoczna i blokuje automatyczne kopiowanie atrybutów. Metadane są projektem publikacji, nie urzędowym potwierdzeniem zgodności ani deklaracją publikacji na dane.gov.pl.

## Niewłączone źródła i wymagania dostępu

- Warszawa: pozycja `https://dane.um.warszawa.pl/pl/catalogue/7bc32ffc-c2ac-4d32-83c9-b6f7a0b38de8`, zasób dane.gov.pl `2512040`. Sam link katalogowy nie jest API rekordów.
- Geoportal: `https://mapy.geoportal.gov.pl/wss/ext/OSM/Defibrylatory`; GUGiK wskazuje pochodzenie z OSM. Nie traktować jako niezależnego potwierdzenia.
- OpenAED.eu: dokumentacja `https://github.com/openaed/api`, instancja wymieniona przez operatora `https://nl.api.openaed.eu`. Token należy uzyskać od operatora; brak potwierdzonego polskiego zakresu. Nie używamy omijania autoryzacji. Nie dodano nieużywanego formularza tokenu ani fikcyjnej integracji.
- dane.gov.pl: błąd jednego formatu CSV Przemyśla i niedostępna dystrybucja Warszawy pozostają błędami; alternatywne poprawnie odczytane formaty nie tworzą duplikatów.

## Sprawdzenie

Testy pokrywają scenariusze z instrukcji, wersjonowanie zmian, ochronę przed błędnym ponownym scaleniem i ostrożne oznaczanie nieobecnych obserwacji. Testowe rekordy są niepubliczne i usuwane po wykonaniu testów; końcowa kontrola nie znalazła pozostałości.

Sprawdzono kompilację frontendu i API, import z rzeczywistego Przemyśla, odpowiedź mapy z 18 070 punktami oraz odmowę anonimowego pobrania eksportu do przeglądu (HTTP 401). Mapa przesyła około 0,98 MB gzip zamiast pełnych dokumentów źródłowych; lista jest doładowywana po 100 pozycji, a szczegóły pobierane po wybraniu punktu.
