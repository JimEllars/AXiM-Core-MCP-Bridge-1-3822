import type { Env } from '../types';
import { supabaseHeaders, supabaseUrl } from './supabase';

export async function handleHitlQueueStatus(env: Env) {
  try {
    const response = await fetch(
      supabaseUrl(
        env,
        'approval_queue?select=id,created_at&status=eq.PENDING_OPERATOR_SIGNATURE&order=created_at.asc'
      ),
      { headers: supabaseHeaders(env) }
    );

    if (!response.ok) {
      return { error: `Failed to retrieve HITL queue: HTTP ${response.status}` };
    }

    const entries = await response.json() as Array<{ created_at?: string }>;
    const oldest = entries[0]?.created_at
      ? Math.max(0, Math.floor((Date.now() - Date.parse(entries[0].created_at)) / 60000))
      : null;

    return {
      pending_approvals: entries.length,
      oldest_item_age_minutes: oldest,
      requires_attention: entries.length > 0,
      timestamp: new Date().toISOString()
    };
  } catch {
    return { error: 'HITL status service is unavailable.' };
  }
}
