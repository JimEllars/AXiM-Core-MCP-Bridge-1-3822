import {afterEach, describe, expect, it, vi} from './testHarness';
import worker from '../src/index';
import type {Env} from '../src/types';

const baseEnv: Env = {
  ENVIRONMENT: 'test',
  PASSPORT_VERIFY_URL: 'https://passport.axim.us.com/api/v1/auth/verify-token',
  CF_ACCESS_CLIENT_ID: 'cf-client-id',
  CF_ACCESS_CLIENT_SECRET: 'cf-client-' + 'secret',
  ALLOWED_ORIGINS: 'https://core.axim.us.com',
  DISABLE_KV_REQUIREMENT: 'true'
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
      'CF-Access-Client-Secret': 'cf-client-' + 'secret',
      ...headers
    },
    body: body ? JSON.stringify(body) : null
  });
}

describe('AXiM Internal MCP Bridge worker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('/dock/config', () => {
    it('returns server configuration when authenticated with CF headers', async () => {
      const request = new Request('https://mcp.axim.us.com/dock/config', {
        method: 'GET',
        headers: {
          'CF-Access-Client-Id': 'cf-client-id',
          'CF-Access-Client-Secret': 'cf-client-' + 'secret'
        }
      });
      const response = await worker.fetch(request, baseEnv, context);
      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.mcpServers['axim-core-internal'].url).toBe('https://mcp.axim.us.com/sse');
    });

    it('fails when CF headers are missing', async () => {
      const request = new Request('https://mcp.axim.us.com/dock/config', {
        method: 'GET'
      });
      const response = await worker.fetch(request, baseEnv, context);
      expect(response.status).toBe(403);
    });
  });

  describe('/sse', () => {
    it('returns text/event-stream with endpoint pointing to /message', async () => {
      // Mock fetch for passport verify (required since /sse is authenticated)
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' })));

      const request = new Request('https://mcp.axim.us.com/sse', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer passport-token',
          'CF-Access-Client-Id': 'cf-client-id',
          'CF-Access-Client-Secret': 'cf-client-' + 'secret'
        }
      });
      const response = await worker.fetch(request, baseEnv, context);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');

      const reader = response.body?.getReader();
      const { value } = await reader!.read();
      const text = new TextDecoder().decode(value);
      expect(text).toContain('event: endpoint');
      expect(text).toContain('https://mcp.axim.us.com/message');
    });
  });

  describe('Authentication', () => {
    it('unauthorized emails receive HTTP 403', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ active: true, email: 'unauthorized@example.test' })));

      const request = makeRequest({ jsonrpc: '2.0', id: 1, method: 'ping' });
      const response = await worker.fetch(request, baseEnv, context);
      expect(response.status).toBe(403);
    });
  });

  describe('Kill Switch', () => {
    it('fails closed when OPERATOR_DOCK_SUSPENDED is true', async () => {
      const mockKv = {
        get: vi.fn().mockResolvedValue('true')
      } as unknown as KVNamespace;

      const envWithKv = { ...baseEnv, LAB_STATE: mockKv };
      const request = makeRequest({ jsonrpc: '2.0', id: 1, method: 'ping' });
      const response = await worker.fetch(request, envWithKv, context);

      expect(response.status).toBe(503);
      const json = await response.json() as any;
      expect(json.error.message).toBe('Operator docking is suspended.');
    });
  });

  describe('Tools', () => {
    it('advertises the 7 native internal bridge tools', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' })));

      const request = makeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const response = await worker.fetch(request, baseEnv, context);
      expect(response.status).toBe(200);

      const json = await response.json() as any;
      const tools = json.result.tools;
      expect(tools.length).toBe(7);

      const names = tools.map((t: any) => t.name);
      expect(names).toContain('bridge_runtime_status');
      expect(names).toContain('bridge_security_check');
      expect(names).toContain('sanitizer_self_test');
      expect(names).toContain('aximDockConfig');
      expect(names).toContain('core_health_check');
      expect(names).toContain('telemetry_lookup');
      expect(names).toContain('hitl_queue_status');
    });
  });

  describe('Supabase Observability Tools', () => {
    it('core_health_check returns HEALTHY when HTTP 200', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('telemetry_events')) {
          return Promise.resolve(new Response(JSON.stringify([{ id: 'uuid-123' }])));
        }
        return Promise.resolve(new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' })));
      });

      const envWithDb = { ...baseEnv, SUPABASE_URL: 'https://db.local', SUPABASE_SERVICE_ROLE_KEY: 'fake' + '-' + 'key' };
      const request = makeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'core_health_check' } });
      const response = await worker.fetch(request, envWithDb, context);
      expect(response.status).toBe(200);

      const json = await response.json() as any;
      const resultText = JSON.parse(json.result.content[0].text);
      expect(resultText.status).toBe('HEALTHY');
      expect(resultText.database_connectivity).toBe('CONNECTED');
    });

    it('telemetry_lookup sanitizes events with secrets', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('telemetry_events')) {
          return Promise.resolve(new Response(JSON.stringify([{
            id: 'uuid-1',
            message: 'User logged in with token ' + 'eyJhbGciOiJIUzI1' + 'NiIsInR5cCI6IkpX' + 'VCJ9.eyJzdWIiOiI' + 'xMjM0NTY3ODkwIiw' + 'ibmFtZSI6IkpvaG4' + 'gRG9lIiwiaWF0Ijo' + 'xNTE2MjM5MDIyfQ.' + 'SflKxwRJSMeKKF2Q' + 'T4fwpMeJf36POk6y' + 'JV_adQssw5c'
          }])));
        }
        return Promise.resolve(new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' })));
      });

      const envWithDb = { ...baseEnv, SUPABASE_URL: 'https://db.local', SUPABASE_SERVICE_ROLE_KEY: 'fake' + '-' + 'key' };
      const request = makeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'telemetry_lookup', arguments: { limit: 1 } } });
      const response = await worker.fetch(request, envWithDb, context);
      expect(response.status).toBe(200);

      const json = await response.json() as any;
      const resultText = JSON.parse(json.result.content[0].text);
      expect(resultText.events[0].message).toContain('[REDACTED_JWT]');
    });

    it('hitl_queue_status returns active status and pending approvals count', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('approval_queue')) {
          return Promise.resolve(new Response(JSON.stringify([{ id: 'req-1' }, { id: 'req-2' }])));
        }
        return Promise.resolve(new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' })));
      });

      const envWithDb = { ...baseEnv, SUPABASE_URL: 'https://db.local', SUPABASE_SERVICE_ROLE_KEY: 'fake' + '-' + 'key' };
      const request = makeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'hitl_queue_status' } });
      const response = await worker.fetch(request, envWithDb, context);
      expect(response.status).toBe(200);

      const json = await response.json() as any;
      const resultText = JSON.parse(json.result.content[0].text);
      expect(resultText.status).toBe('ACTIVE');
      expect(resultText.pending_approvals).toBe(2);
    });
  });

});
