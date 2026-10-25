import type {Env} from '../types';
import {readKillSwitch} from '../killSwitch';
import {getAccessCredentials} from '../auth';

export async function handleSecurityCheck(env: Env) {
  const killSwitch = await readKillSwitch(env);

  return {
    cloudflare_access_credentials:     getAccessCredentials(env).id && getAccessCredentials(env).secret
      ? 'CONFIGURED'
      : 'MISSING',
    passport_verification_url: env.PASSPORT_VERIFY_URL ? 'CONFIGURED' : 'MISSING',
    kill_switch: killSwitch.unavailable
      ? 'UNAVAILABLE'
      : killSwitch.suspended
        ? 'SUSPENDED'
        : killSwitch.configured
          ? 'ACTIVE'
          : 'NOT_CONFIGURED',
    rate_limit_storage: env.LAB_STATE ? 'KV_CONFIGURED_BEST_EFFORT' : 'MISSING',
    secrets_returned: false,
    checked_at: new Date().toISOString()
  };
}
