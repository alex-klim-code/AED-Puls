import { parseDocument } from "yaml";
import type { McodContractInspection, McodIntegrationStatus } from "@workspace/api-zod";
import { confirmedBindings,operationInputs,operationOutputs,type McodBindings,type OperationName,type OperationInput,type OperationResult } from "./contracts";

// This is a user-supplied external service, not the AED Puls production URL.
const MCOD_ORIGIN = "https://mcod-backend-danegovpl.replit.app";
const DEFAULT_BASE = `${MCOD_ORIGIN}/api`;
const MAX_CONTRACT_BYTES = 1024 * 1024;
type Environment = Record<string, string | undefined>;
type Transport = typeof fetch;

export class McodError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = "McodError";
  }
}
const stop = (code: string, status: number, message: string): never => { throw new McodError(code, status, message); };

function configuration(env: Environment) {
  let url: URL;
  try { url = new URL(env.MCOD_API_BASE_URL || DEFAULT_BASE); }
  catch { return stop("MCOD_CONFIG_INVALID", 503, "Nieprawidłowa konfiguracja adresu MCOD."); }
  // No arbitrary host, query, credentials, port or path can receive the Bearer token.
  if (url.origin !== MCOD_ORIGIN || url.username || url.password || url.search || url.hash ||
      !["", "/", "/api", "/api/"].includes(url.pathname)) {
    return stop("MCOD_CONFIG_INVALID", 503, "MCOD wymaga zatwierdzonej domeny HTTPS i ścieżki /api.");
  }
  return { baseUrl: DEFAULT_BASE, enabled: env.MCOD_API_ENABLED === "true",
    writeEnabled:env.MCOD_WRITE_ENABLED==="true",syncEnabled:env.MCOD_SYNC_ENABLED==="true",secret: env.AED_INTEGRATION_SECRET };
}

/**
 * No constructor/startup I/O. Every remote method checks the global flag.
 * Remote CRUD needs independently reviewed bindings; no scheduler is installed.
 */
