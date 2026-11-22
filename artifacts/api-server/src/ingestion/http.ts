import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_BYTES = 40 * 1024 * 1024;
export const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function publicIp(ip: string): boolean {
  if (isIP(ip) === 6) return /^[23][0-9a-f]{3}:/i.test(ip);
  const p = ip.split(".").map(Number);
  return p.length === 4 && p[0]! > 0 && p[0]! < 224 &&
    ![10, 127].includes(p[0]!) && !(p[0] === 169 && p[1] === 254) &&
    !(p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) &&
    !(p[0] === 192 && (p[1] === 168 || p[1] === 0)) &&
    !(p[0] === 100 && p[1]! >= 64 && p[1]! <= 127) &&
    !(p[0] === 198 && [18, 19].includes(p[1]!));
}

export async function validateDownloadUrl(input: string) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Dozwolone są wyłącznie publiczne zasoby HTTPS.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => !publicIp(a.address))) throw new Error("Zablokowano niepubliczny adres zasobu.");
  return url;
}

export type DownloadOptions={attempts?:number;timeoutMs?:number;bearerToken?:string};
export async function download(input: string,options:DownloadOptions={}): Promise<Buffer> {
  let last: Error = new Error("Nie udało się pobrać zasobu.");
  const attempts=options.attempts??3,origin=new URL(input).origin;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      let url = input;
      for (let redirects = 0; redirects <= 4; redirects++) {
        if(options.bearerToken&&new URL(url).origin!==origin)throw new Error("Zablokowano przekazanie tokenu do innej domeny.");
        await validateDownloadUrl(url);
        const response = await fetch(url, {
          redirect: "manual", signal: AbortSignal.timeout(options.timeoutMs??30000),
          headers: { Accept: "application/json, application/geo+json, text/csv, */*", "User-Agent": "AED-Puls/1.0 (open-data ingestion)",
            ...(options.bearerToken?{Authorization:`Bearer ${options.bearerToken}`}:{}) },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location) throw new Error("Przekierowanie bez adresu.");
          url = new URL(location, url).toString();
          continue;
        }
        if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
        if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) {
          await response.body?.cancel(); throw new Error("Zasób przekracza limit 40 MiB.");
        }
        if (!response.body) throw new Error("Pusta odpowiedź źródła.");
        const reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let bytes = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.length;
            if (bytes > MAX_BYTES) throw new Error("Zasób przekracza limit 40 MiB.");
            chunks.push(Buffer.from(part.value));
          }
        } finally { await reader.cancel().catch(() => {}); }
        return Buffer.concat(chunks);
      }
      throw new Error("Za wiele przekierowań.");
    } catch (e) {
      // Do not put arbitrary provider response bodies or URLs with query tokens in logs.
      const cause=(e as {cause?:{code?:string}})?.cause?.code;
      last = new Error((e as Error)?.name==="TimeoutError"||cause==="UND_ERR_CONNECT_TIMEOUT"
        ? `Przekroczono czas połączenia lub pobierania (${options.timeoutMs??30000} ms).`
        : cause?`Błąd połączenia: ${cause}.`:e instanceof Error?e.message:"Błąd pobierania.");
      if (attempt < attempts-1) await pause(500 * 2 ** attempt);
    }
  }
  throw last;
}

export async function downloadJson(url: string,options:DownloadOptions={}): Promise<Record<string, any>> {
  const raw = await download(url,options);
  let result:unknown;
  try{result=JSON.parse(raw.toString("utf8"));}catch{throw new Error("Odpowiedź źródła nie jest poprawnym JSON. Treści odpowiedzi nie zapisano w komunikacie.");}
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Nieprawidłowy dokument JSON.");
  return result as Record<string, any>;
}
