import {sanitizeEgressPayload} from '../sanitizer';

export function handleSanitizerCheck() {
  const sample = {
    token: 'eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop',
    api_key: 'example-sensitive-value',
    email: 'operator@example.com',
    github: 'ghp_abcdefghijklmnopqrstuvwxyz123456'
  };
  const result = sanitizeEgressPayload(sample) as Record<string, string>;

  return {
    jwt_redacted: result.token === '[REDACTED_JWT]',
    api_key_redacted: result.api_key === '[REDACTED]',
    email_redacted: result.email === '[REDACTED_EMAIL]',
    github_token_redacted: result.github === '[REDACTED_SECRET]',
    timestamp: new Date().toISOString()
  };
}