export function createMcodClient(env: Environment = process.env, transport: Transport = fetch,bindings:McodBindings=confirmedBindings) {
  const bindingReady=(name:OperationName)=>{
    const binding=bindings[name];
    return !!binding&&/^[a-f0-9]{64}$/.test(binding.evidence.specSha256)&&Number.isFinite(Date.parse(binding.evidence.reviewedAt));
  };
  function assertEnabled(kind:"read"|"write"|"sync"="read"){
    const config=configuration(env);
    if(!config.enabled)return stop("MCOD_DISABLED",503,"Integracja MCOD oczekuje na aktywację.");
    if(kind==="write"&&!config.writeEnabled)return stop("MCOD_WRITE_DISABLED",503,"Publikacja MCOD oczekuje na aktywację.");
    if(kind==="sync"&&!config.syncEnabled)return stop("MCOD_SYNC_DISABLED",503,"Synchronizacja MCOD oczekuje na aktywację.");
    if(!config.secret||/[\r\n]/.test(config.secret))return stop("MCOD_SECRET_MISSING",503,"Brak poprawnej konfiguracji sekretu MCOD.");
    return config;
  }
  async function operation<K extends OperationName>(name:K,input:OperationInput<K>):Promise<OperationResult<K>>{
    const write=/^(create|update|publish)/.test(name),config=assertEnabled(write?"write":"read");
    const data=operationInputs[name].parse(input) as Record<string,unknown>,binding=bindings[name];
    if(!binding||!bindingReady(name))
      return stop("MCOD_CONTRACT_UNCONFIRMED",409,`Operacja ${name} wymaga potwierdzenia pełnego kontraktu MCOD.`);
    const encoded=binding.encode(data),url=new URL(encoded.path,`${config.baseUrl}/`);
    if(url.origin!==MCOD_ORIGIN||url.protocol!=="https:"||url.username||url.password||url.hash||
      !url.pathname.startsWith("/api/integrations/aed/")||
      (write?binding.method==="GET":binding.method!=="GET"))
      return stop("MCOD_CONTRACT_INVALID",409,"Nieprawidłowa ścieżka lub metoda kontraktu MCOD.");
    try{
      const headers=new Headers(encoded.headers);headers.set("Authorization",`Bearer ${config.secret}`);
      headers.set("Accept",name==="downloadResource"?"text/csv, application/geo+json, application/json":"application/json");
      const response=await transport(url.href,{method:binding.method,headers,body:encoded.body,redirect:"manual",signal:AbortSignal.timeout(12000)});
      if(response.status>=300&&response.status<400){await response.body?.cancel();return stop(write?"MCOD_UNKNOWN_OUTCOME":"MCOD_REDIRECT_BLOCKED",502,"MCOD zwrócił niedozwolone przekierowanie.");}
      if(!response.ok){
        await response.body?.cancel();
        return stop(write&&![401,403].includes(response.status)?"MCOD_UNKNOWN_OUTCOME":"MCOD_HTTP_ERROR",502,`MCOD zwrócił HTTP ${response.status}.`);
      }
      const contentType=(response.headers.get("content-type")??"").split(";")[0]!.toLowerCase();
      const textMode=binding.responseMode==="text";
      if((textMode&&(name!=="downloadResource"||!["text/csv","application/csv","text/plain","application/json","application/geo+json","application/octet-stream"].includes(contentType)))||
        (!textMode&&!contentType.includes("json"))){
        await response.body?.cancel();return stop(write?"MCOD_UNKNOWN_OUTCOME":"MCOD_RESPONSE_INVALID",502,"MCOD nie zwrócił oczekiwanych danych JSON.");
      }
      const reader=response.body?.getReader();if(!reader)throw new Error();
      let size=0;const chunks:Uint8Array[]=[];
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
        if(size>42*1024*1024){await reader.cancel();throw new Error();}chunks.push(value);}}
      finally{reader.releaseLock();}
      const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks));
      return operationOutputs[name].parse(binding.decode(textMode?text:JSON.parse(text.replace(/^\uFEFF/,"")),{contentType})) as OperationResult<K>;
    }catch(error){
      if(error instanceof McodError)throw error;
      return stop(write?"MCOD_UNKNOWN_OUTCOME":"MCOD_CONNECTION_FAILED",502,
        write?"Nie potwierdzono wyniku operacji MCOD; nie ponawiaj automatycznie.":"Nie udało się bezpiecznie odczytać danych MCOD.");
    }
  }
  const methods={
    getInstitutions:(input:OperationInput<"getInstitutions">={})=>operation("getInstitutions",input),
    getInstitution:(id:string)=>operation("getInstitution",{id}),
    createInstitution:(data:OperationInput<"createInstitution">)=>operation("createInstitution",data),
    getDatasets:(data:OperationInput<"getDatasets">)=>operation("getDatasets",data),
    createDataset:(data:OperationInput<"createDataset">)=>operation("createDataset",data),
    getResources:(data:OperationInput<"getResources">)=>operation("getResources",data),
    getResource:(id:string,institutionId:string)=>operation("getResource",{id,institutionId}),
    createResource:(data:OperationInput<"createResource">)=>operation("createResource",data),
    updateResource:(id:string,data:Omit<OperationInput<"updateResource">,"id">)=>operation("updateResource",{...data,id}),
    publishResource:(id:string,data:Omit<OperationInput<"publishResource">,"id">)=>operation("publishResource",{...data,id}),
    publishDataset:(id:string,data:Omit<OperationInput<"publishDataset">,"id">)=>operation("publishDataset",{...data,id}),
    downloadResource:(id:string,institutionId:string)=>operation("downloadResource",{id,institutionId}),
    assertEnabled,
    ensureOperations(names:OperationName[],kind:"read"|"write"|"sync"="read"){
      assertEnabled(kind);
      for(const name of names)if(!bindingReady(name))return stop("MCOD_CONTRACT_UNCONFIRMED",409,`Operacja ${name} wymaga potwierdzenia pełnego kontraktu MCOD.`);
    },
    unconfirmedOperations:()=> (Object.keys(operationInputs) as OperationName[]).filter(name=>!bindingReady(name)),
    supportsMixedLicenses:()=>bindings.createResource?.licensing==="per-record"&&bindings.updateResource?.licensing==="per-record",
    async *allPages<K extends "getInstitutions"|"getDatasets"|"getResources">(name:K,input:OperationInput<K>):AsyncGenerator<OperationResult<K>["items"],void,unknown>{
      let page=1;const seen=new Set<number>();
      for(let n=0;n<1000;n++){
        if(seen.has(page))return stop("MCOD_PAGINATION_INVALID",502,"MCOD powtórzył stronę wyników.");
        seen.add(page);
        const result=await operation(name,{...input,page} as OperationInput<K>);yield result.items as OperationResult<K>["items"];
        if(result.nextPage===null)return;page=result.nextPage;
      }
      return stop("MCOD_PAGINATION_LIMIT",502,"Nie potwierdzono kompletności pobrania MCOD.");
    },
  };
  return {
    ...methods,
    async syncAedFromMcod(consume:(resource:OperationResult<"getResources">["items"][number],file:OperationResult<"downloadResource">)=>Promise<void>){
      assertEnabled("sync");
      for await(const institutions of methods.allPages("getInstitutions",{}))for(const institution of institutions){
        for await(const datasets of methods.allPages("getDatasets",{institutionId:institution.id}))for(const dataset of datasets){
          for await(const resources of methods.allPages("getResources",{institutionId:institution.id,datasetId:dataset.id}))for(const resource of resources){
            assertEnabled("sync");
            if(resource.institutionId!==institution.id||resource.datasetId!==dataset.id)return stop("MCOD_IDENTITY_MISMATCH",502,"Niespójne pochodzenie zasobu MCOD.");
            await consume(resource,await methods.downloadResource(resource.id,institution.id));
          }
        }
      }
    },
    status(): McodIntegrationStatus {
      const config = configuration(env);
      return {
        baseUrl: config.baseUrl, enabled: config.enabled, secretConfigured: !!config.secret,
        connectionStatus: "NOT_CHECKED", contractStatus: "NOT_VERIFIED",
        writesEnabled: config.enabled&&config.writeEnabled, automaticSyncEnabled: false,
        syncEnabled:config.enabled&&config.syncEnabled,
      };
    },
    async inspectContract(): Promise<McodContractInspection> {
      const config = assertEnabled();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      let text: string;
      try {
        // Path supplied in the user's integration instructions; not yet verified.
        const response = await transport(`${config.baseUrl}/integrations/aed/openapi.yaml`, {
          method: "GET", redirect: "manual", signal: controller.signal,
          headers: { Authorization: `Bearer ${config.secret}`, Accept: "application/yaml, application/json, text/yaml" },
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          return stop("MCOD_REDIRECT_BLOCKED", 502, "MCOD zwrócił przekierowanie. Nie przekazano sekretu pod inny adres.");
        }
        if (!response.ok) {
          await response.body?.cancel();
          return stop("MCOD_HTTP_ERROR", 502, `Nie udało się pobrać OpenAPI MCOD (HTTP ${response.status}).`);
        }
        const type = (response.headers.get("content-type") || "").toLowerCase();
        if (type.includes("text/html")) {
          await response.body?.cancel();
          return stop("MCOD_NOT_OPENAPI", 502, "MCOD zwrócił stronę HTML zamiast OpenAPI.");
        }
        const reader = response.body?.getReader();
        if (!reader) return stop("MCOD_EMPTY_CONTRACT", 502, "Pusta specyfikacja MCOD.");
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_CONTRACT_BYTES) {
              await reader.cancel();
              return stop("MCOD_CONTRACT_TOO_LARGE", 502, "Specyfikacja MCOD przekracza limit 1 MiB.");
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        text = Buffer.concat(chunks).toString("utf8");
      } catch (error) {
        if (error instanceof McodError) throw error;
        // Never forward raw fetch/parser errors, URLs, headers or remote bodies.
        return stop("MCOD_CONNECTION_FAILED", 502, "Nie udało się bezpiecznie odczytać specyfikacji MCOD.");
      } finally { clearTimeout(timer); }

      try {
        const document = parseDocument(text, { uniqueKeys: true });
        if (document.errors.length) throw new Error("Invalid YAML");
        const spec = document.toJS({ maxAliasCount: 50 }) as Record<string, unknown>;
        if (!spec || typeof spec.openapi !== "string" || !/^3\.\d+\.\d+$/.test(spec.openapi) ||
            !spec.paths || typeof spec.paths !== "object" || Array.isArray(spec.paths)) throw new Error("Invalid OpenAPI");
        const operations: McodContractInspection["operations"] = [];
        for (const [path, item] of Object.entries(spec.paths)) {
          if (!path.startsWith("/") || !item || typeof item !== "object" || Array.isArray(item)) continue;
          for (const [method, operation] of Object.entries(item)) {
            if (!["get", "post", "put", "patch", "delete", "head", "options", "trace"].includes(method) ||
                !operation || typeof operation !== "object" || Array.isArray(operation)) continue;
            const op = operation as Record<string, unknown>;
            operations.push({ path, method: method.toUpperCase(),
              operationId: typeof op.operationId === "string" ? op.operationId : null,
              summary: typeof op.summary === "string" ? op.summary : null });
          }
        }
        // Listing POST in a contract does not prove the token can execute it.
        // Remote servers/$refs are deliberately never followed.
        return { openapiVersion: spec.openapi, operations, permissionsVerified: false, writesEnabled: false };
      } catch {
        return stop("MCOD_CONTRACT_INVALID", 502, "Nieprawidłowa lub nieobsługiwana specyfikacja OpenAPI 3 MCOD.");
      }
    },
  };
}
