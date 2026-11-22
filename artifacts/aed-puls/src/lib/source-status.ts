const labels: Record<string, string> = {
  active: 'Aktywne', ok: 'Dostępne', success: 'Pobrano', succeeded: 'Pobrano',
  ready: 'Gotowe', running: 'Aktualizacja', planned: 'Zaplanowane',
  pending: 'Oczekuje', queued: 'W kolejce', partial: 'Dane częściowe',
  unavailable: 'Niedostępne', requires_configuration: 'Wymaga konfiguracji',
  dependent: 'Źródło zależne', failed: 'Błąd pobierania', interrupted: 'Przerwano',
};
export const sourceStatusLabel = (status: string) => labels[status.toLowerCase()] ?? 'Nieznany status';
export const sourceStatusOk = (status: string) => ['active', 'ok', 'success', 'succeeded', 'ready'].includes(status.toLowerCase());
