import assert from "node:assert/strict";
import { test } from "node:test";
import { createMcodClient, McodError } from "../src/integrations/mcod/client";

// Synthetic unit-test documents only. No test contacts an external service.
const baseUrl = "https://mcod-backend-danegovpl.replit.app/api";
const env = { MCOD_API_BASE_URL: baseUrl, MCOD_API_ENABLED: "true", AED_INTEGRATION_SECRET: "unit-test-placeholder" };
const fixture = `openapi: 3.1.0
paths:
  /institutions:
    get:
      operationId: listInstitutions
  /datasets:
    post:
      operationId: createDataset
servers:
  - url: https://untrusted.invalid
`;
const errorCode = (code: string) => (error: unknown) => error instanceof McodError && error.code === code;
const neverNetwork: typeof fetch = async () => { throw new Error("Unexpected transport call"); };

test("status and constructor never call transport or expose secret; defaults are offline", async () => {
  let calls = 0;
  const client = createMcodClient({ AED_INTEGRATION_SECRET: env.AED_INTEGRATION_SECRET }, async () => { calls++; throw new Error(); });
  assert.deepEqual(client.status(), {
    baseUrl, enabled: false, secretConfigured: true, connectionStatus: "NOT_CHECKED",
    contractStatus: "NOT_VERIFIED", writesEnabled: false, automaticSyncEnabled: false,syncEnabled:false,
  });
  assert.ok(!JSON.stringify(client.status()).includes(env.AED_INTEGRATION_SECRET));
  await assert.rejects(client.inspectContract(), errorCode("MCOD_DISABLED"));
  assert.equal(calls, 0);
});

test("explicitly false and near-true values cannot activate transport", async () => {
  for (const value of ["false", "TRUE", "1", "", undefined]) {
    const client = createMcodClient({ ...env, MCOD_API_ENABLED: value,MCOD_INTEGRATION_ENABLED:"true" }, neverNetwork);
    await assert.rejects(client.inspectContract(), errorCode("MCOD_DISABLED"));
  }
});

test("missing secret prevents even enabled network requests", async () => {
  await assert.rejects(createMcodClient({ ...env, AED_INTEGRATION_SECRET: undefined }, neverNetwork).inspectContract(), errorCode("MCOD_SECRET_MISSING"));
});

test("configuration rejects foreign hosts, credentials and dangerous URL components", async () => {
  for (const url of ["http://mcod-backend-danegovpl.replit.app/api", "https://untrusted.invalid/api",
    `${baseUrl}?token=x`, `${baseUrl}#x`, `${baseUrl}/../other`, `${baseUrl}:5000`,
    "https://name:password@mcod-backend-danegovpl.replit.app/api"]) {
    await assert.rejects(createMcodClient({ ...env, MCOD_API_BASE_URL: url }, neverNetwork).inspectContract(), errorCode("MCOD_CONFIG_INVALID"));
  }
});

test("manual inspection uses only GET and Bearer, with manual redirect policy", async () => {
  let calls = 0;
  const client = createMcodClient(env, async (input, init) => {
    calls++;
    assert.equal(input, `${baseUrl}/integrations/aed/openapi.yaml`);
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "manual");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${env.AED_INTEGRATION_SECRET}`);
    return new Response(fixture, { headers: { "content-type": "application/yaml" } });
  });
  const result = await client.inspectContract();
  assert.equal(calls, 1); // Remote servers and references are not contacted.
  assert.deepEqual(result.operations.map(o => `${o.method} ${o.path}`), ["GET /institutions", "POST /datasets"]);
  assert.equal(result.permissionsVerified, false);
  assert.equal(result.writesEnabled, false);
  assert.ok(!result.operations.some(o => o.method === "POST" && o.path === "/institutions"));
  assert.equal(client.status().connectionStatus, "NOT_CHECKED"); // No invented persisted success.
});

test("redirect is rejected, never followed", async () => {
  let calls = 0;
  const client = createMcodClient(env, async () => { calls++; return new Response(null, { status: 307, headers: { location: "https://untrusted.invalid" } }); });
  await assert.rejects(client.inspectContract(), errorCode("MCOD_REDIRECT_BLOCKED"));
  assert.equal(calls, 1);
});

test("HTTP failures, HTML, malformed documents and oversized responses fail explicitly", async () => {
  const cases: Array<[() => Response, string]> = [
    [() => new Response("sensitive-remote-body", { status: 401 }), "MCOD_HTTP_ERROR"],
    [() => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }), "MCOD_NOT_OPENAPI"],
    [() => new Response("bad: [yaml"), "MCOD_CONTRACT_INVALID"],
    [() => new Response('{"openapi":"3.1.0","paths":[]}'), "MCOD_CONTRACT_INVALID"],
    [() => new Response("x".repeat(1024 * 1024 + 1)), "MCOD_CONTRACT_TOO_LARGE"],
  ];
  for (const [response, code] of cases) {
    await assert.rejects(createMcodClient(env, async () => response()).inspectContract(), (error) => {
      assert.ok(error instanceof McodError);
      assert.equal(error.code, code);
      assert.ok(!error.message.includes("sensitive-remote-body"));
      return true;
    });
  }
});

test("raw transport errors are sanitized and not retried", async () => {
  let calls = 0;
  const client = createMcodClient(env, async () => { calls++; throw new Error(env.AED_INTEGRATION_SECRET); });
  await assert.rejects(client.inspectContract(), (error) => {
    assert.ok(error instanceof McodError);
    assert.equal(error.code, "MCOD_CONNECTION_FAILED");
    assert.ok(!error.message.includes(env.AED_INTEGRATION_SECRET));
    return true;
  });
  assert.equal(calls, 1);
});
