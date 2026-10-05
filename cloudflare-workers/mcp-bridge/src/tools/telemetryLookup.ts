import type { Env } from '../types';
import { supabaseHeaders, supabaseUrl } from './supabase';

interface TelemetryArgs {
  limit?: unknown;
  component?: unknown;
}

export async function handleTelemetryLookup(args: TelemetryArgs, env: Env) {
  const requestedLimit = Number(args.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), 20))
    : 5;
  const query = new URLSearchParams({
    select: 'id,component_id,severity,message,created_at',
    severity: 'in.(ERROR,CRITICAL)',
    order: 'created_at.desc',
    limit: String(limit)
  });

  if (typeof args.component === 'string' && args.component.trim()) {
    query.set('component_id', `eq.${args.component.trim()}`);
  }

  try {
    const response = await fetch(
      supabaseUrl(env, `telemetry_events?${query.toString()}`),
      { headers: supabaseHeaders(env) }
    );

    if (!response.ok) {
      return { error: `Failed to retrieve telemetry: HTTP ${response.status}` };
    }

    const criticalEvents = await response.json() as unknown[];
    return { count: criticalEvents.length, critical_events: criticalEvents };
  } catch {
    return { error: 'Telemetry retrieval service is unavailable.' };
  }
}
