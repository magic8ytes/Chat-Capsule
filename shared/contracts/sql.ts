const LEADING_SQL_COMMENT_PATTERN = /^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/
const DISALLOWED_SQL_PATTERN = /\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|ATTACH|DETACH|VACUUM|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|REINDEX|ANALYZE|TRUNCATE|MERGE|UPSERT)\b/i

function stripLeadingComments(value: string): string {
  let current = value
  while (true) {
    const next = current.replace(LEADING_SQL_COMMENT_PATTERN, '')
    if (next === current) return current.trim()
    current = next
  }
}

export function isReadonlySql(value: unknown): boolean {
  const sql = stripLeadingComments(String(value || ''))
  if (!sql) return false
  const normalized = sql.replace(/;+\s*$/, '').trim()
  if (!normalized || normalized.includes(';')) return false
  if (DISALLOWED_SQL_PATTERN.test(normalized)) return false
  if (/^PRAGMA\b/i.test(normalized) && normalized.includes('=')) return false
  return /^(SELECT|PRAGMA)\b/i.test(normalized)
}

export function assertReadonlySql(value: unknown): string {
  const sql = stripLeadingComments(String(value || ''))
  const normalized = sql.replace(/;+\s*$/, '').trim()
  if (!isReadonlySql(normalized)) {
    throw new Error('仅允许执行只读 SQL 查询')
  }
  return normalized
}
