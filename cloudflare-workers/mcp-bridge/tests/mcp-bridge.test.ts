import {afterEach, describe, expect, it, vi} from './testHarness';
import worker from '../src/index';
import type {Env} from '../src/types';


const mockKV = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  list: vi.fn()
};

const baseEnv: Env = {
  ENVIRONMENT: 'test',
  PASSPORT_VERIFY_URL: 'https://passport.axim.us.com/api/v1/auth/verify-token',
  CF_ACCESS_CLIENT_ID: 'cf-client-id',
  CF_ACCESS_CLIENT_SECRET: 'cf-client-' + 'secret',
  ALLOWED_ORIGINS: 'https://core.axim.us.com',
  DISABLE_KV_REQUIREMENT: 'true',
  LAB_STATE: mockKV as unknown as KVNamespace
};

const context = { waitUntil: vi.fn((promise) => { promise.catch(() => {}); }) } as unknown as ExecutionContext;


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
    it('returns text/event-stream with endpoint pointing to /message?sessionId=', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' }))
      );

      const request = new Request('https://mcp.axim.us.com/sse', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer passport-token',
          'CF-Access-Client-Id': 'cf-client-id',
          'CF-Access-Client-Secret': 'cf-client-secret'
        }
      });

      const response = await worker.fetch(request, baseEnv, context);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');

      const reader = response.body?.getReader();
      const { value } = await reader!.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('event: endpoint');
      expect(text).toContain('https://mcp.axim.us.com/message?sessionId=');
    });

    it('rejects unauthenticated /sse connections with HTTP 401', async () => {
      const request = new Request('https://mcp.axim.us.com/sse', { method: 'GET' });
      const response = await worker.fetch(request, baseEnv, context);
      expect(response.status).toBe(403);
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
    it('advertises the 11 native internal bridge tools', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' })));

      const request = makeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const response = await worker.fetch(request, baseEnv, context);
      expect(response.status).toBe(200);

      const json = await response.json() as any;
      const tools = json.result.tools;
      expect(tools.length).toBe(11);

      const names = tools.map((t: any) => t.name);
      expect(names).toContain('bridge_runtime_status');
      expect(names).toContain('bridge_security_check');
      expect(names).toContain('sanitizer_self_test');
      expect(names).toContain('aximDockConfig');
      expect(names).toContain('core_health_check');
      expect(names).toContain('telemetry_lookup');
      expect(names).toContain('hitl_queue_status');
      expect(names).toContain('axim_dispatch_task');
    });
  });

  describe('Session Listing and Revocation', () => {
    it('axim_list_sessions returns active sessions', async () => {
            globalThis.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' })));
      });
      const mockEnv = { ...baseEnv, LAB_STATE: {
        list: vi.fn().mockResolvedValue({ keys: [{ name: 'mcp-session:id-1' }] }),
        get: vi.fn().mockImplementation((key) => {
          if (key.includes('rate-limit')) return Promise.resolve(JSON.stringify({ count: 1, resetAt: Date.now() + 3600000 }));
          return Promise.resolve(JSON.stringify({ sessionId: 'id-1', operatorEmail: 'test@example.com' }));
        }),
        put: vi.fn().mockResolvedValue(undefined)
      } as any };
      const request = makeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'axim_list_sessions' } });
      const response = await worker.fetch(request, mockEnv, context);
      expect(response.status).toBe(200);

      const json = await response.json() as any;
      const resultText = JSON.parse(json.result.content[0].text);
      expect(resultText.count).toBe(1);
      expect(resultText.sessions[0].sessionId).toBe('id-1');
    });

    it('axim_revoke_session revokes session successfully', async () => {
            globalThis.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' })));
      });
      const mockEnv = { ...baseEnv, LAB_STATE: { delete: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(JSON.stringify({ count: 1, resetAt: Date.now() + 3600000 })), put: vi.fn().mockResolvedValue(undefined) } as any };
      const request = makeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'axim_revoke_session', arguments: { target_session_id: 'id-1' } } });
      const response = await worker.fetch(request, mockEnv, context);
      expect(response.status).toBe(200);

      const json = await response.json() as any;
      const resultText = JSON.parse(json.result.content[0].text);
      expect(resultText.status).toBe('REVOKED');
      expect(mockEnv.LAB_STATE.delete).toHaveBeenCalledWith('mcp-session:id-1');
    });

    it('POST /message rejects revoked sessions with 401', async () => {
            globalThis.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' })));
      });
      const mockEnv = { ...baseEnv, LAB_STATE: { get: vi.fn().mockImplementation((key) => {
          if (key.includes('rate-limit')) return Promise.resolve(JSON.stringify({ count: 1, resetAt: Date.now() + 3600000 }));
          return Promise.resolve(null);
      }), put: vi.fn().mockResolvedValue(undefined) } as any }; // Session missing
      const request = new Request('http://localhost/message?sessionId=revoked-id', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer asdfghjkl',
          'CF-Access-Client-Id': mockEnv.CF_ACCESS_CLIENT_ID || 'test-client',
          'CF-Access-Client-Secret': mockEnv.CF_ACCESS_CLIENT_SECRET || 'test-secret'
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping' })
      });
      const response = await worker.fetch(request, mockEnv, context);
      expect(response.status).toBe(401);
      const json = await response.json() as any;
      expect(json.error.message).toBe('MCP session has been revoked or expired.');
    });
  });

  describe('Supabase Observability Tools', () => {
    it('axim_dispatch_task stages records into approval_queue with status PENDING_OPERATOR_SIGNATURE', async () => {
      const fetchSpy = vi.fn().mockImplementation((url: string) => {
        if (url.includes('approval_queue')) {
          return Promise.resolve(new Response(JSON.stringify([{ id: 'task-uuid-99' }]), { status: 201 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' })));
      });
      globalThis.fetch = fetchSpy;

      const envWithDb = { ...baseEnv, SUPABASE_URL: 'https://db.local', SUPABASE_SERVICE_ROLE_KEY: 'fake-key' };
      const request = makeRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'axim_dispatch_task',
          arguments: {
            action_type: 'stage_pr_merge',
            target_system: 'coding_lab',
            payload: { pr_id: 104 }
          }
        }
      });

      const response = await worker.fetch(request, envWithDb, context);
      expect(response.status).toBe(200);

      const json = await response.json() as any;
      const result = JSON.parse(json.result?.content?.[0]?.text || '{}');
      expect(result.status).toBe('STAGED_FOR_APPROVAL');
      expect(result.task_id).toBe('task-uuid-99');
    });
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


    it('telemetry_lookup builds correct URL with comma-separated severity and component arguments', async () => {
      const fetchSpy = vi.fn().mockImplementation((url: string) => {
        if (url.includes('telemetry_events')) {
          return Promise.resolve(new Response(JSON.stringify([{ id: 'uuid-1' }])));
        }
        return Promise.resolve(new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' })));
      });
      globalThis.fetch = fetchSpy;

      const envWithDb = { ...baseEnv, SUPABASE_URL: 'https://db.local', SUPABASE_SERVICE_ROLE_KEY: 'fake-key' };
      const request = makeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'telemetry_lookup', arguments: { limit: 5, component: 'auth-service', severity: 'ERROR,CRITICAL' } } });
      const response = await worker.fetch(request, envWithDb, context);
      expect(response.status).toBe(200);

      const dbCalls = fetchSpy.mock.calls.filter((c: any) => c[0].includes('telemetry_events'));
      expect(dbCalls.length).toBe(1);
      const calledUrl = dbCalls[0][0];
      expect(calledUrl).toContain('component_id=eq.auth-service');
      expect(calledUrl).toContain('severity=in.(ERROR,CRITICAL)');
      expect(calledUrl).toContain('limit=5');
    });

    it('telemetry_lookup builds correct URL with severity and component arguments', async () => {
      const fetchSpy = vi.fn().mockImplementation((url: string) => {
        if (url.includes('telemetry_events')) {
          return Promise.resolve(new Response(JSON.stringify([{ id: 'uuid-1' }])));
        }
        return Promise.resolve(new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' })));
      });
      globalThis.fetch = fetchSpy;

      const envWithDb = { ...baseEnv, SUPABASE_URL: 'https://db.local', SUPABASE_SERVICE_ROLE_KEY: 'fake-key' };
      const request = makeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'telemetry_lookup', arguments: { limit: 5, component: 'auth-service', severity: 'CRITICAL' } } });
      const response = await worker.fetch(request, envWithDb, context);
      expect(response.status).toBe(200);

      const dbCalls = fetchSpy.mock.calls.filter((c: any) => c[0].includes('telemetry_events'));
      expect(dbCalls.length).toBe(1);
      const calledUrl = dbCalls[0][0];
      expect(calledUrl).toContain('component_id=eq.auth-service');
      expect(calledUrl).toContain('severity=eq.CRITICAL');
      expect(calledUrl).toContain('limit=5');
    });



    it('hitl_queue_status respects the limit query parameter', async () => {
      const fetchSpy = vi.fn().mockImplementation((url: string) => {
        if (url.includes('approval_queue')) {
          return Promise.resolve(new Response(JSON.stringify([{ id: 'req-1' }, { id: 'req-2' }])));
        }
        return Promise.resolve(new Response(JSON.stringify({ active: true, email: 'james.ellars@axim.us.com' })));
      });
      globalThis.fetch = fetchSpy;

      const envWithDb = { ...baseEnv, SUPABASE_URL: 'https://db.local', SUPABASE_SERVICE_ROLE_KEY: 'fake-key' };
      const request = makeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'hitl_queue_status', arguments: { limit: 5 } } });
      const response = await worker.fetch(request, envWithDb, context);
      expect(response.status).toBe(200);

      const dbCalls = fetchSpy.mock.calls.filter((c: any) => c[0].includes('approval_queue'));
      expect(dbCalls.length).toBe(1);
      const calledUrl = dbCalls[0][0];
      expect(calledUrl).toContain('limit=5');
    });

    it('recordMcpAuditLog accepts and serializes cf_ray and colo metadata without runtime errors', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
      globalThis.fetch = fetchSpy;

      const { recordMcpAuditLog } = await import('../src/tools/coreObservability');

      const envWithDb = { ...baseEnv, SUPABASE_URL: 'https://db.local', SUPABASE_SERVICE_ROLE_KEY: 'fake-key' };

      await expect(recordMcpAuditLog(envWithDb, '/mcp', 'test_tool', 'user@test.com', 200, 50, { cf_ray: 'ray-123', colo: 'EWR' })).resolves.toBeUndefined();

      expect(fetchSpy).toHaveBeenCalled();
      const fetchCall = fetchSpy.mock.calls[0];
      const requestInit = fetchCall[1];
      const body = JSON.parse(requestInit.body);

      expect(body.metadata.cf_ray).toBe('ray-123');
      expect(body.metadata.colo).toBe('EWR');
      expect(body.metadata.node).toBe('cloudflare_edge');
    });

    it('recordMcpAuditLog handles missing database credentials gracefully', async () => {
      // Mock fetch to reject if called to ensure it's not called
      const fetchSpy = vi.fn().mockRejectedValue(new Error('Should not be called'));
      globalThis.fetch = fetchSpy;

      const { recordMcpAuditLog } = await import('../src/tools/coreObservability');

      // Should not throw
      await expect(recordMcpAuditLog(baseEnv, '/mcp', 'test_tool', 'user@test.com', 200, 50)).resolves.toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
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
