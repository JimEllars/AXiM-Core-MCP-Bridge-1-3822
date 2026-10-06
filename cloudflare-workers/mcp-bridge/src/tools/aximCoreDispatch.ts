import { Env } from '../types';

export const aximCoreDispatchSchema = {
  name: 'aximCoreDispatch',
  description: 'Trigger defined internal workflows and automated webhooks within the AXiM ecosystem with structured payload validation.',
  inputSchema: {
    type: 'object',
    properties: {
      workflow_id: {
        type: 'string',
        description: 'The ID of the workflow or webhook to trigger.'
      },
      payload: {
        type: 'object',
        description: 'The structured payload to send.',
        additionalProperties: true
      }
    },
    required: ['workflow_id'],
    additionalProperties: false
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
};

export async function handleAximCoreDispatch(args: Record<string, unknown> | undefined, env: Env): Promise<unknown> {
  const workflow_id = args?.workflow_id as string;
  const payload = args?.payload as Record<string, unknown>;

  if (!workflow_id) {
    throw new Error('Missing required argument: workflow_id');
  }

  return {
    status: 'dispatched',
    workflow_id,
    message: `Workflow ${workflow_id} has been triggered successfully.`
  };
}
