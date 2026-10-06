import type {Env} from '../types';
import {sanitizeEgressPayload} from '../sanitizer';

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
    return { status: 'CONFIG_MISSING', message: 'Supabase credentials not configured.' };
  }

  const start = Date.now();
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
      method: 'GET',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    });

    const latency = Date.now() - start;

    if (res.ok) {
      return { status: 'OPERATIONAL', latency_ms: latency, message: 'Connected to Supabase successfully.' };
    } else {
      return { status: 'DEGRADED', latency_ms: latency, message: `Supabase returned status ${res.status}` };
    }
  } catch (error) {
    return { status: 'UNAVAILABLE', error: String(error) };
  }
}

export async function handleTelemetryLookup(args: Record<string, unknown> | undefined, env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Supabase credentials not configured.' };
  }

  const limit = args?.limit && typeof args.limit === 'number' ? Math.min(args.limit, 50) : 10;
  const serviceName = args?.service_name && typeof args.service_name === 'string' ? args.service_name : null;

  try {
    let url = `${env.SUPABASE_URL}/rest/v1/telemetry_events?select=*&order=created_at.desc&limit=${limit}`;
    if (serviceName) {
      url += `&service_name=eq.${encodeURIComponent(serviceName)}`;
    }

    const res = await fetch(url, { headers: getSupabaseHeaders(env) });
    if (!res.ok) {
      throw new Error(`Supabase query failed: ${res.status}`);
    }

    const data = await res.json();
    return sanitizeEgressPayload(data);
  } catch (error) {
    return { error: String(error) };
  }
}

export async function handleHitlQueueStatus(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Supabase credentials not configured.' };
  }

  try {
    const url = `${env.SUPABASE_URL}/rest/v1/approval_queue?select=id,action_description,created_at&status=eq.PENDING_OPERATOR_SIG`;
    const res = await fetch(url, { headers: getSupabaseHeaders(env) });

    if (!res.ok) {
      throw new Error(`Supabase query failed: ${res.status}`);
    }

    const data = await res.json() as Array<{id: string, action_description: string, created_at: string}>;
    return {
      status: 'SUCCESS',
      pending_count: data.length,
      pending_actions: sanitizeEgressPayload(data)
    };
  } catch (error) {
    return { error: String(error) };
  }
}

export async function auditLog(
  env: Env,
  route: string,
  toolName: string,
  operatorEmail: string | undefined,
  statusCode: number,
  metadata: Record<string, unknown> = {}
) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/mcp_audit_logs`, {
      method: 'POST',
      headers: getSupabaseHeaders(env),
      body: JSON.stringify({
        route,
        tool_name: toolName,
        operator_email: operatorEmail || null,
        status_code: statusCode,
        metadata
      })
    });
  } catch {
    // Non-blocking, ignore errors
  }
}
