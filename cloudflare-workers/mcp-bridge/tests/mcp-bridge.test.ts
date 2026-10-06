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
      'aximCoreQuery',
      'aximCoreDispatch',
      'aximStateSync',
      'aximDockConfig',
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

  it('establishes SSE connection on /sse', async () => {
    const request = new Request('https://mcp.axim.us.com/sse', {
       method: 'GET',
       headers: { 'Origin': 'https://core.axim.us.com' }
    });
    const response = await worker.fetch(request, baseEnv, context);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('provides config on /dock/config with valid secret', async () => {
    const request = new Request('https://mcp.axim.us.com/dock/config', {
       method: 'GET',
       headers: {
          'Origin': 'https://core.axim.us.com',
          'Authorization': 'Bearer cf-client-secret'
       }
    });
    const response = await worker.fetch(request, baseEnv, context);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.mcpServers['axim-core'].url).toBe('https://mcp.axim.us.com/sse');
  });

  it('rejects /dock/config with invalid secret', async () => {
    const request = new Request('https://mcp.axim.us.com/dock/config', {
       method: 'GET',
       headers: {
          'Origin': 'https://core.axim.us.com',
          'Authorization': 'Bearer wrong'
       }
    });
    const response = await worker.fetch(request, baseEnv, context);
    expect(response.status).toBe(401);
  });

  it('handles aximCoreQuery successfully on /message', async () => {
    const response = await post(
       {
         jsonrpc: '2.0',
         method: 'tools/call',
         id: 1,
         params: { name: 'aximCoreQuery', arguments: { table: 'users' } }
       },
       baseEnv,
       {},
       'https://mcp.axim.us.com/message'
    );
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    const content = JSON.parse(body.result.content[0].text);
    expect(content.status).toBe('success');
  });

  it('handles aximCoreDispatch successfully on /message', async () => {
    const response = await post(
       {
         jsonrpc: '2.0',
         method: 'tools/call',
         id: 1,
         params: { name: 'aximCoreDispatch', arguments: { workflow_id: 'wf-123' } }
       },
       baseEnv,
       {},
       'https://mcp.axim.us.com/message'
    );
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    const content = JSON.parse(body.result.content[0].text);
    expect(content.status).toBe('dispatched');
  });

  it('handles aximStateSync successfully on /message', async () => {
    const envWithKv = { ...baseEnv, LAB_STATE: makeKv() };
    const response = await post(
       {
         jsonrpc: '2.0',
         method: 'tools/call',
         id: 1,
         params: { name: 'aximStateSync', arguments: { action: 'set', key: 'test', value: { a: 1 } } }
       },
       envWithKv,
       {},
       'https://mcp.axim.us.com/message'
    );
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    const content = JSON.parse(body.result.content[0].text);
    expect(content.status).toBe('saved');
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
