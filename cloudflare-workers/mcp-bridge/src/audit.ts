import type { Env } from './types';
import { supabaseHeaders, supabaseUrl } from './tools/supabase';

export async function writeAuditLog(
  env: Env,
  request: Request,
  operatorEmail: string,
  toolName: string,
  inputArguments: Record<string, unknown>,
  executionTimeMs: number,
  status: 'SUCCESS' | 'ERROR',
  errorMessage?: string
) {
  try {
    await fetch(supabaseUrl(env, 'mcp_audit_logs'), {
      method: 'POST',
      headers: supabaseHeaders(env, {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      }),
      body: JSON.stringify({
        operator_email: operatorEmail,
        tool_name: toolName,
        input_arguments: inputArguments,
        execution_time_ms: executionTimeMs,
        status,
        error_message: errorMessage,
        cf_ray_id: request.headers.get('CF-Ray'),
        client_ip: request.headers.get('CF-Connecting-IP')
      })
    });
  } catch {
    // Diagnostics remain available if non-critical audit persistence is unavailable.
  }
}
