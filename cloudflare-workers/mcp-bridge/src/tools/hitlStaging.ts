import type { Env } from '../types';

function getSupabaseHeaders(env: Env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
}

export async function handleDispatchTask(
  args: Record<string, unknown> | undefined,
  env: Env,
  operatorEmail: string
) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Supabase credentials are not configured.' };
  }

  if (!args || typeof args.action_type !== 'string' || typeof args.target_system !== 'string') {
    throw new Error('Invalid arguments: action_type (string) and target_system (string) are required.');
  }

  const actionType = String(args.action_type).trim();
  const targetSystem = String(args.target_system).trim();
  const payload = args.payload && typeof args.payload === 'object' ? args.payload : {};

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/approval_queue`, {
      method: 'POST',
      headers: getSupabaseHeaders(env),
      body: JSON.stringify({
        action_type: actionType,
        target_system: targetSystem,
        payload: payload,
        status: 'PENDING_OPERATOR_SIGNATURE',
        metadata: {
          requested_by: operatorEmail,
          staged_via: 'axim_core_mcp_bridge',
          created_at: new Date().toISOString()
        }
      }),
      signal: AbortSignal.timeout(4000)
    });

    if (!res.ok) {
      return { error: `Task staging failed: HTTP ${res.status}` };
    }

    const inserted = (await res.json()) as Array<{ id: string }>;
    const taskId = inserted[0]?.id || 'staged_task';

    return {
      status: 'STAGED_FOR_APPROVAL',
      task_id: taskId,
      action_type: actionType,
      target_system: targetSystem,
      message: `Action staged under HITL Task #${taskId}. Awaiting operator signature at https://core.axim.us.com/hitl/approve?task=${taskId}`,
      action_required: 'Operator signature required out-of-band. External AI cannot auto-approve.'
    };
  } catch (error: any) {
    return { error: error.message || 'Failed to stage task in approval queue' };
  }
}
