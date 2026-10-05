const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [
    /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    '[REDACTED_JWT]'
  ],
  [
    /(?:sk-(?:live-|test-|ant-)?|secret_|ghp_|github_pat_|xox[baprs]-|npm_|AIza)[a-zA-Z0-9_-]{16,}/gi,
    '[REDACTED_SECRET]'
  ],
  [
    /(?:postgres(?:ql)?|mysql|redis):\/\/[^\s@/]+:[^\s@/]+@[^\s/'"]+/gi,
    '[REDACTED_CONNECTION_STRING]'
  ],
  [/Bearer\s+[a-zA-Z0-9._~+/-]{12,}/gi, 'Bearer [REDACTED_TOKEN]'],
  [
    /https?:\/\/(?:localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|[^\s/]+\.(?:internal|local))(?:[:/][^\s]*)?/gi,
    '[REDACTED_INTERNAL_URL]'
  ],
  [/(?<!\w)(?:\+?\d[\s().-]*){10,15}(?!\w)/g, '[REDACTED_PHONE]']
];

const SENSITIVE_KEY =
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role|gateway[_-]?token|password|secret|authorization|credential|cookie|private[_-]?key|email|phone|ssn|social[_-]?security|street[_-]?address)/i;

function sanitizeString(value: string): string {
  return SECRET_PATTERNS.reduce(
    (sanitized, [pattern, replacement]) => sanitized.replace(pattern, replacement),
    value
  ).replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    '[REDACTED_EMAIL]'
  );
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[REDACTED_CIRCULAR_REFERENCE]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_KEY.test(key)
      ? '[REDACTED]'
      : sanitizeValue(nestedValue, seen);
  }

  return sanitized;
}

export function sanitizeEgressPayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) {
    return payload;
  }

  try {
    return sanitizeValue(payload, new WeakSet<object>());
  } catch {
    return '[REDACTED_UNSERIALIZABLE_PAYLOAD]';
  }
}
