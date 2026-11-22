# Niepotwierdzone kontrakty MCOD

Nie wykonywano teraz HTTP do MCOD. Nie ma lokalnie pełnego, aktualnego OpenAPI z request/response schemas. **„Niepotwierdzone” nie oznacza „na pewno nie istnieje na serwerze”.**

## Ścieżki widziane wcześniej, ale bez pełnego lokalnego kontraktu

Względem `/api`:

| Metoda | Ścieżka |
|---|---|
| GET | `/integrations/aed/v1/institutions` |
| GET, POST | `/integrations/aed/v1/organizations/{org}/datasets` |
| GET, PATCH | `/integrations/aed/v1/organizations/{org}/datasets/{dataset}` |
| POST | `/integrations/aed/v1/organizations/{org}/datasets/{dataset}/publish` |
| POST | `/integrations/aed/v1/organizations/{org}/datasets/{dataset}/resources` |
| GET, PUT | `/integrations/aed/v1/organizations/{org}/resources/{resource}` |
| POST | `/integrations/aed/v1/organizations/{org}/resources/{resource}/publish` |
| GET, POST | `/integrations/aed/v1/aggregate` |

Ta lista nie potwierdza body, pól odpowiedzi, praw zapisu, paginacji, formatów plików ani obecnego stanu wdrożenia. Nie została użyta do wymyślenia działającego adaptera.

## Czego konkretnie brakuje do aktywacji

1. **Tworzenie instytucji**: zatwierdzona metoda/ścieżka, wymagane pola, sposób autoryzacji przedstawiciela, odpowiedź z rzeczywistym ID. W dostępnej wcześniejszej liście nie widziano POST instytucji. Nie wolno wywnioskować go z GET.
2. **Pojedyncza instytucja**: potwierdzona operacja odczytu po ID albo udokumentowany bezpieczny sposób zweryfikowania wybranego ID z pełnej listy.
3. **Paginacja instytucji/zbiorów/zasobów**: nazwy parametrów, maksymalny rozmiar strony, struktura wyniku, znaczenie końca kolekcji i ewentualne filtry AED.
4. **Lista zasobów zbioru**: osobny endpoint lub opis relacji zawierającej pełną, stronicowaną listę. Istnienie GET pojedynczego zasobu tego nie potwierdza.
5. **Zbiory**: pełne schematy tworzenia/aktualizacji/publikacji, powiązanie z instytucją, draft/public i zakres uprawnień.
6. **Upload CSV/GeoJSON**: czy to multipart, body pliku czy URL; nazwy pól, limity, kodowanie, aktualizacja pełnego zasobu i odpowiedź ze zweryfikowanymi ID.
7. **Download**: zatwierdzona ścieżka, autoryzacja, Content-Type, kodowanie i dostępność opublikowanego pliku bez przekierowań do innego hosta.
8. **Potwierdzenie publikacji**: rzeczywiste pola stanu i daty, rozróżnienie „przyjęto zadanie” od „opublikowano”, opóźnienia widoczności.
9. **Idempotencja i uzgadnianie po awarii**: wspierany klucz/nagłówek, zakres unikalności, odpowiedź na powtórzenie, wyszukiwanie istniejącej operacji po kluczu, semantyka błędów i bezpieczne wznowienie.
10. **Licencje i pochodzenie**: deklaracje wydawcy oraz źródłowe dowody; obsługa per rekord/per pole, pochodnych baz i ODbL. Dla mieszanego pliku nie można samodzielnie wybrać jednej wspólnej licencji.
11. **Własność**: czy zwracane ID instytucji, zbioru i zasobu są niepodważalnie powiązane z reprezentowaną organizacją; nie wystarcza znany identyfikator z publicznej listy.

Wewnętrzne DTO w `contracts.ts` są interfejsem aplikacji, **nie skopiowanym OpenAPI MCOD**. Wszystkie wiązania zdalne są puste i kończą się jawnym błędem przed transportem. Interfejs pokazuje blokadę nawet po ręcznym włączeniu flag, dopóki kontrakty nie zostaną rzeczywiście zatwierdzone.
