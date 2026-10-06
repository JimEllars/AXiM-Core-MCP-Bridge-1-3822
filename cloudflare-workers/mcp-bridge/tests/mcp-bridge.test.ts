import {afterEach, describe, expect, it, vi} from './testHarness';
import worker from '../src/index';
import {sanitizeEgressPayload} from '../src/sanitizer';
import type {Env} from '../src/types';

const baseEnv: Env = {
  ENVIRONMENT: 'test',
  PASSPORT_VERIFY_URL: 'https://passport.example.test/verify',
  CF_ACCESS_CLIENT_ID: 'cf-client-id',
  CF_ACCESS_CLIENT_SECRET: 'cf-client-secret',
  ALLOWED_ORIGINS: 'https://core.axim.us.com'
};

const context = { waitUntil: vi.fn(() => {}) } as unknown as ExecutionContext;

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
  url = 'https://mcp.axim.us.com/mcp'
): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer passport-token',
      'CF-Access-Client-Id': 'cf-client-id',
      'CF-Access-Client-Secret': 'cf-client-secret',
      ...headers
    },
    body: JSON.stringify(body)
  });
}

function mockPassport(email = 'james.ellars@axim.us.com') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({active: true, email}), {status: 200}))
  );
}

function makeKv(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    })
  } as unknown as KVNamespace;
}

async function post(body: unknown, env = baseEnv, headers: Record<string, string> = {}, url = 'https://mcp.axim.us.com/mcp') {
  mockPassport();
  return worker.fetch(makeRequest(body, headers, url), env, context);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AXiM Core MCP bridge', () => {
  it('rejects invalid Cloudflare Access credentials on /mcp', async () => {
    const response = await post(
      {jsonrpc: '2.0', method: 'ping', id: 1},
      baseEnv,
      {'CF-Access-Client-Secret': 'wrong'}
    );

    expect(response.status).toBe(403);
  });

  it('rejects missing Passport bearer sessions on /mcp', async () => {
    const response = await post(
      {jsonrpc: '2.0', method: 'ping', id: 1},
      baseEnv,
      {Authorization: ''}
    );

    expect(response.status).toBe(401);
  });

  it('rejects unauthenticated requests on /v1/marketplace', async () => {
    const response = await post(
      {jsonrpc: '2.0', method: 'ping', id: 1},
      baseEnv,
      {Authorization: ''},
      'https://mcp.axim.us.com/v1/marketplace'
    );
    expect(response.status).toBe(401);
  });

  it('accepts valid requests on /v1/marketplace', async () => {
    const response = await post(
      {jsonrpc: '2.0', method: 'ping', id: 1},
      baseEnv,
      {'X-Axim-Gateway-Token': 'valid'},
      'https://mcp.axim.us.com/v1/marketplace'
    );
    expect(response.status).toBe(200);
  });

  it('advertises mcp tools on /mcp', async () => {
    const response = await post({jsonrpc: '2.0', method: 'tools/list', id: 1});
    const body = await response.json() as {result: {tools: Array<{name: string}>}};

    expect(response.status).toBe(200);
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      'bridge_runtime_status',
      'bridge_security_check',
      'sanitizer_self_test',
      'core_health_check',
      'telemetry_lookup',
      'hitl_queue_status'
    ]);
  });

  it('advertises marketplace tools on /v1/marketplace', async () => {
    const response = await post(
      {jsonrpc: '2.0', method: 'tools/list', id: 1},
      baseEnv,
      {'X-Axim-Gateway-Token': 'valid'},
      'https://mcp.axim.us.com/v1/marketplace'
    );
    const body = await response.json() as {result: {tools: Array<{name: string}>}};

    expect(response.status).toBe(200);
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      'axim_send_invoice'
    ]);
  });

  it('rejects bad arguments format', async () => {
    const response = await post({
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 1,
      params: {name: 'sanitizer_self_test', arguments: ["invalid"]}
    });
    const body = await response.json() as {error: {code: number}};

    expect(body.error.code).toBe(-32602);
  });

});
