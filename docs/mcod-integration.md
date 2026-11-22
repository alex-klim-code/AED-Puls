# MCOD — przygotowanie bez połączenia

> **Dokument historyczny pierwszego etapu transportu.** Aktualny zakres, trzy niezależne blokady i instrukcja aktywacji są w [MCOD_INTEGRATION.md](MCOD_INTEGRATION.md). Braki kontraktów opisuje [MCOD_MISSING_ENDPOINTS.md](MCOD_MISSING_ENDPOINTS.md). Poniższy opis nie jest instrukcją aktywacji bieżącej wersji.

## Bieżący zakres

- Usługa wskazana przez użytkownika: `https://mcod-backend-danegovpl.replit.app`.
- Bazowy adres API: `https://mcod-backend-danegovpl.replit.app/api`.
- `MCOD_INTEGRATION_ENABLED=false`: integracja wyłączona. Brak żądań przy starcie, harmonogramu, synchronizacji i publikacji.
- `AED_INTEGRATION_SECRET`: istniejący sekret, odczytywany wyłącznie przez backend. Nie umieszczać go w zmiennych `VITE_*`, frontendzie, URL ani logach.
- Nie sprawdzono jeszcze domeny, autoryzacji ani specyfikacji. Nie ma potwierdzenia działania zdalnego API.

## Lokalne endpointy AED Puls

- `GET /api/admin/mcod/status` — ADMIN, lokalna konfiguracja bez połączenia z MCOD i bez wartości sekretu. `NOT_CHECKED` / `NOT_VERIFIED` są stanem konserwatywnym; nie są zapisem ostatniego testu.
- `POST /api/admin/mcod/contract` — ADMIN + istniejąca sesja i CSRF; przy wyłączonej integracji zwraca HTTP 503 **przed wywołaniem transportu**.
- Po świadomym włączeniu integracji druga operacja może wyłącznie pobrać `/api/integrations/aed/openapi.yaml`. Ścieżka pochodzi z instrukcji użytkownika i wymaga potwierdzenia po udostępnieniu serwera.
- Włącznik nie zezwala na zapis. Klient nie zawiera publikacji, tworzenia instytucji ani importowania AED.

## Zabezpieczenia transportu

Tylko wskazana domena HTTPS, Bearer po stronie backendu, brak przekierowań i retry, limit 12 sekund oraz 1 MiB odpowiedzi. Brak przekazywania zdalnych treści i błędów mogących zawierać dane poufne. Lista operacji pochodzi z pobranego dokumentu; kod nie zakłada istnienia POST na podstawie GET ani nie pobiera zewnętrznych `$ref` / `servers`.

## Kolejny etap — dopiero po zgodzie na połączenia

1. Ręcznie ustawić `MCOD_INTEGRATION_ENABLED=true` i zrestartować backend. Nie włączać automatycznie według daty.
2. Wywołać ręczną inspekcję kontraktu. Sam odczyt dokumentu nie potwierdza uprawnień Bearera do danych czy zapisów.
3. Sprawdzić w rzeczywistym kontrakcie operacje instytucji, zbiorów, zasobów, przesyłania plików, aktualizacji, publikacji i odczytu publicznego; dopasować modele oraz stronicowanie.
4. Zweryfikować odczyty i autoryzację; dopiero potem implementować wspierane operacje, a braki udokumentować dla Agenta MCOD. Nie modyfikować MCOD.
5. Następnie dodać powiązania instytucji, historię synchronizacji, kontrolę własności, idempotencję publikacji, ochronę przed pętlami, kontrolę licencji i publicznej widoczności.
6. Testy nie mogą publikować fikcyjnych urządzeń jako rzeczywistych AED. Zatwierdzenie redakcyjne nie oznacza potwierdzenia fizycznej sprawności.

Przygotowanie transportu nie jest ukończoną dwukierunkową integracją. Dane i wcześniejsze integracje AED Puls pozostają niezmienione.
