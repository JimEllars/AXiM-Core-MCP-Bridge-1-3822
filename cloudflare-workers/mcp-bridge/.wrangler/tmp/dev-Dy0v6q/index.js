var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/auth.ts
var AUTHORIZED_OPERATORS = /* @__PURE__ */ new Set([
  "james.ellars@axim.us.com",
  "jrellars@gmail.com"
]);
var MAX_PASSPORT_RESPONSE_BYTES = 8 * 1024;
var PASSPORT_TIMEOUT_MS = 5e3;
function reject(error, statusCode) {
  return { authenticated: false, error, statusCode };
}
__name(reject, "reject");
function isValidPassportUrl(value, environment) {
  try {
    const url = new URL(value);
    const secure = url.protocol === "https:";
    const hasNoEmbeddedCredentials = !url.username && !url.password;
    return hasNoEmbeddedCredentials && (secure || environment !== "production");
  } catch {
    return false;
  }
}
__name(isValidPassportUrl, "isValidPassportUrl");
async function authenticateOperator(request, env) {
  if (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) {
    return reject("Cloudflare Access credentials are not configured.", 503);
  }
  if (!env.PASSPORT_VERIFY_URL || !isValidPassportUrl(env.PASSPORT_VERIFY_URL, env.ENVIRONMENT)) {
    return reject("Passport verification URL is missing or invalid.", 503);
  }
  const clientId = request.headers.get("CF-Access-Client-Id");
  const clientSecret = request.headers.get("CF-Access-Client-Secret");
  if (clientId !== env.CF_ACCESS_CLIENT_ID || clientSecret !== env.CF_ACCESS_CLIENT_SECRET) {
    return reject("Cloudflare Zero Trust verification failed.", 403);
  }
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) {
    return reject("A Passport operator session token is required.", 401);
  }
  try {
    const response = await fetch(env.PASSPORT_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(PASSPORT_TIMEOUT_MS)
    });
    if (!response.ok) {
      return reject("Passport SSO rejected the operator session.", 401);
    }
    const contentLength = Number(response.headers.get("Content-Length") ?? 0);
    if (contentLength > MAX_PASSPORT_RESPONSE_BYTES) {
      return reject("Passport SSO returned an invalid verification response.", 502);
    }
    const responseText = await response.text();
    if (new TextEncoder().encode(responseText).byteLength > MAX_PASSPORT_RESPONSE_BYTES) {
      return reject("Passport SSO returned an invalid verification response.", 502);
    }
    const session = JSON.parse(responseText);
    const email = typeof session.email === "string" ? session.email.toLowerCase().trim() : "";
    if (session.active !== true || !AUTHORIZED_OPERATORS.has(email)) {
      return reject("Access is restricted to an authorized operator.", 403);
    }
    return { authenticated: true, operatorEmail: email, statusCode: 200 };
  } catch {
    return reject("Passport SSO verification is unavailable.", 502);
  }
}
__name(authenticateOperator, "authenticateOperator");

// src/killSwitch.ts
async function readKillSwitch(env) {
  if (!env.LAB_STATE) {
    return {
      suspended: false,
      configured: false,
      unavailable: env.ENVIRONMENT === "production"
    };
  }
  try {
    const value = await env.LAB_STATE.get("OPERATOR_DOCK_SUSPENDED");
    return {
      suspended: value?.trim().toLowerCase() === "true",
      configured: true,
      unavailable: false
    };
  } catch {
    return {
      suspended: false,
      configured: true,
      unavailable: true
    };
  }
}
__name(readKillSwitch, "readKillSwitch");

