import {
  handleCoreHealthCheck,
  handleTelemetryLookup,
  handleHitlQueueStatus
} from './tools/coreObservability';
import {authenticateOperator} from './auth';
import {readKillSwitch} from './killSwitch';
import {enforceRateLimit} from './rateLimit';
import {sanitizeEgressPayload} from './sanitizer';
import {handleBridgeStatus} from './tools/bridgeStatus';
import {handleSanitizerCheck} from './tools/sanitizerCheck';
import {handleSecurityCheck} from './tools/securityCheck';
import {handleAximDockConfig} from './tools/aximDockConfig';
import type {Env, JsonRpcRequest} from './types';

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const PROTOCOL_VERSION = '2024-11-05';

const mcpTools = [
  {
    name: 'bridge_runtime_status',
    description: 'Reports bridge runtime, transport, rate-limit, and kill-switch status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'bridge_security_check',
    description: 'Checks whether required access controls and KV state are configured; never returns credentials.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'sanitizer_self_test',
    description: 'Tests egress redaction against representative credentials and personal data.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'aximDockConfig',
    description: 'Returns the ready-to-use client JSON snippet for Claude Desktop or Cursor to dock into this bridge.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'core_health_check',
    description: 'Pings Supabase Core and reports database latency and health.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'telemetry_lookup',
    description: 'Queries recent critical/error telemetry events from public.telemetry_events.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' }, service_name: { type: 'string' } },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'hitl_queue_status',
    description: 'Queries approval_queue for records where status = PENDING_OPERATOR_SIG.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }
];



