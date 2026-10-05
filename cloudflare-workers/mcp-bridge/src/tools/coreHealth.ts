import type { Env } from '../types';
import { supabaseHeaders, supabaseUrl } from './supabase';

export async function handleCoreHealth(env: Env) {
  const startedAt = Date.now();

  try {
    const response = await fetch(
      supabaseUrl(env, 'telemetry_events?select=id&limit=1'),
      { headers: supabaseHeaders(env) }
    );

    return {
      status: response.ok ? 'HEALTHY' : 'DEGRADED',
      database_connectivity: response.ok ? 'CONNECTED' : `HTTP_${response.status}`,
      latency_ms: Date.now() - startedAt,
      environment: env.ENVIRONMENT ?? 'production',
      edge_node: 'Cloudflare_V8_Edge',
      timestamp: new Date().toISOString()
    };
  } catch {
    return {
      status: 'FAULT',
      database_connectivity: 'UNREACHABLE',
      latency_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    };
  }
}
