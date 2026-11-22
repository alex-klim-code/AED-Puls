# Pochodzenie urzędowe a ocena AED — raport implementacji 2026-11-21

## Rzeczywisty wynik

| Kanał | Oryginalne rekordy | AED w bazie | Wstrzymane punkty | Kategoria pochodzenia |
| --- | ---: | ---: | ---: | --- |
| OpenAEDMap / OSM | 18 297 | 18 007 | 290 | COMMUNITY_OPEN_DATA |
| Otwarte Dane Przemyśl | 21 | 21 | 0 | OFFICIAL_LOCAL_GOVERNMENT |
| dane.gov.pl | 50 | 42 | 8 | OFFICIAL_GOV_PL |
| Razem | 18 368 | 18 070 | 298 | |

To liczby rekordów, nie potwierdzona liczba unikalnych urządzeń. W bazie jest **81 oczekujących par potencjalnych duplikatów**. Nie scalono ich automatycznie. Oficjalnych rekordów dane.gov.pl z poprawną geometrią jest **42** (21 Krosna i 21 Przemyśla). Osiem pozostałych obserwacji katalogowych Marków ma nierozpoznane współrzędne w zagnieżdżonym formacie tabeli i nie tworzy punktów mapy.

290 punktów krajowych wstrzymano ze względu na uproszczoną kontrolę granic, nie dowiedziono ich nieprawidłowości. Oryginały zachowano. Ponowne uruchomienie importu miejskiego przetworzyło 21 rekordów bez utworzenia nowych lub zmiany istniejących danych; aktualizowane są daty synchronizacji.

## Jak ustalono pochodzenie

- **OpenAEDMap**: krajowy GeoJSON i identyfikatory OSM. ODbL-1.0 i atrybucja współtwórców pozostają zachowane. Dane są społecznościowe także wtedy, gdy dotyczą budynku urzędu.
- **Przemyśl**: metadane miejskiego zasobu 15 i zbioru 13 wskazują wydawcę „Straż Miejska w Przemyślu”, identyfikator `PRZ-DEFIBRYLATOR` i CC-BY-4.0. Zweryfikowano odnośnik `source_url` względem dystrybucji rzeczywistego zbioru 4581 w oficjalnym API dane.gov.pl. Instytucja 145 jest Urzędem Miejskim w Przemyślu, typu `local`, z witryną miejską. To niezależne potwierdzenie powiązania zbioru i dystrybucji, nie klasyfikacja na podstawie nazwy domeny. ID urzędu nie jest przypisywane jako własny identyfikator Straży Miejskiej.
- **dane.gov.pl**: konektor sprawdza oficjalny adres API, typy i identyfikatory zbioru, zasobu oraz instytucji i ich wzajemne relacje. Zapisuje dowód powiązania. Sam tytuł, fraza „gov” w URL ani deklaracja formularza nie nadają statusu urzędowego.
- **Zgłoszenia**: kategorię USER_SUBMISSION albo ORGANIZATION_SUBMISSION nadaje serwer według zalogowanego zgłaszającego, nie pole wybrane przez użytkownika.
- Gdy nie można potwierdzić powiązania urzędowego źródła miejskiego, import nie udaje potwierdzenia: zapisuje UNKNOWN i ostrzeżenie.

Dowody klasyfikacji są dostępne w szczegółach rekordu; zawierają identyfikatory i rzeczywiste adresy metadanych. Wiedza pomocnicza `dane.gov.pl/pl/knowledgebase/useful-materials` oraz `dane.gov.pl/source-code/` nie jest traktowana jako zbiór AED.

## Trzy niezależne informacje

1. `sourceCategory` / `officialProvenance`: jedna z sześciu kategorii pochodzenia.
2. `recordVerificationStatus`: UNVERIFIED, DISPUTED, VERIFIED_BY_OPERATOR lub VERIFIED_BY_AUTHORIZED_REVIEWER. Oddzielne `verifiedAt` i `verificationEvidence` przechowują dowód oraz datę oceny urządzenia.
3. Publiczne `operationalStatus`: UNKNOWN, OPERATIONAL lub OUT_OF_SERVICE, oparte na zapisanej ocenie, nie na sukcesie importu.

