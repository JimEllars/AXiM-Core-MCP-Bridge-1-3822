import {authenticateOperator} from './auth';
import {readKillSwitch} from './killSwitch';
import {enforceRateLimit} from './rateLimit';
import {sanitizeEgressPayload} from './sanitizer';
import {handleBridgeStatus} from './tools/bridgeStatus';
import {handleSanitizerCheck} from './tools/sanitizerCheck';
import type {Env, JsonRpcRequest} from './types';

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const PROTOCOL_VERSION = '2024-11-05';

const tools = [
  {
    name: 'bridge_runtime_status',
    description: 'Reports bridge runtime and security configuration without querying a database.',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false}
  },
  {
    name: 'sanitizer_self_test',
    description: 'Checks egress redaction against representative secrets and email addresses.',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false}
  }
];

function corsHeaders(request: Request, env: Env): Headers {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim());
  const origin = request.headers.get('Origin');
  const headers = new Headers({Vary: 'Origin'});

  if (origin && allowed.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Axim-Gateway-Token, CF-Access-Client-Id, CF-Access-Client-Secret, MCP-Protocol-Version'
    );
    headers.set('Access-Control-Expose-Headers', 'MCP-Protocol-Version');
  }

  return headers;
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string) {
  return {jsonrpc: '2.0', error: {code, message}, id: id ?? null};
}

function rpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return {jsonrpc: '2.0', result, id: id ?? null};
}

function toolResult(value: unknown, isError = false) {
  return {
    content: [{type: 'text', text: JSON.stringify(value, null, 2)}],
    isError
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  request: Request,
  env: Env,
  extraHeaders: Record<string, string> = {}
): Response {
  const safeBody = sanitizeEgressPayload(body);
  const serialized = JSON.stringify(safeBody);
  const headers = corsHeaders(request, env);

  headers.set('Content-Type', 'application/json;charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');

  for (const [name, value] of Object.entries(extraHeaders)) {
    headers.set(name, value);
  }

  if (new TextEncoder().encode(serialized).byteLength > MAX_RESPONSE_BYTES) {
    return new Response(
      JSON.stringify(rpcError(null, -32002, 'Response exceeds the configured size limit.')),
      {status: 500, headers}
    );
  }

  return new Response(serialized, {status, headers});
}

async function readPayload(request: Request): Promise<JsonRpcRequest | null> {
  const declaredSize = Number(request.headers.get('Content-Length') ?? 0);
  if (declaredSize > MAX_REQUEST_BYTES) return null;

  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_REQUEST_BYTES) return null;

    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    return parsed as JsonRpcRequest;
  } catch {
    return null;
  }
}

async function callTool(name: string, env: Env): Promise<unknown> {
  if (name === 'bridge_runtime_status') return handleBridgeStatus(env);
  if (name === 'sanitizer_self_test') return handleSanitizerCheck();
  throw new Error('Unknown tool.');
}

function hasValidId(id: JsonRpcRequest['id']): boolean {
  return id === undefined || id === null || typeof id === 'string' || typeof id === 'number';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    const headers = corsHeaders(request, env);
    const origin = request.headers.get('Origin');

    if (origin && !headers.has('Access-Control-Allow-Origin')) {
      return new Response('Origin not allowed.', {status: 403});
    }
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (path !== '/mcp') {
      return jsonResponse(rpcError(null, -32601, 'MCP endpoint not found.'), 404, request, env);
    }
    if (request.method !== 'POST') {
      return jsonResponse(rpcError(null, -32600, 'MCP expects POST transport.'), 405, request, env);
    }
    if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
      return jsonResponse(rpcError(null, -32600, 'Content-Type must be application/json.'), 415, request, env);
    }

    const accept = request.headers.get('Accept') ?? '*/*';
    if (!accept.includes('*/*') && !accept.includes('application/json')) {
      return jsonResponse(rpcError(null, -32600, 'Accept must include application/json.'), 406, request, env);
    }

    const killSwitch = await readKillSwitch(env);
    if (killSwitch.suspended) {
      return jsonResponse(rpcError(null, -32004, 'Operator docking is suspended.'), 503, request, env);
    }
    if (killSwitch.unavailable) {
      return jsonResponse(rpcError(null, -32004, 'Bridge security state is unavailable.'), 503, request, env);
    }

    const auth = await authenticateOperator(request, env);
    if (!auth.authenticated || !auth.operatorEmail) {
      return jsonResponse(
        rpcError(null, -32001, auth.error ?? 'Unauthorized.'),
        auth.statusCode,
        request,
        env
      );
    }

    const payload = await readPayload(request);
    if (!payload) {
      return jsonResponse(rpcError(null, -32700, 'Invalid JSON or request body exceeds 64 KB.'), 400, request, env);
    }
    if (
      payload.jsonrpc !== '2.0' ||
      typeof payload.method !== 'string' ||
      !hasValidId(payload.id)
    ) {
      return jsonResponse(rpcError(payload.id, -32600, 'Invalid JSON-RPC request.'), 400, request, env);
    }

    if (payload.method.startsWith('notifications/')) {
      return new Response(null, {status: 202, headers});
    }
    if (payload.method === 'initialize') {
      return jsonResponse(
        rpcResult(payload.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {tools: {listChanged: false}},
          serverInfo: {name: 'axim-core-mcp-gateway', version: '1.2.0'}
        }),
        200,
        request,
        env,
        {'MCP-Protocol-Version': PROTOCOL_VERSION}
      );
    }
    if (payload.method === 'ping') {
      return jsonResponse(rpcResult(payload.id, {}), 200, request, env);
    }
    if (payload.method === 'tools/list') {
      return jsonResponse(rpcResult(payload.id, {tools}), 200, request, env);
    }
    if (payload.method !== 'tools/call') {
      return jsonResponse(rpcError(payload.id, -32601, 'Method not implemented.'), 200, request, env);
    }

    const rate = await enforceRateLimit(env, auth.operatorEmail);
    if (!rate.allowed) {
      const status = env.LAB_STATE ? 429 : 503;
      const message = status === 429
        ? 'Hourly tool call limit reached.'
        : 'Production rate limiting is not configured.';
      return jsonResponse(
        rpcError(payload.id, -32003, message),
        status,
        request,
        env,
        {'Retry-After': String(Math.max(1, rate.resetAt - Math.floor(Date.now() / 1000)))}
      );
    }

    const name = payload.params?.name;
    const args = payload.params?.arguments ?? {};
    if (!name || typeof args !== 'object' || Array.isArray(args)) {
      return jsonResponse(rpcError(payload.id, -32602, 'A tool name and object arguments are required.'), 200, request, env);
    }

    try {
      const result = await callTool(name, env);
      if (Object.keys(args).length > 0) {
        return jsonResponse(rpcResult(payload.id, toolResult({error: 'This tool accepts no arguments.'}, true)), 200, request, env);
      }
      return jsonResponse(rpcResult(payload.id, toolResult(result)), 200, request, env);
    } catch {
      return jsonResponse(rpcResult(payload.id, toolResult({error: 'Unknown or unavailable tool.'}, true)), 200, request, env);
    }
  }
};
