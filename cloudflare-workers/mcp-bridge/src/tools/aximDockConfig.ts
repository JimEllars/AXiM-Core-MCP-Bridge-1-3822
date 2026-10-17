import { Env } from '../types';

export const aximDockConfigSchema = {
  name: 'aximDockConfig',
  description: 'Return the ready-to-use client JSON config (mcpServers format) tailored to the caller’s environment and token.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
};

export function handleAximDockConfig(env: Env, requestUrl: string) {
  const origin = new URL(requestUrl).origin;
  return {
    mcpServers: {
      "axim-core-internal": {
        type: "streamable-http",
        url: `${origin}/mcp`,
        headers: {
          "CF-Access-Client-Id": "<YOUR_CF_ACCESS_CLIENT_ID>",
          "CF-Access-Client-Secret": "<YOUR_CF_ACCESS_CLIENT_SECRET>",
          "Authorization": "Bearer <YOUR_PASSPORT_TOKEN>"
        }
      }
    },
    instructions: "Use the streamable-http /mcp endpoint (e.g. mcpo --config config.json). Replace the placeholders with the Cloudflare Access service token and a Passport operator bearer token."
  };
}