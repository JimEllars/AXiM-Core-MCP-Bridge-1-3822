export interface Env {
  ENVIRONMENT?: string;
  SUPABASE_URL?: string;
  PASSPORT_VERIFY_URL: string;
  ALLOWED_ORIGINS?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  RATE_LIMIT_PER_HOUR?: string;
  LAB_STATE?: KVNamespace;
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    protocolVersion?: string;
  };
}

export interface AuthResult {
  authenticated: boolean;
  operatorEmail?: string;
  error?: string;
  statusCode: number;
}
