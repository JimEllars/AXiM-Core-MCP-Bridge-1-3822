import {describe, expect, it, vi} from './testHarness';
import {enforceRateLimit} from '../src/rateLimit';
import type {Env} from '../src/types';

function makeKv(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    })
  } as unknown as KVNamespace;
}

const baseEnv: Env = {
  ENVIRONMENT: 'test',
  PASSPORT_VERIFY_URL: 'https://passport.example.test/verify'
};

describe('MCP bridge rate limiting', () => {
  it('allows calls below the configured hourly limit', async () => {
    const env = {...baseEnv, RATE_LIMIT_PER_HOUR: '2', LAB_STATE: makeKv()};

    await expect(enforceRateLimit(env, 'operator@example.test')).resolves.toMatchObject({
      allowed: true,
      remaining: 1
    });
  });

  it('blocks calls once the hourly limit is reached', async () => {
    const env = {...baseEnv, RATE_LIMIT_PER_HOUR: '1', LAB_STATE: makeKv()};
    const first = await enforceRateLimit(env, 'operator@example.test');
    const second = await enforceRateLimit(env, 'operator@example.test');

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.remaining).toBe(0);
  });

  it('fails closed when production rate-limit storage is unavailable', async () => {
    const env = {...baseEnv, ENVIRONMENT: 'production'};

    await expect(enforceRateLimit(env, 'operator@example.test')).resolves.toMatchObject({
      allowed: false,
      remaining: 0
    });
  });
});
