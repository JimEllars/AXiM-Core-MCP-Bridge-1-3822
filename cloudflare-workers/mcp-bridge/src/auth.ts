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
  const url = new URL(request.url);

  // 1. Extract Credentials
  let clientId = request.headers.get('CF-Access-Client-Id');
  let clientSecret = request.headers.get('CF-Access-Client-Secret');

  const authHeader = request.headers.get('Authorization');
  if (!clientId || !clientSecret) {
    if (authHeader?.toLowerCase().startsWith('basic ')) {
      try {
        const base64Credentials = authHeader.substring(6).trim();
        const credentials = atob(base64Credentials);
        const [user, pass] = credentials.split(':');
        if (user && pass) {
          clientId = user;
          clientSecret = pass;
        }
      } catch (e) {
        // ignore parse errors, continue to other checks
      }
    }
  }

  if (!clientId || !clientSecret) {
    clientId = url.searchParams.get('clientId') || clientId;
    clientSecret = url.searchParams.get('clientSecret') || clientSecret;
  }

  // 2. M2M Service Token Path
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    if (clientId === env.CF_ACCESS_CLIENT_ID && clientSecret === env.CF_ACCESS_CLIENT_SECRET) {
      return { authenticated: true, operatorEmail: 'james.ellars@axim.us.com', statusCode: 200 };
    }
  } else {
    // If not configured, we still might succeed via other paths, but if they depend on this... (Wait, previous code rejected if CF credentials weren't configured, but the new instructions say to add this as *one* of the flexible paths)
    // Actually, original code had:
    // if (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) { return reject('Cloudflare Access credentials are not configured.', 503); }
    // Let's keep that requirement? Or maybe it's just for the M2M path? The task says:
    // "M2M Service Token Path: If a valid Client ID and Client Secret match env.CF_ACCESS_CLIENT_ID and env.CF_ACCESS_CLIENT_SECRET, immediately authenticate..."
  }

  // 3. Direct Gateway Token Path
  const gatewayToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || request.headers.get('X-Axim-Gateway-Token');

  if (gatewayToken && (
    (env.AXIM_GATEWAY_TOKEN && gatewayToken === env.AXIM_GATEWAY_TOKEN) ||
    (env.MCP_GATEWAY_SECRET && gatewayToken === env.MCP_GATEWAY_SECRET)
  )) {
    return { authenticated: true, operatorEmail: 'james.ellars@axim.us.com', statusCode: 200 }; // Wait, does the prompt say which email? "authenticate immediately." Let's use the default operator.
  }

  // 4. Passport SSO Path
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (!token) {
    return reject('A Passport operator session token or valid credentials are required.', 401);
  }

  if (!env.PASSPORT_VERIFY_URL || !isValidPassportUrl(env.PASSPORT_VERIFY_URL, env.ENVIRONMENT)) {
    return reject('Passport verification URL is missing or invalid.', 503);
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
