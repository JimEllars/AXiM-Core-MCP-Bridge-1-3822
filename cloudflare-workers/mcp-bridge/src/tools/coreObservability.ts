import type { Env } from '../types';
import { sanitizeEgressPayload } from '../sanitizer';

function getSupabaseHeaders(env: Env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
}

export async function handleCoreHealthCheck(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      status: 'CONFIG_MISSING',
      connected: false,
      message: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured on this worker.'
    };
  }

  const start = Date.now();
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/telemetry_events?select=id&limit=1`, {
      method: 'GET',
      headers: getSupabaseHeaders(env),
      signal: AbortSignal.timeout(4000)
    });

    const latencyMs = Date.now() - start;
    return {
      status: res.ok ? 'HEALTHY' : 'DEGRADED',
      database_connectivity: res.ok ? 'CONNECTED' : `HTTP_${res.status}`,
      latency_ms: latencyMs,
      environment: env.ENVIRONMENT || 'production',
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    return {
      status: 'UNAVAILABLE',
      connected: false,
      error: error.message || 'Supabase edge handshake timeout',
      timestamp: new Date().toISOString()
    };
  }
}

export async function handleTelemetryLookup(args: Record<string, unknown> | undefined, env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Supabase credentials are not configured.' };
  }

  const limit = args?.limit && typeof args.limit === 'number' ? Math.min(Math.max(args.limit, 1), 25) : 5;
  const serviceName = args?.service_name && typeof args.service_name === 'string' ? args.service_name : null;

  try {
    let url = `${env.SUPABASE_URL}/rest/v1/telemetry_events?select=id,component_id,severity,message,created_at&order=created_at.desc&limit=${limit}`;
    if (serviceName) {
      url += `&component_id=eq.${encodeURIComponent(serviceName)}`;
    }

    const res = await fetch(url, {
      headers: getSupabaseHeaders(env),
      signal: AbortSignal.timeout(4000)
    });

    if (!res.ok) {
      return { error: `Supabase telemetry query failed: HTTP ${res.status}` };
    }

    const data = await res.json();
    return { count: Array.isArray(data) ? data.length : 0, events: sanitizeEgressPayload(data) };
  } catch (error: any) {
    return { error: error.message || 'Failed to query telemetry events' };
  }
}

export async function handleHitlQueueStatus(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Supabase credentials are not configured.' };
  }

  try {
    const url = `${env.SUPABASE_URL}/rest/v1/approval_queue?select=id,action_type,target_system,created_at&status=eq.PENDING_OPERATOR_SIGNATURE`;
    const res = await fetch(url, {
      headers: getSupabaseHeaders(env),
      signal: AbortSignal.timeout(4000)
    });

    if (!res.ok) {
      return { error: `Approval queue query failed: HTTP ${res.status}` };
    }

    const data = await res.json() as Array<unknown>;
    return {
      status: 'ACTIVE',
      pending_approvals: Array.isArray(data) ? data.length : 0,
      items: sanitizeEgressPayload(data)
    };
  } catch (error: any) {
    return { error: error.message || 'HITL approval queue lookup failed' };
  }
}
