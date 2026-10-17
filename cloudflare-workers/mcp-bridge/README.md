# AXiM Core MCP Bridge

A stateless Cloudflare Worker MCP endpoint at `/mcp`.

## Local checks

From this directory:

```sh
npm install --legacy-peer-deps
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

## Production configuration

1. Configure `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` as Wrangler secrets.
2. `LAB_STATE` is bound to the dedicated `AXIM_CORE_MCP_STATE` namespace. Do not remove this binding: production fails closed when the kill-switch state is unavailable.
3. Keep the `OPERATOR_DOCK_SUSPENDED` value unset or `false` for normal operation. Set it to `true` to activate the emergency kill switch.
4. Deploy with `npm run deploy`.

The Worker is intentionally inaccessible until its two authentication secrets are configured. Set both through Wrangler's secure interactive prompts, then deploy:

```sh
npx wrangler secret put CF_ACCESS_CLIENT_ID
npx wrangler secret put CF_ACCESS_CLIENT_SECRET
npm run deploy
```

`SUPABASE_SERVICE_ROLE_KEY` is also required to activate the Core health, telemetry, and HITL tools. The bridge otherwise remains available, but those three tools report that their backend is not configured.

After deployment, use the Worker URL's `/mcp` endpoint (streamable HTTP) as the MCP server URL. The legacy `/sse` endpoint only announces a session; tool responses are returned on the POST, so legacy SSE-only clients (which expect replies on the stream) will not work. The authenticated `/dock/config` endpoint returns a ready-to-use client configuration using that same origin.

The worker fails closed in production when its KV kill-switch binding is unavailable. KV-based hourly rate limiting is best-effort because KV read/write increments are not atomic.

## Readiness notes

- Verified: worker tests (23), typecheck, frontend lint and build all pass.
- `POST /message` now requires `sessionId`, so session revocation can no longer be bypassed by omitting it.
- The MCPO connector app is not in this repository, so it was not reviewed. Add its source or config to wire it in.
- `STRIPE_SECRET_KEY` and `EMAILIT_API_KEY` are declared in `Env` but unused by any tool.
- MCPO/Claude: point at `/mcp` with `type: streamable-http` and send `CF-Access-Client-Id`, `CF-Access-Client-Secret` and `Authorization: Bearer <Passport token>` headers.
- Still to do: set `SUPABASE_SERVICE_ROLE_KEY` and the Cloudflare Access secrets with `wrangler secret put`, then run `npm run deploy`.
- Rate limiting is best-effort because KV increments are not atomic. Consider a Durable Object for strict limits.

## Authentication

Requests require matching Cloudflare Access service-token headers and an active Passport bearer session belonging to an authorized operator. Configure the Cloudflare credentials as Worker secrets; the Passport verification URL is a non-secret variable in `wrangler.toml`.

Never put credentials in client-side code, source control, or a `VITE_` variable.

## Current tools

- `bridge_runtime_status`: Worker runtime, KV state, and rate-limit tracking.
- `bridge_security_check`: Cloudflare Access, Passport URL, and KV configuration validation.
- `sanitizer_self_test`: Verification of secret, token, and PII egress redaction.
- `aximDockConfig`: Generates client mcpServers configuration blocks.
- `core_health_check`: Live Supabase Core REST connectivity and latency probe.
- `telemetry_lookup`: Live queries to public.telemetry_events with redaction.
- `hitl_queue_status`: Live queries to public.approval_queue for pending approvals.
