export const AUDIT_REDACTED_VALUE = '[REDACTED]'

const SENSITIVE_FIELD_PATTERN = /(^|_|-)(token|password|secret|authorization|cookie|apikey|accesskey|refreshkey|decryptkey|encaeskey|encauth|enc_key|salt)(_|-|$)/i
const EXPLICIT_SENSITIVE_FIELDS = new Set([
  'token',
  'password',
  'secret',
  'authorization',
  'cookie',
  'apiKey',
  'accessKey',
  'refreshKey',
  'decryptKey',
  'imageAesKey',
  'enc_key',
  'salt'
])

export function isSensitiveAuditField(fieldName: string): boolean {
  const normalized = String(fieldName || '').trim()
  if (!normalized) return false
  if (EXPLICIT_SENSITIVE_FIELDS.has(normalized)) return true
  return SENSITIVE_FIELD_PATTERN.test(normalized)
}

export function redactAuditValue(value: unknown, fieldName?: string): unknown {
  if (fieldName && isSensitiveAuditField(fieldName)) {
    return AUDIT_REDACTED_VALUE
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        redactAuditValue(child, key)
      ])
    )
  }

  return value
}
