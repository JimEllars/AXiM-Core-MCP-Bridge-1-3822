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

const context = {} as ExecutionContext;

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

async function post(body: unknown, env = baseEnv, headers: Record<string, string> = {}) {
  mockPassport();
  return worker.fetch(makeRequest(body, headers), env, context);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AXiM Core MCP bridge', () => {
  it('rejects invalid Cloudflare Access credentials', async () => {
    const response = await post(
      {jsonrpc: '2.0', method: 'ping', id: 1},
      baseEnv,
      {'CF-Access-Client-Secret': 'wrong'}
    );

    expect(response.status).toBe(403);
  });

  it('rejects missing Passport bearer sessions', async () => {
    const response = await post(
      {jsonrpc: '2.0', method: 'ping', id: 1},
      baseEnv,
      {Authorization: ''}
    );

    expect(response.status).toBe(401);
  });

  it('rejects identities outside the operator allowlist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(
        JSON.stringify({active: true, email: 'unauthorized@example.test'}),
        {status: 200}
      ))
    );

    const response = await worker.fetch(
      makeRequest({jsonrpc: '2.0', method: 'ping', id: 1}),
      baseEnv,
      context
    );

    expect(response.status).toBe(403);
  });

  it('rejects Passport verification URLs without HTTPS in production', async () => {
    const response = await post(
      {jsonrpc: '2.0', method: 'ping', id: 1},
      {...baseEnv, ENVIRONMENT: 'production', PASSPORT_VERIFY_URL: 'http://passport.example.test'}
    );

    expect(response.status).toBe(503);
  });

  it('advertises only local, non-database tools', async () => {
    const response = await post({jsonrpc: '2.0', method: 'tools/list', id: 1});
    const body = await response.json() as {result: {tools: Array<{name: string}>}};

    expect(response.status).toBe(200);
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      'bridge_runtime_status',
      'bridge_security_check',
      'sanitizer_self_test'
    ]);
  });

  it('returns MCP initialization metadata and responds to ping', async () => {
    const init = await post({jsonrpc: '2.0', method: 'initialize', id: 2});
    const ping = await post({jsonrpc: '2.0', method: 'ping', id: 3});

    expect(init.headers.get('MCP-Protocol-Version')).toBe('2024-11-05');
    expect(await ping.json()).toMatchObject({jsonrpc: '2.0', result: {}, id: 3});
  });

  it('accepts notifications without a JSON-RPC response body', async () => {
    const response = await post({jsonrpc: '2.0', method: 'notifications/initialized'});

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('blocks requests when the emergency kill switch is active', async () => {
    const kv = makeKv({OPERATOR_DOCK_SUSPENDED: 'true'});
    const response = await post(
      {jsonrpc: '2.0', method: 'ping', id: 1},
      {...baseEnv, LAB_STATE: kv}
    );

    expect(response.status).toBe(503);
  });

  it('fails closed in production when the kill-switch binding is absent', async () => {
    const response = await post(
      {jsonrpc: '2.0', method: 'ping', id: 1},
      {...baseEnv, ENVIRONMENT: 'production'}
    );

    expect(response.status).toBe(503);
  });

  it('returns tool results and applies configured rate limits', async () => {
    const kv = makeKv();
    const env = {...baseEnv, RATE_LIMIT_PER_HOUR: '1', LAB_STATE: kv};
    const requestBody = {
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 1,
      params: {name: 'sanitizer_self_test', arguments: {}}
    };

    expect((await post(requestBody, env)).status).toBe(200);
    expect((await post({...requestBody, id: 2}, env)).status).toBe(429);
  });

  it('requires empty objects for tool arguments', async () => {
    const response = await post({
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 1,
      params: {name: 'sanitizer_self_test', arguments: {unexpected: true}}
    });
    const body = await response.json() as {error: {code: number}};

    expect(body.error.code).toBe(-32602);
  });

  it('rejects requests from origins that are not allowlisted', async () => {
    const response = await post(
      {jsonrpc: '2.0', method: 'ping', id: 1},
      baseEnv,
      {Origin: 'https://malicious.example'}
    );

    expect(response.status).toBe(403);
  });

  it('redacts credentials, personal data, and internal connection details', () => {
    const result = sanitizeEgressPayload({
      token: 'eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop',
      api_key: 'example-sensitive-value',
      email: 'customer@example.com',
      github: 'ghp_abcdefghijklmnopqrstuvwxyz123456',
      connection: 'postgres://operator:private-password@db.internal:5432/core',
      phone: '+1 (555) 123-4567',
      note: 'Use Bearer abcdefghijklmnopqrstuvwxyz1234'
    }) as Record<string, string>;

    expect(result.token).toBe('[REDACTED_JWT]');
    expect(result.api_key).toBe('[REDACTED]');
    expect(result.email).toBe('[REDACTED]');
    expect(result.github).toBe('[REDACTED_SECRET]');
    expect(result.connection).toBe('[REDACTED_CONNECTION_STRING]');
    expect(result.phone).toBe('[REDACTED]');
    expect(result.note).toBe('Use Bearer [REDACTED_TOKEN]');
  });
});
