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
        url: `${origin}/sse`,
        headers: {
          "CF-Access-Client-Id": "<YOUR_CF_ACCESS_CLIENT_ID>",
          "CF-Access-Client-Secret": "<YOUR_CF_ACCESS_CLIENT_SECRET>",
          "Authorization": "Bearer <YOUR_PASSPORT_TOKEN>"
        }
      }
    },
    instructions: "Paste this JSON into your claude_desktop_config.json under 'mcpServers' to dock directly into AXiM Core."
  };
}