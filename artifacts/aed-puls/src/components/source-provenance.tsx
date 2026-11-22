export const sourceCategoryLabel: Record<string, string> = {
  OFFICIAL_GOV_PL: 'Oficjalne źródło danych',
  OFFICIAL_LOCAL_GOVERNMENT: 'Źródło urzędowe — dane miejskie',
  COMMUNITY_OPEN_DATA: 'Dane społecznościowe',
  ORGANIZATION_SUBMISSION: 'Zgłoszenie organizacji — niezweryfikowane',
  USER_SUBMISSION: 'Zgłoszenie użytkownika — niezweryfikowane',
  UNKNOWN: 'Pochodzenie niepotwierdzone',
};
export const deviceVerificationLabel: Record<string, string> = {
  UNVERIFIED: 'Urządzenie — brak potwierdzonej weryfikacji',
  DISPUTED: 'Urządzenie — informacje sporne',
  VERIFIED_BY_OPERATOR: 'Weryfikacja zadeklarowana przez operatora',
  VERIFIED_BY_AUTHORIZED_REVIEWER: 'Weryfikacja uprawnionego recenzenta',
};
export const operationalLabel: Record<string, string> = {
  UNKNOWN: 'Nieznany — brak dowodu sprawności',
  OPERATIONAL: 'Sprawny według załączonego dowodu',
  OUT_OF_SERVICE: 'Wyłączony z użycia według dowodu',
};
export function SourceIndicator({ category }: { category?: string }) {
  const title = category === 'OFFICIAL_GOV_PL' ? 'Źródło: dane.gov.pl' : category === 'COMMUNITY_OPEN_DATA' ? 'Źródło: OpenStreetMap' : null;
  return <div className="my-2 text-xs" data-testid={`source-category-${category ?? 'UNKNOWN'}`}>
    {title && <p className="font-semibold">{title}</p>}
    <span className="inline-block rounded border bg-slate-50 px-2 py-1 text-slate-700">{sourceCategoryLabel[category ?? 'UNKNOWN'] ?? sourceCategoryLabel.UNKNOWN}</span>
  </div>;
}
export function ProvenanceExplanation() {
  return <p className="rounded-lg border bg-muted p-3 text-xs text-muted-foreground">Urzędowe pochodzenie oznacza potwierdzone źródło danych, nie fizyczną kontrolę AED. Weryfikacja urządzenia i jego sprawność są oceniane oddzielnie na podstawie dowodu oraz daty. Źródła urzędowe nie oznaczają poparcia AED Puls przez administrację.</p>;
}
