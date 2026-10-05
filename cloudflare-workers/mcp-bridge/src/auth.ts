import type {AuthResult, Env} from './types';

export const AUTHORIZED_OPERATORS = new Set([
  'james.ellars@axim.us.com',
  'jrellars@gmail.com'
]);

function reject(error: string, statusCode: number): AuthResult {
  return {authenticated: false, error, statusCode};
}

export async function authenticateOperator(
  request: Request,
  env: Env
): Promise<AuthResult> {
  if (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) {
    return reject('Cloudflare Access credentials are not configured.', 503);
  }

  const clientId = request.headers.get('CF-Access-Client-Id');
  const clientSecret = request.headers.get('CF-Access-Client-Secret');

  if (
    clientId !== env.CF_ACCESS_CLIENT_ID ||
    clientSecret !== env.CF_ACCESS_CLIENT_SECRET
  ) {
    return reject('Cloudflare Zero Trust verification failed.', 403);
  }

  const token = request.headers.get('Authorization')
    ?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

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
      body: '{}'
    });

    if (!response.ok) {
      return reject('Passport SSO rejected the operator session.', 401);
    }

    const session = await response.json() as {
      active?: boolean;
      email?: string;
    };
    const email = (session.email ?? '').toLowerCase().trim();

    if (!session.active || !AUTHORIZED_OPERATORS.has(email)) {
      return reject('Access is restricted to an authorized operator.', 403);
    }

    return {authenticated: true, operatorEmail: email, statusCode: 200};
  } catch {
    return reject('Passport SSO verification is unavailable.', 502);
  }
}
