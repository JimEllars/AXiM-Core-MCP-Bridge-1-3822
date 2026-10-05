import type {Env} from './types';

const WINDOW_SECONDS = 60 * 60;
const DEFAULT_LIMIT = 60;

export async function enforceRateLimit(
  env: Env,
  operatorEmail: string
): Promise<{allowed: boolean; remaining: number; resetAt: number}> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / WINDOW_SECONDS) * WINDOW_SECONDS;
  const resetAt = windowStart + WINDOW_SECONDS;

  if (!env.LAB_STATE) {
    if (env.ENVIRONMENT === 'production') {
      return {allowed: false, remaining: 0, resetAt};
    }
    return {allowed: true, remaining: DEFAULT_LIMIT, resetAt};
  }

  const configuredLimit = Number(env.RATE_LIMIT_PER_HOUR);
  const limit = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? Math.floor(configuredLimit)
    : DEFAULT_LIMIT;
  const key = `mcp-rate:${windowStart}:${encodeURIComponent(operatorEmail)}`;

  try {
    const current = Number(await env.LAB_STATE.get(key) ?? '0');
    if (current >= limit) return {allowed: false, remaining: 0, resetAt};

    await env.LAB_STATE.put(key, String(current + 1), {
      expirationTtl: WINDOW_SECONDS * 2
    });

    return {allowed: true, remaining: limit - current - 1, resetAt};
  } catch {
    return {allowed: false, remaining: 0, resetAt};
  }
}
