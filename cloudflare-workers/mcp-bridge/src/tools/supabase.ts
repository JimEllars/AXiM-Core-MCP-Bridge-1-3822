import type { Env } from '../types';

export function supabaseHeaders(env: Env, extra: HeadersInit = {}): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra
  };
}

export function supabaseUrl(env: Env, path: string): string {
  return `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
}