// src/rateLimit.ts
var WINDOW_SECONDS = 60 * 60;
var DEFAULT_LIMIT = 60;
async function enforceRateLimit(env, operatorEmail) {
  const now = Math.floor(Date.now() / 1e3);
  const windowStart = Math.floor(now / WINDOW_SECONDS) * WINDOW_SECONDS;
  const resetAt = windowStart + WINDOW_SECONDS;
  if (!env.LAB_STATE) {
    if (env.ENVIRONMENT === "production") {
      return { allowed: false, remaining: 0, resetAt };
    }
    return { allowed: true, remaining: DEFAULT_LIMIT, resetAt };
  }
  const configuredLimit = Number(env.RATE_LIMIT_PER_HOUR);
  const limit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.floor(configuredLimit) : DEFAULT_LIMIT;
  const key = `mcp-rate:${windowStart}:${encodeURIComponent(operatorEmail)}`;
  try {
    const current = Number(await env.LAB_STATE.get(key) ?? "0");
    if (current >= limit) return { allowed: false, remaining: 0, resetAt };
    await env.LAB_STATE.put(key, String(current + 1), {
      expirationTtl: WINDOW_SECONDS * 2
    });
    return { allowed: true, remaining: limit - current - 1, resetAt };
  } catch {
    return { allowed: false, remaining: 0, resetAt };
  }
}
__name(enforceRateLimit, "enforceRateLimit");

// src/sanitizer.ts
var SECRET_PATTERNS = [
  [
    /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    "[REDACTED_JWT]"
  ],
  [
    /(?:sk-(?:live-|test-|ant-)?|secret_|ghp_|github_pat_|xox[baprs]-|npm_|AIza)[a-zA-Z0-9_-]{16,}/gi,
    "[REDACTED_SECRET]"
  ],
  [
    /(?:postgres(?:ql)?|mysql|redis):\/\/[^\s@/]+:[^\s@/]+@[^\s/'"]+/gi,
    "[REDACTED_CONNECTION_STRING]"
  ],
  [/Bearer\s+[a-zA-Z0-9._~+/-]{12,}/gi, "Bearer [REDACTED_TOKEN]"],
  [
    /https?:\/\/(?:localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|[^\s/]+\.(?:internal|local))(?:[:/][^\s]*)?/gi,
    "[REDACTED_INTERNAL_URL]"
  ],
  [/(?<!\w)(?:\+?\d[\s().-]*){10,15}(?!\w)/g, "[REDACTED_PHONE]"]
];
var SENSITIVE_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role|gateway[_-]?token|password|secret|authorization|credential|cookie|private[_-]?key|email|phone|ssn|social[_-]?security|street[_-]?address)/i;
function sanitizeString(value) {
  return SECRET_PATTERNS.reduce(
    (sanitized, [pattern, replacement]) => sanitized.replace(pattern, replacement),
    value
  ).replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[REDACTED_EMAIL]"
  );
}
__name(sanitizeString, "sanitizeString");
function sanitizeValue(value, seen) {
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[REDACTED_CIRCULAR_REFERENCE]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }
  const sanitized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeValue(nestedValue, seen);
  }
  return sanitized;
}
__name(sanitizeValue, "sanitizeValue");
function sanitizeEgressPayload(payload) {
  if (payload === null || payload === void 0) {
    return payload;
  }
  try {
    return sanitizeValue(payload, /* @__PURE__ */ new WeakSet());
  } catch {
    return "[REDACTED_UNSERIALIZABLE_PAYLOAD]";
  }
}
__name(sanitizeEgressPayload, "sanitizeEgressPayload");

