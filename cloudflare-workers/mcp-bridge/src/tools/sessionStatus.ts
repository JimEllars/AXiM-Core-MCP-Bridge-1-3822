import type { Env } from '../types';
import { getSession } from '../session';

export async function handleSessionStatus(
  env: Env,
  sessionId: string | null,
  operatorEmail: string
) {
  let sessionInfo = null;
  if (sessionId) {
    sessionInfo = await getSession(env, sessionId);
  }

  return {
    status: 'ACTIVE',
    operator_email: operatorEmail,
    session_id: sessionId || 'stateless_http',
    session_metadata: sessionInfo,
    checked_at: new Date().toISOString()
  };
}
