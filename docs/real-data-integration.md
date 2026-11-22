# Rzeczywiste źródła AED — wynik uruchomienia 2026-11-21

## Zweryfikowane połączenia i licencje

1. OpenAEDMap: `https://openaedmap.org/api/v1/countries/PL.geojson`. Dane OpenStreetMap, ODbL-1.0, atrybucja współtwórców OSM, zachowany typ i identyfikator obiektu oraz wszystkie właściwości GeoJSON.
2. Przemyśl: `https://dane.przemysl.eu/wp-json/sod/v1/resources/15/data?format=geojson`. Zasób 15, zbiór 13. Metadane `/resources/15` oraz `/datasets/13` wskazują Straż Miejską w Przemyślu i CC-BY-4.0. Nie przypisano domyślnej CC0.
3. dane.gov.pl: oficjalna dokumentacja `https://api.dane.gov.pl/doc` wskazuje specyfikację `https://api.dane.gov.pl/spec/1.4`. Konektor używa `/1.4/datasets`, `/datasets/{id}`, `/datasets/{id}/resources` i `/institutions/{id}`, wyszukując cztery hasła związane z AED. Odczytuje metadane, wydawcę, licencję i rzeczywisty adres dystrybucji. Nie wymyśla alternatywnych endpointów.

## Faktyczny wynik w bazie development

| Kanał | Oryginalne obserwacje | Utworzone rzeczywiste AED |
| --- | ---: | ---: |
| OpenAEDMap Polska | 18 297 | 18 007 |
| Przemyśl bezpośrednio | 21 | 21 |
| dane.gov.pl | 50 | 42 |
| Razem | 18 368 | 18 070 |

To nie jest liczba unikalnych urządzeń w Polsce. Duplikaty między kanałami pozostają kandydatami do ręcznego potwierdzenia. Ponowny import Przemyśla dał 0 nowych i 0 zmienionych rekordów; ponowne importy nie powieliły wcześniej zapisanych identyfikatorów. W dane.gov.pl zaimportowano 21 AED Krosna (CC0-1.0) i 21 Przemyśla (licencja dystrybucji katalogowej CC0-1.0).

**Istotna rozbieżność:** aktualna strona Przemyśla podaje CC-BY-4.0, podczas gdy dystrybucja tego miasta w dane.gov.pl podaje CC0-1.0. Zachowano oba odczyty i oryginalne metadane. Nie nadano wspólnej licencji ani nie scalono automatycznie opisów.

290 rekordów OpenAEDMap znalazło się poza uproszczonym obrysem kraju. Zachowano je jako oryginały z `border_review`, bez publicznego punktu. Część może być poprawnymi lokalizacjami przy granicy — wymagana ręczna ocena, nie założenie błędu źródła.

Wynik dane.gov.pl jest **częściowy**:
- 8 rekordów Marków zachowano bez publicznych punktów; plik publikuje zagnieżdżony w pojedynczej kolumnie CSV i wartości sugerujące zamienione osie. Nie naprawiamy współrzędnych przez domysł.
- CSV Przemyśla ma niepoprawne cytowanie pola `geometry`; dostępne GeoJSON/JSON tego samego zbioru zostały odczytane.
- Zasób Warszawy 2512040 wskazuje adres katalogu zamiast bezpośredniego pliku JSON; pobranie zakończyło się rzeczywistym błędem.
- Alternatywne formaty tego samego wpisu nie tworzą kolejnych AED. Formaty nieobsługiwane, np. JSON-LD, są jawnie odnotowane.

Żaden z tych importów nie potwierdził medycznej sprawności AED. Nie zatwierdzano masowo rekordów ani nie publikowano danych w dane.gov.pl. Rzeczywiste eksporty zatwierdzonych danych pozostają puste do czasu decyzji administratora.

## Sprawdzenia

- 20 testów jednostkowych istniejącej warstwy OSM i nowego importera: geometria, walidacja, nieznane wartości, brak fałszywej weryfikacji, licencje, CSV, GeoJSON/JSON, XLSX, Unicode i blokowanie prywatnych adresów pobierania.
- Test integracyjny z 7 podtestami na tymczasowych, niepublicznych rekordach: porównanie panelu z bazą, połączenie bez utraty oryginałów, powtórna decyzja 409, rozstrzyganie i audyt, zakaz ODbL → CC0, ograniczenia demo/USER/gościa, CSRF i blokada równoległego importu. Dane testowe usunięto po sprawdzeniu.
- Błędy źródeł nie usunęły już zaimportowanych punktów. Oryginały są aktualnymi obserwacjami źródłowymi; historia synchronizacji nie jest pełnym archiwum wszystkich wersji plików.

## Ograniczenia wdrożeniowe

Harmonogram 24 h wymaga działającego procesu API. W uśpionym autoscaling konieczna jest konfiguracja stale działającej instancji lub osobnego wyzwalacza. Próg duplikatów jest konfigurowalny, ale odległość nigdy nie stanowi samodzielnego dowodu wspólnego urządzenia. Nie wykonano pełnego audytu prawnego zgodności łączenia licencji ani certyfikacji technicznej publikacji w dane.gov.pl.
