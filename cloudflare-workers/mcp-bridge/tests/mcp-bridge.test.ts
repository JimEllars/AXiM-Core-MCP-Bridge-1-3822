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



  it('advertises mcp tools on /mcp', async () => {
    const response = await post({jsonrpc: '2.0', method: 'tools/list', id: 1});
    const body = await response.json() as {result: {tools: Array<{name: string}>}};

    expect(response.status).toBe(200);
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      'bridge_runtime_status',
      'bridge_security_check',
      'sanitizer_self_test',
      'aximDockConfig'
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

  it('establishes SSE connection on /sse', async () => {
    mockPassport();
    const request = new Request('https://mcp.axim.us.com/sse', {
       method: 'GET',
       headers: {
         'Origin': 'https://core.axim.us.com',
         'Authorization': 'Bearer passport-token',
         'CF-Access-Client-Id': 'cf-client-id',
         'CF-Access-Client-Secret': 'cf-client-secret'
       }
    });
    const response = await worker.fetch(request, baseEnv, context);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('rejects unauthenticated requests on /sse', async () => {
    const request = new Request('https://mcp.axim.us.com/sse', {
       method: 'GET',
       headers: {
         'Origin': 'https://core.axim.us.com'
       }
    });
    const response = await worker.fetch(request, baseEnv, context);
    expect([401, 403]).toContain(response.status);
  });

  it('provides config on /dock/config with valid secret', async () => {
    mockPassport();
    const request = new Request('https://mcp.axim.us.com/dock/config', {
       method: 'GET',
       headers: {
          'Origin': 'https://core.axim.us.com',
          'Authorization': 'Bearer passport-token',
          'CF-Access-Client-Id': 'cf-client-id',
          'CF-Access-Client-Secret': 'cf-client-secret'
       }
    });
    const response = await worker.fetch(request, baseEnv, context);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.mcpServers['axim-core-internal'].url).toBe('https://mcp.axim.us.com/sse');
  });

  it('rejects /dock/config with invalid secret', async () => {
    const request = new Request('https://mcp.axim.us.com/dock/config', {
       method: 'GET',
       headers: {
          'Origin': 'https://core.axim.us.com',
          'Authorization': 'Bearer wrong',
          'CF-Access-Client-Id': 'wrong',
          'CF-Access-Client-Secret': 'wrong'
       }
    });
    const response = await worker.fetch(request, baseEnv, context);
    expect([401, 403]).toContain(response.status);
  });

  it('fails closed when OPERATOR_DOCK_SUSPENDED is true on /sse', async () => {
    const envWithKv = { ...baseEnv, LAB_STATE: makeKv({ OPERATOR_DOCK_SUSPENDED: 'true' }) };
    const request = new Request('https://mcp.axim.us.com/sse', {
       method: 'GET',
       headers: {
         'Origin': 'https://core.axim.us.com',
         'Authorization': 'Bearer passport-token',
         'CF-Access-Client-Id': 'cf-client-id',
         'CF-Access-Client-Secret': 'cf-client-secret'
       }
    });
    const response = await worker.fetch(request, envWithKv, context);
    expect(response.status).toBe(503);
  });

  it('fails closed when OPERATOR_DOCK_SUSPENDED is true on /dock/config', async () => {
    const envWithKv = { ...baseEnv, LAB_STATE: makeKv({ OPERATOR_DOCK_SUSPENDED: 'true' }) };
    const request = new Request('https://mcp.axim.us.com/dock/config', {
       method: 'GET',
       headers: {
         'Origin': 'https://core.axim.us.com',
         'Authorization': 'Bearer passport-token',
         'CF-Access-Client-Id': 'cf-client-id',
         'CF-Access-Client-Secret': 'cf-client-secret'
       }
    });
    const response = await worker.fetch(request, envWithKv, context);
    expect(response.status).toBe(503);
  });

  it('fails closed when OPERATOR_DOCK_SUSPENDED is true', async () => {
    const envWithKv = { ...baseEnv, LAB_STATE: makeKv({ OPERATOR_DOCK_SUSPENDED: 'true' }) };
    const response = await post(
       {
         jsonrpc: '2.0',
         method: 'ping',
         id: 1,
         params: {}
       },
       envWithKv,
       {}
    );
    expect(response.status).toBe(503);
  });

  it('fails closed when KV is missing in production', async () => {
    const envProd = { ...baseEnv, ENVIRONMENT: 'production' };
    const response = await post(
       {
         jsonrpc: '2.0',
         method: 'ping',
         id: 1,
         params: {}
       },
       envProd,
       {}
    );
    expect(response.status).toBe(503);
  });




  it('validates MCP initialize handshake on /message', async () => {
    const response = await post(
       {
         jsonrpc: '2.0',
         method: 'initialize',
         id: 1,
         params: {}
       },
       baseEnv,
       {},
       'https://mcp.axim.us.com/message'
    );
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.result.protocolVersion).toBe('2024-11-05');
    expect(body.result.serverInfo.name).toBe('axim-core-bridge');
  });

});
