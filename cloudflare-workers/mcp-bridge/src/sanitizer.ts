const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '[REDACTED_JWT]'],
  [/(?:sk-|secret_|ghp_|github_pat_|xox[baprs]-|npm_)[a-zA-Z0-9_-]{16,}/gi, '[REDACTED_SECRET]'],
  [/postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@[^\s/'"]+/gi, 'postgres://[REDACTED]'],
  [/Bearer\s+[a-zA-Z0-9._~+/-]{12,}/gi, 'Bearer [REDACTED_TOKEN]'],
  [/(["']?(?:[^"']*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key|gateway[_-]?token|password|secret|authorization)[^"']*)["']?\s*:\s*["'])[^"']*(["'])/gi, '$1[REDACTED]$2'],
  [/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key|gateway[_-]?token|password|secret)\s*[:=]\s*)[^\s,"'}\]]+/gi, '$1[REDACTED]'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]']
];

export function sanitizeEgressPayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;

  const serialized = typeof payload === 'string'
    ? payload
    : JSON.stringify(payload);

  const sanitized = REDACTION_PATTERNS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    serialized
  );

  if (typeof payload === 'string') return sanitized;

  try {
    return JSON.parse(sanitized) as unknown;
  } catch {
    return '[REDACTED_UNSERIALIZABLE_PAYLOAD]';
  }
}
