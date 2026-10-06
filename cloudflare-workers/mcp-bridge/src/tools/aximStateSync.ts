import { Env } from '../types';

export const aximStateSyncSchema = {
  name: 'aximStateSync',
  description: 'Store and retrieve session memory and persistent key-value context for docked agents across distributed runs.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['get', 'set'],
        description: 'The action to perform (get or set).'
      },
      key: {
        type: 'string',
        description: 'The key for the state item.'
      },
      value: {
        type: 'object',
        description: 'The value to store (only required for set action).',
        additionalProperties: true
      }
    },
    required: ['action', 'key'],
    additionalProperties: false
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
};

export async function handleAximStateSync(args: Record<string, unknown> | undefined, env: Env): Promise<unknown> {
  const action = args?.action as string;
  const key = args?.key as string;
  const value = args?.value;

  if (!action || !key) {
    throw new Error('Missing required arguments: action, key');
  }

  if (action === 'set' && value === undefined) {
    throw new Error('Missing required argument: value for set action');
  }

  if (action === 'set') {
     if (env.LAB_STATE) {
       await env.LAB_STATE.put(`state:${key}`, JSON.stringify(value));
     }
     return { status: 'saved', key };
  } else if (action === 'get') {
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
     return { status: 'retrieved', key, value: retrievedValue };
  }

  throw new Error('Invalid action.');
}
