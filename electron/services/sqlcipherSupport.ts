import { execFileSync } from 'child_process'
import { existsSync } from 'fs'

let cachedBinaryPath: string | null | undefined

const CANDIDATE_PATHS = [
  process.env.SQLCIPHER_BIN,
  '/opt/homebrew/bin/sqlcipher',
  '/usr/local/bin/sqlcipher',
  '/usr/bin/sqlcipher'
].filter(Boolean) as string[]

export function getSqlcipherBinaryPath(): string | null {
  if (cachedBinaryPath !== undefined) return cachedBinaryPath

  for (const candidate of CANDIDATE_PATHS) {
    if (candidate && existsSync(candidate)) {
      cachedBinaryPath = candidate
      return candidate
    }
  }

  try {
    const resolved = execFileSync('which', ['sqlcipher'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    cachedBinaryPath = resolved || null
    return cachedBinaryPath
  } catch {
    cachedBinaryPath = null
    return null
  }
}

export function isSqlcipherAvailable(): boolean {
  return Boolean(getSqlcipherBinaryPath())
}

export function escapeSqlString(value: string): string {
  return String(value || '').replace(/'/g, "''")
}
