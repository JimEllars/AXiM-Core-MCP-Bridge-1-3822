import type {AuthResult, Env} from './types';

export const AUTHORIZED_OPERATORS = new Set([
  'james.ellars@axim.us.com',
  'jrellars@gmail.com'
]);

const MAX_PASSPORT_RESPONSE_BYTES = 8 * 1024;
const PASSPORT_TIMEOUT_MS = 5_000;

function reject(error: string, statusCode: number): AuthResult {
  return {authenticated: false, error, statusCode};
}

function isValidPassportUrl(value: string, environment?: string): boolean {
  try {
    const url = new URL(value);
    const secure = url.protocol === 'https:';
    const hasNoEmbeddedCredentials = !url.username && !url.password;
    return hasNoEmbeddedCredentials && (secure || environment !== 'production');
  } catch {
    return false;
  }
}

export async function authenticateOperator(
  request: Request,
  env: Env
): Promise<AuthResult> {
  if (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) {
    return reject('Cloudflare Access credentials are not configured.', 503);
  }

  if (!env.PASSPORT_VERIFY_URL || !isValidPassportUrl(env.PASSPORT_VERIFY_URL, env.ENVIRONMENT)) {
    return reject('Passport verification URL is missing or invalid.', 503);
  }

  const clientId = request.headers.get('CF-Access-Client-Id');
  const clientSecret = request.headers.get('CF-Access-Client-Secret');

  if (clientId !== env.CF_ACCESS_CLIENT_ID || clientSecret !== env.CF_ACCESS_CLIENT_SECRET) {
    return reject('Cloudflare Zero Trust verification failed.', 403);
  }

  const token = request.headers
    .get('Authorization')
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();

  if (!token) {
    return reject('A Passport operator session token is required.', 401);
  }

  try {
    const response = await fetch(env.PASSPORT_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(PASSPORT_TIMEOUT_MS)
    });

    if (!response.ok) {
      return reject('Passport SSO rejected the operator session.', 401);
    }

    const contentLength = Number(response.headers.get('Content-Length') ?? 0);
    if (contentLength > MAX_PASSPORT_RESPONSE_BYTES) {
      return reject('Passport SSO returned an invalid verification response.', 502);
    }

    const responseText = await response.text();
    if (new TextEncoder().encode(responseText).byteLength > MAX_PASSPORT_RESPONSE_BYTES) {
      return reject('Passport SSO returned an invalid verification response.', 502);
    }

    const session = JSON.parse(responseText) as {active?: unknown; email?: unknown};
    const email = typeof session.email === 'string' ? session.email.toLowerCase().trim() : '';

    if (session.active !== true || !AUTHORIZED_OPERATORS.has(email)) {
      return reject('Access is restricted to an authorized operator.', 403);
    }

    return {authenticated: true, operatorEmail: email, statusCode: 200};
  } catch {
    return reject('Passport SSO verification is unavailable.', 502);
  }
}
