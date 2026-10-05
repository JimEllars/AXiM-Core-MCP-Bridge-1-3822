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

const ctx = {} as ExecutionContext;
const tests: Array<{name: string; run: () => void | Promise<void>}> = [];
const cleanupCallbacks: Array<() => void> = [];

function describe(_name: string, callback: () => void) {
  callback();
}

function it(name: string, run: () => void | Promise<void>) {
  tests.push({name, run});
}

function afterEach(callback: () => void) {
  cleanupCallbacks.push(callback);
}

function deepEqual(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function matchesObject(actual: unknown, expected: unknown): boolean {
  if (typeof actual !== 'object' || actual === null || typeof expected !== 'object' || expected === null) {
    return actual === expected;
  }
  return Object.entries(expected).every(([key, value]) =>
    matchesObject((actual as Record<string, unknown>)[key], value)
  );
}

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`Expected ${String(actual)} to be ${String(expected)}`);
      }
    },
    toEqual(expected: unknown) {
      if (!deepEqual(actual, expected)) {
        throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
      }
    },
    toMatchObject(expected: unknown) {
      if (!matchesObject(actual, expected)) {
        throw new Error(`Expected ${JSON.stringify(actual)} to match ${JSON.stringify(expected)}`);
      }
    }
  };
}

const originalGlobals = new Map<string, unknown>();

const vi = {
  fn<T extends (...args: never[]) => unknown>(implementation: T): T {
    return implementation;
  },
  stubGlobal(name: string, value: unknown) {
    const globals = globalThis as unknown as Record<string, unknown>;
    if (!originalGlobals.has(name)) {
      originalGlobals.set(name, globals[name]);
    }
    globals[name] = value;
  },
  unstubAllGlobals() {
    const globals = globalThis as unknown as Record<string, unknown>;
    for (const [name, value] of originalGlobals) {
      if (value === undefined) {
        delete globals[name];
      } else {
        globals[name] = value;
      }
    }
    originalGlobals.clear();
  }
};

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://mcp.axim.us.com/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer passport-token',
      'CF-Access-Client-Id': 'cf-client-id',
      'CF-Access-Client-Secret': 'cf-client-secret',
      ...headers
    },
    body: JSON.stringify(body)
  });
}

function mockPassport(email = 'james.ellars@axim.us.com') {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({active: true, email}),
    {status: 200}
  )));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AXiM Core MCP bridge', () => {
  it('requires valid Cloudflare Access credentials', async () => {
    mockPassport();
    const response = await worker.fetch(
      makeRequest({jsonrpc: '2.0', method: 'ping', id: 1}, {'CF-Access-Client-Secret': 'wrong'}),
      baseEnv,
      ctx
    );
    expect(response.status).toBe(403);
  });

  it('rejects identities outside the operator allowlist', async () => {
    mockPassport('unauthorized@example.test');
    const response = await worker.fetch(
      makeRequest({jsonrpc: '2.0', method: 'ping', id: 1}),
      baseEnv,
      ctx
    );
    expect(response.status).toBe(403);
  });

  it('lists only the non-database tools', async () => {
    mockPassport();
    const response = await worker.fetch(
      makeRequest({jsonrpc: '2.0', method: 'tools/list', id: 1}),
      baseEnv,
      ctx
    );
    const body = await response.json() as {result: {tools: Array<{name: string}>}};

    expect(response.status).toBe(200);
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      'bridge_runtime_status',
      'sanitizer_self_test'
    ]);
  });

  it('responds to initialize and ping', async () => {
    mockPassport();
    const init = await worker.fetch(
      makeRequest({jsonrpc: '2.0', method: 'initialize', id: 2}),
      baseEnv,
      ctx
    );
    expect(init.status).toBe(200);
    expect(init.headers.get('MCP-Protocol-Version')).toBe('2024-11-05');

    const ping = await worker.fetch(makeRequest({jsonrpc: '2.0', method: 'ping', id: 3}), baseEnv, ctx);
    expect(await ping.json()).toMatchObject({jsonrpc: '2.0', result: {}, id: 3});
  });

  it('returns 202 for initialized notifications', async () => {
    mockPassport();
    const response = await worker.fetch(
      makeRequest({jsonrpc: '2.0', method: 'notifications/initialized'}),
      baseEnv,
      ctx
    );
    expect(response.status).toBe(202);
  });

  it('blocks requests when the kill switch is active', async () => {
    const kv = {
      get: vi.fn(async () => 'true')
    } as unknown as KVNamespace;
    const response = await worker.fetch(
      makeRequest({jsonrpc: '2.0', method: 'ping', id: 1}),
      {...baseEnv, LAB_STATE: kv},
      ctx
    );
    expect(response.status).toBe(503);
  });

  it('fails closed in production when KV-backed rate limiting is absent', async () => {
    mockPassport();
    const response = await worker.fetch(
      makeRequest({jsonrpc: '2.0', method: 'tools/call', id: 1, params: {name: 'sanitizer_self_test'}}),
      {...baseEnv, ENVIRONMENT: 'production'},
      ctx
    );
    expect(response.status).toBe(503);
  });

  it('sanitizes credentials, tokens, and email addresses', () => {
    const result = sanitizeEgressPayload({
      token: 'eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop',
      api_key: 'example-sensitive-value',
      email: 'customer@example.com',
      github: 'ghp_abcdefghijklmnopqrstuvwxyz123456'
    }) as Record<string, string>;

    expect(result.token).toBe('[REDACTED_JWT]');
    expect(result.api_key).toBe('[REDACTED]');
    expect(result.email).toBe('[REDACTED_EMAIL]');
    expect(result.github).toBe('[REDACTED_SECRET]');
  });
});

async function runTests() {
  for (const test of tests) {
    try {
      await test.run();
    } finally {
      for (const callback of cleanupCallbacks) {
        callback();
      }
    }
  }
}

void runTests();
