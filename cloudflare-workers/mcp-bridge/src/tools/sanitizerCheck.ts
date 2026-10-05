import {sanitizeEgressPayload} from '../sanitizer';

export function handleSanitizerCheck() {
  const sample = {
    token: 'eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop',
    api_key: 'example-sensitive-value',
    email: 'operator@example.com',
    github: 'ghp_abcdefghijklmnopqrstuvwxyz123456',
    connection: 'postgres://operator:private-password@db.internal:5432/core',
    phone: '+1 (555) 123-4567'
  };
  const result = sanitizeEgressPayload(sample) as Record<string, string>;

  return {
    jwt_redacted: result.token === '[REDACTED_JWT]',
    api_key_redacted: result.api_key === '[REDACTED]',
    email_redacted: result.email === '[REDACTED]',
    github_token_redacted: result.github === '[REDACTED_SECRET]',
    connection_string_redacted: result.connection === '[REDACTED_CONNECTION_STRING]',
    phone_redacted: result.phone === '[REDACTED]',
    timestamp: new Date().toISOString()
  };
}
