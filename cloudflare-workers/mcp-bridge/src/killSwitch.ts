import type {Env} from './types';

export interface KillSwitchStatus {
  suspended: boolean;
  configured: boolean;
  unavailable: boolean;
}

export async function readKillSwitch(env: Env): Promise<KillSwitchStatus> {
  if (!env.LAB_STATE) {
    const isProduction = env.ENVIRONMENT === 'production';
    const requireKv = isProduction && env.DISABLE_KV_REQUIREMENT !== 'true';

    if (requireKv) {
      return {
        suspended: false,
        configured: false,
        unavailable: true
      };
    } else {
      return {
        suspended: false,
        configured: false,
        unavailable: false
      };
    }
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
