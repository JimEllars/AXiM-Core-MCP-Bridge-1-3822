export interface Env {
  ENVIRONMENT?: string;
  PASSPORT_VERIFY_URL: string;
  ALLOWED_ORIGINS?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  AXIM_GATEWAY_TOKEN?: string;
  MCP_GATEWAY_SECRET?: string;
  RATE_LIMIT_PER_HOUR?: string;
  LAB_STATE?: KVNamespace;

  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    protocolVersion?: string;
    [key: string]: unknown;
  };
}

export interface AuthResult {
  authenticated: boolean;
  operatorEmail?: string;
  error?: string;
  statusCode: number;
}
