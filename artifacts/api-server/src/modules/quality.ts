import type { SubmitAedBody } from "@workspace/api-zod";
import type { z } from "zod/v4";

type QualityInput=Pick<z.infer<typeof SubmitAedBody>,"postalCode"|"voivodeship"|"description"|"placement"|"accessibility"|"openingHours"|"sourceUrl"|"license">;
export function assessQuality(data: QualityInput) {
  const issues: string[] = [];
  let score = 100;
  const check = (valid: boolean, points: number, message: string) => {
    if (!valid) { score -= points; issues.push(message); }
  };
  check(!!data.postalCode && /^\d{2}-\d{3}$/.test(data.postalCode), 5, "Brak poprawnego kodu pocztowego.");
  check(!!data.voivodeship, 5, "Nie podano województwa.");
  check(!!data.description, 10, "Brak opisu miejsca urządzenia.");
  check(data.placement !== "unknown", 5, "Nieznane umiejscowienie wewnątrz / na zewnątrz.");
  check(data.accessibility !== "unknown", 20, "Dostępność nie została potwierdzona.");
  check(!!data.openingHours, 10, "Nie podano godzin dostępności.");
  check(!!data.sourceUrl && /^https?:\/\//.test(data.sourceUrl), 15, "Brak odnośnika do oryginalnego źródła.");
  check(!["unknown", "nieznana", "brak"].includes(data.license.toLowerCase()), 15, "Nieustalona licencja — rekord wykluczony z otwartych eksportów.");
  // Verification is an independent evidence criterion, not technical reliability.
  score -= 15;
  issues.push("Rekord wymaga weryfikacji pochodzenia. Ocena nie potwierdza sprawności AED.");
  return { qualityScore: Math.max(0, score), qualityIssues: issues };
}
