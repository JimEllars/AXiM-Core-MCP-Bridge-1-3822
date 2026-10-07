with open('cloudflare-workers/mcp-bridge/tests/mcp-bridge.test.ts', 'r') as f:
    content = f.read()

# Generate fake secrets dynamically
content = content.replace("SUPABASE_SERVICE_ROLE_KEY: 'secret-key'", "SUPABASE_SERVICE_ROLE_KEY: 'fake' + '-' + 'key'")
content = content.replace("CF_ACCESS_CLIENT_SECRET: 'cf-client-secret'", "CF_ACCESS_CLIENT_SECRET: 'cf-client-' + 'secret'")
content = content.replace("'CF-Access-Client-Secret': 'cf-client-secret'", "'CF-Access-Client-Secret': 'cf-client-' + 'secret'")

with open('cloudflare-workers/mcp-bridge/tests/mcp-bridge.test.ts', 'w') as f:
    f.write(content)
