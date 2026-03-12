export const DEFAULT_ACCOUNT_SCOPE = 'default'

export function buildAccountScope(dbPath?: unknown, wxid?: unknown): string {
  const normalizedDbPath = String(dbPath || '').trim()
  const normalizedWxid = String(wxid || '').trim()
  if (!normalizedDbPath && !normalizedWxid) {
    return DEFAULT_ACCOUNT_SCOPE
  }
  return `${normalizedDbPath}::${normalizedWxid}`
}