Istniejące `verificationStatus` pozostaje stanem **moderacji opisu** dla kompatybilności zgłoszeń i eksportów. W interfejsie zatwierdzenie jest oznaczone „Opis zatwierdzony”, nie „AED zweryfikowany”. Stara data `lastVerifiedAt` opisuje kontrolę źródłową/redakcyjną, nie nową datę oceny urządzenia.

Import nie ustawia potwierdzonej sprawności ani weryfikacji urządzenia. Dowód i data są wymagane przy zapisaniu uprawnionej oceny. Operator może oceniać tylko urządzenia własnej organizacji; ADMIN może zapisać kategorię uprawnionego recenzenta. Rola nie jest nadawana przez ten formularz. Demo nie może zmienić rzeczywistych urządzeń.

Ręczne przyjęcie zmiany atrybutu unieważnia wcześniejszą ocenę urządzenia, pozostawiając dowód z adnotacją o unieważnieniu i ślad audytu. Zapis oceny urządzenia nie zatwierdza automatycznie opisu do publikacji.

## Synchronizacja i źródło awaryjne

Przy błędzie lub pustym eksporcie OpenAEDMap używany jest `https://aed.openstreetmap.org.pl/aed_poland.geojson`. Zachowane są identyfikatory, jedna tożsamość źródła społecznościowego i ODbL. Sprawdzono rzeczywistą dostępność obu plików HTTP 200; przełączenie awaryjne sprawdzono automatycznie z kontrolowanym błędem źródła podstawowego — nie symulowano awarii publicznego serwisu.

Zachowano blokady importów, ponawianie, timeouty, historię i harmonogram 24 h podczas pracy API. Nie usuwamy rekordów z powodu awarii. Uśpiony autoscaling nadal wymaga odrębnej konfiguracji gwarantowanego wyzwalania; nie udajemy, że timer uruchamia wyłączony proces.

## Faktyczne błędy bieżącego importu

dane.gov.pl ma status **partial**, nie pełny sukces:

- Zasób 62095 (CSV Przemyśla): `Invalid Opening Quote: a quote is found on field "geometry" at line 2, value is "{"`. GeoJSON/JSON tego samego zbioru odczytano.
- Zasób 2512040 (JSON Warszawy): `fetch failed`. Metadane wskazują witrynę katalogową zamiast bezpośredniej dystrybucji JSON.
- Marki: osiem oryginałów bez poprawnie rozpoznanych współrzędnych. Nie naprawiono osi na podstawie przypuszczenia i nie opublikowano zastępczych punktów.

## Licencje i kontrola

Bezpośredni Przemyśl wskazuje CC-BY-4.0, a jego dystrybucja w dane.gov.pl — CC0-1.0. Zachowano oba odczyty i dowody. Nie przenosimy treści między tymi licencjami automatycznie. Eksport nie zawiera rekordów z nierozstrzygniętym konfliktem licencji ani połączonych pochodzeń o różnych licencjach. Nie opublikowano wspólnego zbioru ani nie użyto urzędowych znaków jako potwierdzenia AED Puls.

Przeszło **33 sprawdzenia automatyczne**: 23 testy parserów, geometrii, OSM, pochodzenia i awaryjnego pobierania oraz test integracyjny z 9 podtestami (10 wyników runnera). Obejmują m.in. zapis i unieważnienie oceny, daty, role operatora/administratora, CSRF, oryginały, audyt, licencje i blokady importu. Testy zapisów wykonywano na tymczasowych, niepublicznych rekordach, które następnie usunięto. Nie potwierdzają rzeczywistej sprawności żadnego importowanego AED.

Późniejsza, zaakceptowana przez użytkownika zmiana pozostawiła wyłącznie demonstracyjne logowanie, bez fikcyjnego zbioru AED. Ten sam test integracyjny ponownie przeszedł 10 wyników runnera po zmianie oczekiwań: demo ma normalne uprawnienia swojej roli na rzeczywistych danych, a własność, CSRF i ograniczenia ról nadal obowiązują.
