import type { Env } from '../types';
import { getSession, listActiveSessions, revokeSession } from '../session';

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


export async function handleListSessions(env: Env) {
  const sessions = await listActiveSessions(env);
  return {
    count: sessions.length,
    sessions: sessions,
    checked_at: new Date().toISOString()
  };
}

export async function handleRevokeSessionTool(env: Env, targetSessionId: string) {
  if (!targetSessionId || typeof targetSessionId !== 'string') {
    throw new Error('target_session_id (string) is required.');
  }
  const success = await revokeSession(env, targetSessionId.trim());
  return {
    status: success ? 'REVOKED' : 'NOT_FOUND',
    revoked_session_id: targetSessionId,
    revoked_at: new Date().toISOString()
  };
}
