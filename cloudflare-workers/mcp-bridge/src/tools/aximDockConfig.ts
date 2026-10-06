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

export async function handleAximDockConfig(args: Record<string, unknown> | undefined, env: Env): Promise<unknown> {
  return {
    message: "Use the GET /dock/config endpoint to retrieve the configuration."
  };
}
