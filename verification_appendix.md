### Verification Appendix

#### Target files and modified line ranges
- `cloudflare-workers/mcp-bridge/supabase/migrations/20261011000000_core_observability_schema.sql` (Appended lines for `public.ecosystem_nodes`)
- `cloudflare-workers/mcp-bridge/src/tools/coreObservability.ts` (Added `handleEcosystemStatus` at the end)
- `cloudflare-workers/mcp-bridge/src/tools/manifest.ts` (Added `axim_ecosystem_status` to tool list)
- `cloudflare-workers/mcp-bridge/src/index.ts` (Wired `axim_ecosystem_status` routing)
- `src/App.jsx` (Added state for `rateLimit` and `nodes`, updated `handleRunTool` and `handleHealthProbe` to read headers, injected `Ecosystem Nodes` rendering section)
- `cloudflare-workers/mcp-bridge/tests/mcp-bridge.test.ts` (Added unit test for `axim_ecosystem_status` and incremented expected tool count)

#### Snippet of handleEcosystemStatus query logic and UI Rate Limit extraction

**Query Logic:**
```typescript
export async function handleEcosystemStatus(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Supabase credentials are not configured.' };
  }
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ecosystem_nodes?select=node_id,name,role,status,last_heartbeat&order=name.asc`, {
      headers: getSupabaseHeaders(env),
      signal: AbortSignal.timeout(4000)
    });
...
```

**UI Extraction:**
```javascript
const remaining = res.headers.get('X-RateLimit-Remaining');
if (remaining) {
  setRateLimit(remaining);
}
```

#### Vitest output summary
```
> axim-core-mcp@1.0.0 test
> vitest run

 RUN  v5.0.3 /app/cloudflare-workers/mcp-bridge

 ✓ tests/rateLimit.test.ts (3 tests) 11ms
 ✓ tests/mcp-bridge.test.ts (21 tests) 83ms

 Test Files  2 passed (2)
      Tests  24 passed (24)
```