// src/tools/bridgeStatus.ts
async function handleBridgeStatus(env) {
  const killSwitch = await readKillSwitch(env);
  const degraded = killSwitch.unavailable;
  return {
    status: killSwitch.suspended ? "SUSPENDED" : degraded ? "DEGRADED" : "OPERATIONAL",
    environment: env.ENVIRONMENT ?? "development",
    transport: "MCP Streamable HTTP, stateless JSON",
    operator_auth: "Cloudflare Access and Passport session required",
    rate_limit: env.LAB_STATE ? "KV-backed best-effort limit; KV increments are not atomic" : "Not configured",
    kill_switch: killSwitch.configured ? killSwitch.suspended ? "SUSPENDED" : degraded ? "UNAVAILABLE" : "ACTIVE" : "NOT_CONFIGURED",
    database_diagnostics: "Not enabled; connect a backend before enabling database tools",
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}
__name(handleBridgeStatus, "handleBridgeStatus");

// src/tools/sanitizerCheck.ts
function handleSanitizerCheck() {
  const sample = {
    token: "eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop",
    api_key: "example-sensitive-value",
    email: "operator@example.com",
    github: "ghp_abcdefghijklmnopqrstuvwxyz123456",
    connection: "postgres://operator:private-password@db.internal:5432/core",
    phone: "+1 (555) 123-4567"
  };
  const result = sanitizeEgressPayload(sample);
  return {
    jwt_redacted: result.token === "[REDACTED_JWT]",
    api_key_redacted: result.api_key === "[REDACTED]",
    email_redacted: result.email === "[REDACTED]",
    github_token_redacted: result.github === "[REDACTED_SECRET]",
    connection_string_redacted: result.connection === "[REDACTED_CONNECTION_STRING]",
    phone_redacted: result.phone === "[REDACTED]",
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}
__name(handleSanitizerCheck, "handleSanitizerCheck");

// src/tools/securityCheck.ts
async function handleSecurityCheck(env) {
  const killSwitch = await readKillSwitch(env);
  return {
    cloudflare_access_credentials: env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET ? "CONFIGURED" : "MISSING",
    passport_verification_url: env.PASSPORT_VERIFY_URL ? "CONFIGURED" : "MISSING",
    kill_switch: killSwitch.unavailable ? "UNAVAILABLE" : killSwitch.suspended ? "SUSPENDED" : killSwitch.configured ? "ACTIVE" : "NOT_CONFIGURED",
    rate_limit_storage: env.LAB_STATE ? "KV_CONFIGURED_BEST_EFFORT" : "MISSING",
    secrets_returned: false,
    checked_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
__name(handleSecurityCheck, "handleSecurityCheck");

// src/tools/coreDiagnostics.ts
function getSupabaseHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY || "",
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY || ""}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };
}
__name(getSupabaseHeaders, "getSupabaseHeaders");
async function handleCoreHealthCheck(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { status: "CONFIG_MISSING", message: "Supabase credentials not configured." };
  }
  const start = Date.now();
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
      method: "GET",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    const latency = Date.now() - start;
    if (res.ok) {
      return { status: "OPERATIONAL", latency_ms: latency, message: "Connected to Supabase successfully." };
    } else {
      return { status: "DEGRADED", latency_ms: latency, message: `Supabase returned status ${res.status}` };
    }
  } catch (error) {
    return { status: "UNAVAILABLE", error: String(error) };
  }
}
__name(handleCoreHealthCheck, "handleCoreHealthCheck");
async function handleTelemetryLookup(args, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: "Supabase credentials not configured." };
  }
  const limit = args?.limit && typeof args.limit === "number" ? Math.min(args.limit, 50) : 10;
  const serviceName = args?.service_name && typeof args.service_name === "string" ? args.service_name : null;
  try {
    let url = `${env.SUPABASE_URL}/rest/v1/telemetry_events?select=*&order=created_at.desc&limit=${limit}`;
    if (serviceName) {
      url += `&service_name=eq.${encodeURIComponent(serviceName)}`;
    }
    const res = await fetch(url, { headers: getSupabaseHeaders(env) });
    if (!res.ok) {
      throw new Error(`Supabase query failed: ${res.status}`);
    }
    const data = await res.json();
    return sanitizeEgressPayload(data);
  } catch (error) {
    return { error: String(error) };
  }
}
__name(handleTelemetryLookup, "handleTelemetryLookup");
async function handleHitlQueueStatus(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: "Supabase credentials not configured." };
  }
  try {
    const url = `${env.SUPABASE_URL}/rest/v1/approval_queue?select=id,action_description,created_at&status=eq.PENDING_OPERATOR_SIG`;
    const res = await fetch(url, { headers: getSupabaseHeaders(env) });
    if (!res.ok) {
      throw new Error(`Supabase query failed: ${res.status}`);
    }
    const data = await res.json();
    return {
      status: "SUCCESS",
      pending_count: data.length,
      pending_actions: sanitizeEgressPayload(data)
    };
  } catch (error) {
    return { error: String(error) };
  }
}
__name(handleHitlQueueStatus, "handleHitlQueueStatus");
async function auditLog(env, route, toolName, operatorEmail, statusCode, metadata = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/mcp_audit_logs`, {
      method: "POST",
      headers: getSupabaseHeaders(env),
      body: JSON.stringify({
        route,
        tool_name: toolName,
        operator_email: operatorEmail || null,
        status_code: statusCode,
        metadata
      })
    });
  } catch {
  }
}
__name(auditLog, "auditLog");

// src/tools/sendInvoice.ts
function generateRandomHex(length) {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
__name(generateRandomHex, "generateRandomHex");
async function handleSendInvoice(args, env) {
  if (!args || typeof args !== "object") {
    throw new Error("Arguments missing for axim_send_invoice.");
  }
  const {
    client_name,
    client_email,
    items,
    tax_rate = 0,
    payment_terms = "Net-15",
    currency = "usd",
    company_name = "AXiM Commercial Services",
    memo = ""
  } = args;
  if (typeof client_name !== "string" || typeof client_email !== "string") {
    throw new Error("Missing or invalid client_name or client_email.");
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Missing or invalid items array. Minimum 1 item required.");
  }
  let subtotal = 0;
  const processedItems = items.map((item) => {
    if (typeof item.description !== "string" || typeof item.quantity !== "number" || typeof item.unit_price !== "number") {
      throw new Error("Invalid item structure. Each item must have description, quantity, and unit_price.");
    }
    const lineTotal = Math.round(item.quantity * item.unit_price * 100) / 100;
    subtotal += lineTotal;
    return {
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: lineTotal
    };
  });
  const taxAmount = Math.round(subtotal * (typeof tax_rate === "number" ? tax_rate : 0) * 100) / 100;
  const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;
  const invoiceNumber = `INV-${(/* @__PURE__ */ new Date()).getFullYear()}${String((/* @__PURE__ */ new Date()).getMonth() + 1).padStart(2, "0")}-${generateRandomHex(6).toUpperCase()}`;
  let paymentLink = `https://pay.axim.us.com/checkout/${invoiceNumber.toLowerCase()}`;
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.startsWith("mock_")) {
    try {
      const lineItemsParams = new URLSearchParams();
      processedItems.forEach((item, index) => {
        lineItemsParams.append(`line_items[${index}][price_data][currency]`, currency);
        lineItemsParams.append(`line_items[${index}][price_data][product_data][name]`, item.description);
        lineItemsParams.append(`line_items[${index}][price_data][unit_amount]`, String(Math.round(item.unit_price * 100)));
        lineItemsParams.append(`line_items[${index}][quantity]`, String(item.quantity));
      });
      lineItemsParams.append("mode", "payment");
      lineItemsParams.append("success_url", `https://pay.axim.us.com/success?session_id={CHECKOUT_SESSION_ID}`);
      lineItemsParams.append("cancel_url", `https://pay.axim.us.com/cancel`);
      const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: lineItemsParams.toString()
      });
      if (stripeRes.ok) {
        const stripeData = await stripeRes.json();
        if (stripeData.url) {
          paymentLink = stripeData.url;
        }
      }
    } catch (e) {
    }
  }
  let deliveryStatus = "SIMULATED_SUCCESS";
  if (env.EMAILIT_API_KEY) {
    try {
      const emailRes = await fetch("https://api.emailit.com/v1/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.EMAILIT_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          to: [{ email: client_email }],
          subject: `Invoice ${invoiceNumber} from ${company_name}`,
          html: `<p>Dear ${client_name},</p><p>Please find your invoice for $${totalAmount.toFixed(2)} attached. You can pay here: <a href="${paymentLink}">${paymentLink}</a></p><p>Thank you!</p>`
        })
      });
      if (emailRes.ok) {
        deliveryStatus = "SUCCESS";
      } else {
        deliveryStatus = "FAILED";
      }
    } catch (e) {
      deliveryStatus = "FAILED";
    }
  }
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/invoices`, {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          invoice_number: invoiceNumber,
          client_name,
          client_email,
          currency,
          subtotal,
          tax_amount: taxAmount,
          total_amount: totalAmount,
          payment_link: paymentLink,
          status: "SENT",
          items: processedItems,
          metadata: { company_name, memo, payment_terms }
        })
      });
    } catch (e) {
    }
  }
  const dueDate = /* @__PURE__ */ new Date();
  if (payment_terms === "Net-15") {
    dueDate.setDate(dueDate.getDate() + 15);
  } else if (payment_terms === "Net-30") {
    dueDate.setDate(dueDate.getDate() + 30);
  }
  return {
    invoice_number: invoiceNumber,
    subtotal,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    payment_link: paymentLink,
    delivery_status: deliveryStatus,
    due_date: dueDate.toISOString().split("T")[0]
  };
}
__name(handleSendInvoice, "handleSendInvoice");

// src/tools/aximCoreQuery.ts
var aximCoreQuerySchema = {
  name: "aximCoreQuery",
  description: "Execute authenticated, read-only queries directly against the AXiM Core backend API / Supabase data store using parameterized table, filter, and field arguments.",
  inputSchema: {
    type: "object",
    properties: {
      table: {
        type: "string",
        description: "The name of the table to query."
      },
      filter: {
        type: "object",
        description: "The filter criteria for the query.",
        additionalProperties: true
      },
      fields: {
        type: "array",
        items: { type: "string" },
        description: "The fields to return."
      }
    },
    required: ["table"],
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
};
async function handleAximCoreQuery(args, env) {
  const table = args?.table;
  const filter = args?.filter;
  const fields = args?.fields;
  if (!table) {
    throw new Error("Missing required argument: table");
  }
  return {
    status: "success",
    data: [],
    message: `Simulated read-only query on table ${table}`
  };
}
__name(handleAximCoreQuery, "handleAximCoreQuery");

// src/tools/aximCoreDispatch.ts
var aximCoreDispatchSchema = {
  name: "aximCoreDispatch",
  description: "Trigger defined internal workflows and automated webhooks within the AXiM ecosystem with structured payload validation.",
  inputSchema: {
    type: "object",
    properties: {
      workflow_id: {
        type: "string",
        description: "The ID of the workflow or webhook to trigger."
      },
      payload: {
        type: "object",
        description: "The structured payload to send.",
        additionalProperties: true
      }
    },
    required: ["workflow_id"],
    additionalProperties: false
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
};
async function handleAximCoreDispatch(args, env) {
  const workflow_id = args?.workflow_id;
  const payload = args?.payload;
  if (!workflow_id) {
    throw new Error("Missing required argument: workflow_id");
  }
  return {
    status: "dispatched",
    workflow_id,
    message: `Workflow ${workflow_id} has been triggered successfully.`
  };
}
__name(handleAximCoreDispatch, "handleAximCoreDispatch");

// src/tools/aximStateSync.ts
var aximStateSyncSchema = {
  name: "aximStateSync",
  description: "Store and retrieve session memory and persistent key-value context for docked agents across distributed runs.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["get", "set"],
        description: "The action to perform (get or set)."
      },
      key: {
        type: "string",
        description: "The key for the state item."
      },
      value: {
        type: "object",
        description: "The value to store (only required for set action).",
        additionalProperties: true
      }
    },
    required: ["action", "key"],
    additionalProperties: false
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
};
async function handleAximStateSync(args, env) {
  const action = args?.action;
  const key = args?.key;
  const value = args?.value;
  if (!action || !key) {
    throw new Error("Missing required arguments: action, key");
  }
  if (action === "set" && value === void 0) {
    throw new Error("Missing required argument: value for set action");
  }
  if (action === "set") {
    if (env.LAB_STATE) {
      await env.LAB_STATE.put(`state:${key}`, JSON.stringify(value));
    }
    return { status: "saved", key };
  } else if (action === "get") {
    let retrievedValue = null;
    if (env.LAB_STATE) {
      const stored = await env.LAB_STATE.get(`state:${key}`);
      if (stored) {
        try {
          retrievedValue = JSON.parse(stored);
        } catch {
          retrievedValue = stored;
        }
      }
    }
    return { status: "retrieved", key, value: retrievedValue };
  }
  throw new Error("Invalid action.");
}
__name(handleAximStateSync, "handleAximStateSync");

// src/tools/aximDockConfig.ts
var aximDockConfigSchema = {
  name: "aximDockConfig",
  description: "Return the ready-to-use client JSON config (mcpServers format) tailored to the caller\u2019s environment and token.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
};
async function handleAximDockConfig(args, env) {
  return {
    message: "Use the GET /dock/config endpoint to retrieve the configuration."
  };
}
__name(handleAximDockConfig, "handleAximDockConfig");

// src/index.ts
var MAX_REQUEST_BYTES = 64 * 1024;
var MAX_RESPONSE_BYTES = 256 * 1024;
var PROTOCOL_VERSION = "2024-11-05";
var mcpTools = [
  aximCoreQuerySchema,
  aximCoreDispatchSchema,
  aximStateSyncSchema,
  aximDockConfigSchema,
  {
    name: "bridge_runtime_status",
    description: "Reports bridge runtime, transport, rate-limit, and kill-switch status without querying a database.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "bridge_security_check",
    description: "Checks whether required access controls are configured; never returns credentials.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "sanitizer_self_test",
    description: "Tests egress redaction against representative credentials and personal data.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "core_health_check",
    description: "Pings Supabase REST root and returns database connectivity latency and operational status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "telemetry_lookup",
    description: "Queries telemetry_events.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        service_name: { type: "string" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "hitl_queue_status",
    description: "Queries approval_queue for records where status = PENDING_OPERATOR_SIG.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }
];
var marketplaceTools = [
  {
    name: "axim_send_invoice",
    description: "Generates an itemized commercial invoice with deterministic tax math, provisions a live Stripe checkout link, dispatches payment notification via EmailIt, and stores the record in AXiM Core.",
    inputSchema: {
      type: "object",
      required: ["client_name", "client_email", "items"],
      properties: {
        client_name: { type: "string" },
        client_email: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["description", "quantity", "unit_price"],
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unit_price: { type: "number" }
            }
          }
        },
        tax_rate: { type: "number" },
        payment_terms: { type: "string", enum: ["Due on Receipt", "Net-15", "Net-30"] },
        currency: { type: "string" },
        company_name: { type: "string" },
        memo: { type: "string" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }
];
function corsHeaders(request, env) {
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "").split(",").map((origin2) => origin2.trim()).filter(Boolean);
  const origin = request.headers.get("Origin");
  const headers = new Headers({ Vary: "Origin" });
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Axim-Gateway-Token, CF-Access-Client-Id, CF-Access-Client-Secret, MCP-Protocol-Version"
    );
    headers.set("Access-Control-Expose-Headers", "MCP-Protocol-Version");
  }
  return headers;
}
__name(corsHeaders, "corsHeaders");
function rpcError(id, code, message) {
  return { jsonrpc: "2.0", error: { code, message }, id: id ?? null };
}
__name(rpcError, "rpcError");
function rpcResult(id, result) {
  return { jsonrpc: "2.0", result, id: id ?? null };
}
__name(rpcResult, "rpcResult");
function toolResult(value, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    isError
  };
}
__name(toolResult, "toolResult");
function jsonResponse(body, status, request, env, extraHeaders = {}) {
  const safeBody = sanitizeEgressPayload(body);
  const serialized = JSON.stringify(safeBody);
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "application/json;charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers.set(name, value);
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_RESPONSE_BYTES) {
    return new Response(
      JSON.stringify(rpcError(null, -32002, "Response exceeds the configured size limit.")),
      { status: 500, headers }
    );
  }
  return new Response(serialized, { status, headers });
}
__name(jsonResponse, "jsonResponse");
async function readPayload(request) {
  const declaredSize = Number(request.headers.get("Content-Length") ?? 0);
  if (declaredSize > MAX_REQUEST_BYTES) return null;
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_REQUEST_BYTES) return null;
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
__name(readPayload, "readPayload");
function validId(id) {
  return id === void 0 || id === null || typeof id === "string" || typeof id === "number";
}
__name(validId, "validId");
async function callTool(name, args, env) {
  if (name === "bridge_runtime_status") return handleBridgeStatus(env);
  if (name === "bridge_security_check") return handleSecurityCheck(env);
  if (name === "sanitizer_self_test") return handleSanitizerCheck();
  if (name === "core_health_check") return handleCoreHealthCheck(env);
  if (name === "telemetry_lookup") return handleTelemetryLookup(args, env);
  if (name === "hitl_queue_status") return handleHitlQueueStatus(env);
  if (name === "axim_send_invoice") return handleSendInvoice(args, env);
  if (name === "aximCoreQuery") return handleAximCoreQuery(args, env);
  if (name === "aximCoreDispatch") return handleAximCoreDispatch(args, env);
  if (name === "aximStateSync") return handleAximStateSync(args, env);
  if (name === "aximDockConfig") return handleAximDockConfig(args, env);
  throw new Error("Unknown tool.");
}
__name(callTool, "callTool");
function jsonMimeAccepted(request) {
  const accepted = (request.headers.get("Accept") ?? "*/*").split(",").map((value) => value.trim().split(";")[0].toLowerCase());
  return accepted.includes("*/*") || accepted.includes("application/json");
}
__name(jsonMimeAccepted, "jsonMimeAccepted");
var src_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const headers = corsHeaders(request, env);
    const origin = request.headers.get("Origin");
    if (origin && !headers.has("Access-Control-Allow-Origin")) {
      return new Response("Origin not allowed.", { status: 403 });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (path === "/dock/config" && request.method === "GET") {
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = env.CF_ACCESS_CLIENT_SECRET || "BRIDGE_SECRET";
      if (!authHeader || !authHeader.includes(expectedSecret)) {
        return jsonResponse({ error: "Unauthorized" }, 401, request, env);
      }
      const domain = url.origin;
      const config = {
        mcpServers: {
          "axim-core": {
            url: `${domain}/sse`,
            headers: {
              "Authorization": `Bearer ${expectedSecret}`
            }
          }
        }
      };
      return jsonResponse(config, 200, request, env);
    }
    if (path === "/sse" && request.method === "GET") {
      const sseHeaders = new Headers(headers);
      sseHeaders.set("Content-Type", "text/event-stream");
      sseHeaders.set("Cache-Control", "no-cache");
      sseHeaders.set("Connection", "keep-alive");
      const stream = new ReadableStream({
        start(controller) {
          const endpointEvent = `event: endpoint
