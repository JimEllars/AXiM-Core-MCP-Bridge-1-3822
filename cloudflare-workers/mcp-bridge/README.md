# AXiM Core MCP Bridge

A stateless Cloudflare Worker MCP endpoint at `/mcp`. The current build provides local runtime and security checks; it does not expose write operations or database-backed tools.

## Local checks

From this directory:

```sh
npm install
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

## Production configuration

1. Configure `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` as Wrangler secrets.
2. Bind an existing Cloudflare KV namespace as `LAB_STATE` in `wrangler.toml`. Do not deploy production without a real namespace ID.
3. Keep the `OPERATOR_DOCK_SUSPENDED` value unset or `false` for normal operation. Set it to `true` to activate the emergency kill switch.
4. Deploy with `npm run deploy`.

The worker fails closed in production when its KV kill-switch binding is unavailable. KV-based hourly rate limiting is best-effort because KV read/write increments are not atomic.

## Authentication

Requests require matching Cloudflare Access service-token headers and an active Passport bearer session belonging to an authorized operator. Configure the Cloudflare credentials as Worker secrets; the Passport verification URL is a non-secret variable in `wrangler.toml`.

Never put credentials in client-side code, source control, or a `VITE_` variable.

## Current tools

- `bridge_runtime_status`: reports runtime and kill-switch state.
- `bridge_security_check`: reports whether security controls are configured without returning credentials.
- `sanitizer_self_test`: verifies common secret and personal-data redactions.

The bridge currently has no connected database. Telemetry, ecosystem, HITL queue, and persistent audit tools are intentionally not enabled until a backend is connected and configured.
