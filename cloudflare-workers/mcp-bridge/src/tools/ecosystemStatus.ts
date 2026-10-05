import type { Env } from '../types';
import { supabaseHeaders, supabaseUrl } from './supabase';

const FALLBACK_NODES = [
  { node: 'asguard_security', status: 'ONLINE', description: 'Edge WAF & Telemetry' },
  { node: 'coding_lab', status: 'ONLINE', description: 'Autonomous GitOps Engine' },
  { node: 'support_system', status: 'ONLINE', description: 'Tier-3 RCA & Helpdesk' },
  { node: 'speedreport', status: 'ONLINE', description: 'Real-time Telemetry & Leads' }
];

export async function handleEcosystemStatus(env: Env) {
  try {
    const response = await fetch(
      supabaseUrl(env, 'ecosystem_nodes?select=node_id,name,role,status,last_heartbeat&order=name.asc'),
      { headers: supabaseHeaders(env) }
    );

    if (!response.ok) return { nodes: FALLBACK_NODES, source: 'fallback_catalog' };

    return { nodes: await response.json(), source: 'supabase_core' };
  } catch {
    return { error: 'Ecosystem node inquiry service is unavailable.' };
  }
}
