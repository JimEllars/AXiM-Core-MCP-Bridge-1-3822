import type { Env } from './types';

export interface McpSessionData {
  sessionId: string;
  operatorEmail: string;
  connectedAt: string;
  lastActiveAt: string;
  userAgent?: string;
  clientIp?: string;
}

const SESSION_TTL_SECONDS = 86400; // 24 hours

export async function createSession(
  env: Env,
  sessionId: string,
  operatorEmail: string,
  userAgent?: string,
  clientIp?: string
): Promise<void> {
  if (!env.LAB_STATE) return;

  const data: McpSessionData = {
    sessionId,
    operatorEmail,
    connectedAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    userAgent: userAgent || 'Unknown Client',
    clientIp: clientIp || 'Unknown IP'
  };

  try {
    await env.LAB_STATE.put(`mcp-session:${sessionId}`, JSON.stringify(data), {
      expirationTtl: SESSION_TTL_SECONDS
    });
  } catch {
    // Non-blocking KV put
  }
}

export async function getSession(env: Env, sessionId: string): Promise<McpSessionData | null> {
  if (!env.LAB_STATE) return null;
  try {
    const raw = await env.LAB_STATE.get(`mcp-session:${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as McpSessionData;
  } catch {
    return null;
  }
}

export async function touchSession(env: Env, sessionId: string): Promise<void> {
  if (!env.LAB_STATE) return;
  try {
    const session = await getSession(env, sessionId);
    if (session) {
      session.lastActiveAt = new Date().toISOString();
      await env.LAB_STATE.put(`mcp-session:${sessionId}`, JSON.stringify(session), {
        expirationTtl: SESSION_TTL_SECONDS
      });
    }
  } catch {
    // Non-blocking KV update
  }
}

export async function revokeSession(env: Env, sessionId: string): Promise<boolean> {
  if (!env.LAB_STATE) return false;
  try {
    await env.LAB_STATE.delete(`mcp-session:${sessionId}`);
    return true;
  } catch {
    return false;
  }
}


export async function listActiveSessions(env: Env): Promise<McpSessionData[]> {
  if (!env.LAB_STATE) return [];
  try {
    const list = await env.LAB_STATE.list({ prefix: 'mcp-session:', limit: 50 });
    const sessions: McpSessionData[] = [];
    for (const key of list.keys) {
      const raw = await env.LAB_STATE.get(key.name);
      if (raw) {
        try {
          sessions.push(JSON.parse(raw) as McpSessionData);
        } catch {
          // Ignore malformed keys
        }
      }
    }
    return sessions;
  } catch {
    return [];
  }
}