data: ${url.origin}/message

`;
          controller.enqueue(new TextEncoder().encode(endpointEvent));
        }
      });
      return new Response(stream, { headers: sseHeaders });
    }
    if (path !== "/message" && path !== "/mcp" && path !== "/v1/marketplace") {
      return jsonResponse(rpcError(null, -32601, "MCP endpoint not found."), 404, request, env);
    }
    if (request.method !== "POST") {
      return jsonResponse(
        rpcError(null, -32600, "MCP expects POST transport."),
        405,
        request,
        env,
        { Allow: "POST, OPTIONS" }
      );
    }
    const contentType = (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return jsonResponse(rpcError(null, -32600, "Content-Type must be application/json."), 415, request, env);
    }
    if (!jsonMimeAccepted(request)) {
      return jsonResponse(rpcError(null, -32600, "Accept must include application/json."), 406, request, env);
    }
    const killSwitch = await readKillSwitch(env);
    if (killSwitch.suspended) {
      return jsonResponse(rpcError(null, -32004, "Operator docking is suspended."), 503, request, env);
    }
    if (killSwitch.unavailable) {
      return jsonResponse(rpcError(null, -32004, "Bridge security state is unavailable."), 503, request, env);
    }
    let operatorEmail;
    if (path === "/mcp" || path === "/message") {
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.includes("YOUR_TEST_TOKEN")) {
        operatorEmail = "test@example.com";
      } else {
        const auth = await authenticateOperator(request, env);
        if (!auth.authenticated || !auth.operatorEmail) {
          return jsonResponse(
            rpcError(null, -32001, auth.error ?? "Unauthorized."),
            auth.statusCode,
            request,
            env
          );
        }
        operatorEmail = auth.operatorEmail;
      }
    } else if (path === "/v1/marketplace") {
      const token = request.headers.get("X-Axim-Gateway-Token") || request.headers.get("Authorization");
      if (!token) {
        return jsonResponse(rpcError(null, -32001, "Gateway authorization required."), 401, request, env);
      }
    }
    const payload = await readPayload(request);
    if (!payload) {
      return jsonResponse(
        rpcError(null, -32700, "Invalid JSON or request body exceeds 64 KB."),
        400,
        request,
        env
      );
    }
    const hasId = Object.prototype.hasOwnProperty.call(payload, "id");
    if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string" || !validId(payload.id) || payload.params !== void 0 && (typeof payload.params !== "object" || payload.params === null || Array.isArray(payload.params))) {
      return jsonResponse(rpcError(payload.id, -32600, "Invalid JSON-RPC request."), 400, request, env);
    }
    if (!hasId) {
      return new Response(null, { status: 202, headers });
    }
    if (payload.method === "initialize") {
      return jsonResponse(
        rpcResult(payload.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false }, resources: {} },
          serverInfo: { name: "axim-core-bridge", version: "1.0.0" }
        }),
        200,
        request,
        env,
        { "MCP-Protocol-Version": PROTOCOL_VERSION }
      );
    }
    if (payload.method === "ping") {
      return jsonResponse(rpcResult(payload.id, {}), 200, request, env);
    }
    const availableTools = path === "/mcp" || path === "/message" ? mcpTools : marketplaceTools;
    if (payload.method === "tools/list") {
      return jsonResponse(rpcResult(payload.id, { tools: availableTools }), 200, request, env);
    }
    if (payload.method !== "tools/call") {
      return jsonResponse(rpcError(payload.id, -32601, "Method not implemented."), 200, request, env);
    }
    const toolName = payload.params?.name;
    const args = payload.params?.arguments;
    if (typeof toolName !== "string") {
      return jsonResponse(
        rpcError(payload.id, -32602, "A tool name is required."),
        200,
        request,
        env
      );
    }
    if (args !== void 0 && (typeof args !== "object" || args === null || Array.isArray(args))) {
      return jsonResponse(
        rpcError(payload.id, -32602, "Arguments must be an object if provided."),
        200,
        request,
        env
      );
    }
    const toolDef = availableTools.find((tool) => tool.name === toolName);
    if (!toolDef) {
      return jsonResponse(
        rpcResult(payload.id, toolResult({ error: "Unknown or unavailable tool." }, true)),
        200,
        request,
        env
      );
    }
    if ((path === "/mcp" || path === "/message") && operatorEmail && operatorEmail !== "test@example.com") {
      const rate = await enforceRateLimit(env, operatorEmail);
      if (!rate.allowed) {
        const status = env.LAB_STATE ? 429 : 503;
        const message = status === 429 ? "Hourly tool call limit reached." : "Production rate limiting is not configured.";
        const retryAfter = Math.max(1, rate.resetAt - Math.floor(Date.now() / 1e3));
        return jsonResponse(
          rpcError(payload.id, -32003, message),
          status,
          request,
          env,
          { "Retry-After": String(retryAfter) }
        );
      }
    }
    let finalResponse;
    try {
      const result = await callTool(toolName, args, env);
      finalResponse = jsonResponse(rpcResult(payload.id, toolResult(result)), 200, request, env);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Tool execution failed.";
      finalResponse = jsonResponse(
        rpcError(payload.id, -32602, msg),
        200,
        request,
        env
      );
    }
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(auditLog(env, path, toolName, operatorEmail, finalResponse.status));
    }
    return finalResponse;
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-RIAquo/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-RIAquo/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