function corsHeaders(request: Request, env: Env): Headers {
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = request.headers.get('Origin');
  const headers = new Headers({Vary: 'Origin'});

  if (origin && allowedOrigins.includes(origin)) {
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

function validId(id: JsonRpcRequest['id']): boolean {
  return id === undefined || id === null || typeof id === 'string' || typeof id === 'number';
}

async function callTool(name: string, args: Record<string, unknown> | undefined, env: Env, requestUrl: string): Promise<unknown> {
  if (name === 'bridge_runtime_status') return handleBridgeStatus(env);
  if (name === 'bridge_security_check') return handleSecurityCheck(env);
  if (name === 'sanitizer_self_test') return handleSanitizerCheck();
  if (name === 'aximDockConfig') return handleAximDockConfig(env, requestUrl);
  if (name === 'core_health_check') return handleCoreHealthCheck(env);
  if (name === 'telemetry_lookup') return handleTelemetryLookup(args, env);
  if (name === 'hitl_queue_status') return handleHitlQueueStatus(env);
  throw new Error('Unknown tool.');
}


function jsonMimeAccepted(request: Request): boolean {
  const accepted = (request.headers.get('Accept') ?? '*/*')
    .split(',')
    .map((value) => value.trim().split(';')[0].toLowerCase());

  return accepted.includes('*/*') || accepted.includes('application/json');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const headers = corsHeaders(request, env);
    const origin = request.headers.get('Origin');

    if (origin && !headers.has('Access-Control-Allow-Origin')) {
      return new Response('Origin not allowed.', {status: 403});
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {status: 204, headers});
    }

    if (path !== '/sse' && path !== '/message' && path !== '/mcp' && path !== '/dock/config') {
      return jsonResponse(rpcError(null, -32601, 'MCP endpoint not found.'), 404, request, env);
    }

    const killSwitch = await readKillSwitch(env);
    if (killSwitch.suspended) {
      return jsonResponse(rpcError(null, -32004, 'Operator docking is suspended.'), 503, request, env);
    }
    if (killSwitch.unavailable) {
      return jsonResponse(rpcError(null, -32004, 'Bridge security state is unavailable.'), 503, request, env);
    }

    let operatorEmail: string | undefined;

    if (path === '/mcp' || path === '/sse' || path === '/message') {
      const auth = await authenticateOperator(request, env);
      if (!auth.authenticated || !auth.operatorEmail) {
        return jsonResponse(
          rpcError(null, -32001, auth.error ?? 'Unauthorized.'),
          auth.statusCode,
          request,
          env
        );
      }
      operatorEmail = auth.operatorEmail;
    }

    // Config endpoint
    if (path === '/dock/config' && request.method === 'GET') {
      const clientId = request.headers.get('CF-Access-Client-Id');
      const clientSecret = request.headers.get('CF-Access-Client-Secret');
      if (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET || clientId !== env.CF_ACCESS_CLIENT_ID || clientSecret !== env.CF_ACCESS_CLIENT_SECRET) {
        return jsonResponse(rpcError(null, -32001, 'Cloudflare Zero Trust verification failed.'), 403, request, env);
      }
      const config = handleAximDockConfig(env, request.url);
      return jsonResponse(config, 200, request, env);
    }

    // SSE Endpoint
    if (path === '/sse' && request.method === 'GET') {
      const sseHeaders = new Headers(headers);
      sseHeaders.set('Content-Type', 'text/event-stream');
      sseHeaders.set('Cache-Control', 'no-cache');
      sseHeaders.set('Connection', 'keep-alive');

      const stream = new ReadableStream({
        start(controller) {
          const endpointEvent = `event: endpoint\ndata: ${url.origin}/message\n\n`;
          controller.enqueue(new TextEncoder().encode(endpointEvent));
        }
      });

      return new Response(stream, { headers: sseHeaders });
    }

    if (request.method !== 'POST') {
      return jsonResponse(
        rpcError(null, -32600, 'MCP expects POST transport.'),
        405,
        request,
        env,
        {Allow: 'POST, OPTIONS'}
      );
    }

    const contentType = (request.headers.get('Content-Type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (contentType !== 'application/json') {
      return jsonResponse(rpcError(null, -32600, 'Content-Type must be application/json.'), 415, request, env);
    }

    if (!jsonMimeAccepted(request)) {
      return jsonResponse(rpcError(null, -32600, 'Accept must include application/json.'), 406, request, env);
    }

    const payload = await readPayload(request);
    if (!payload) {
      return jsonResponse(
        rpcError(null, -32700, 'Invalid JSON or request body exceeds 64 KB.'),
        400,
        request,
        env
      );
    }

    const hasId = Object.prototype.hasOwnProperty.call(payload, 'id');
    if (
      payload.jsonrpc !== '2.0' ||
      typeof payload.method !== 'string' ||
      !validId(payload.id) ||
      (payload.params !== undefined &&
        (typeof payload.params !== 'object' || payload.params === null || Array.isArray(payload.params)))
    ) {
      return jsonResponse(rpcError(payload.id, -32600, 'Invalid JSON-RPC request.'), 400, request, env);
    }

    if (!hasId) {
      return new Response(null, {status: 202, headers});
    }

    if (payload.method === 'initialize') {
      return jsonResponse(
        rpcResult(payload.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {tools: {listChanged: false}, resources: {}},
          serverInfo: {name: 'axim-core-bridge', version: '1.0.0'}
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

    const availableTools = mcpTools;

    if (payload.method === 'tools/list') {
      return jsonResponse(rpcResult(payload.id, {tools: availableTools}), 200, request, env);
    }

    if (payload.method !== 'tools/call') {
      return jsonResponse(rpcError(payload.id, -32601, 'Method not implemented.'), 200, request, env);
    }

    const toolName = payload.params?.name;
    const args = payload.params?.arguments;

    if (typeof toolName !== 'string') {
      return jsonResponse(
        rpcError(payload.id, -32602, 'A tool name is required.'),
        200,
        request,
        env
      );
    }

    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
      return jsonResponse(
        rpcError(payload.id, -32602, 'Arguments must be an object if provided.'),
        200,
        request,
        env
      );
    }

    const toolDef = availableTools.find((tool) => tool.name === toolName);
    if (!toolDef) {
      return jsonResponse(
        rpcResult(payload.id, toolResult({error: 'Unknown or unavailable tool.'}, true)),
        200,
        request,
        env
      );
    }

    if ((path === '/mcp' || path === '/message') && operatorEmail) {
      const rate = await enforceRateLimit(env, operatorEmail);
      if (!rate.allowed) {
        const status = env.LAB_STATE ? 429 : 503;
        const message = status === 429
          ? 'Hourly tool call limit reached.'
          : 'Production rate limiting is not configured.';
        const retryAfter = Math.max(1, rate.resetAt - Math.floor(Date.now() / 1000));

        return jsonResponse(
          rpcError(payload.id, -32003, message),
          status,
          request,
          env,
          {'Retry-After': String(retryAfter)}
        );
      }
    }

    let finalResponse: Response;
    try {
      const rawResult = await callTool(toolName, args, env, request.url);
      const sanitizedResult = sanitizeEgressPayload(rawResult);
      finalResponse = jsonResponse(rpcResult(payload.id, toolResult(sanitizedResult)), 200, request, env);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Tool execution failed.';
      finalResponse = jsonResponse(
        rpcError(payload.id, -32602, msg),
        200,
        request,
        env
      );
    }

    return finalResponse;
  }
};
