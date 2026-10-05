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
      ? 'KV-backed; 60 tool calls per hour by default'
      : 'Not configured',
    kill_switch: killSwitch.configured
      ? killSwitch.suspended ? 'SUSPENDED' : degraded ? 'UNAVAILABLE' : 'ACTIVE'
      : 'NOT_CONFIGURED',
    database_diagnostics: 'Unavailable until a backend is connected',
    timestamp: new Date().toISOString()
  };
}
