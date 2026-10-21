import type {Env} from './types';

export interface KillSwitchStatus {
  suspended: boolean;
  configured: boolean;
  unavailable: boolean;
}

export async function readKillSwitch(env: Env): Promise<KillSwitchStatus> {
  if (!env.LAB_STATE) {
    return {
      suspended: false,
      configured: false,
      unavailable: env.ENVIRONMENT === 'production'
    };
  }

  try {
    const value = await env.LAB_STATE.get('OPERATOR_DOCK_SUSPENDED');
    return {
      suspended: value?.trim().toLowerCase() === 'true',
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
