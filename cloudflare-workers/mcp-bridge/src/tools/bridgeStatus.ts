import type {Env} from '../types';
import {readKillSwitch} from '../killSwitch';

export async function handleBridgeStatus(env: Env) {
  const killSwitch = await readKillSwitch(env);
  const degraded = killSwitch.unavailable;

  return {
    status: killSwitch.suspended ? 'SUSPENDED' : degraded ? 'DEGRADED' : 'OPERATIONAL',
    environment: env.ENVIRONMENT ?? 'development',
    transport: 'MCP Streamable HTTP, stateless JSON',
    operator_auth: 'Cloudflare Access and Passport session required',
    rate_limit: env.LAB_STATE
      ? 'KV-backed best-effort limit; KV increments are not atomic'
      : 'Not configured',
    kill_switch: killSwitch.configured
      ? killSwitch.suspended
        ? 'SUSPENDED'
        : degraded
          ? 'UNAVAILABLE'
          : 'ACTIVE'
      : 'NOT_CONFIGURED',
    database_diagnostics: env.SUPABASE_URL
      ? env.SUPABASE_SERVICE_ROLE_KEY
        ? 'CONFIGURED'
        : 'SUPABASE_URL_CONFIGURED_MISSING_KEY'
      : 'NOT_CONFIGURED',
    timestamp: new Date().toISOString()
  };
}
