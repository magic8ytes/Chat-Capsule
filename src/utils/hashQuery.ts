export function getHashQueryParams(hash: string = window.location.hash): URLSearchParams {
  const queryIndex = hash.indexOf('?')
  return new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : '')
}

export function getHashQueryParam(name: string, hash?: string): string | null {
  return getHashQueryParams(hash).get(name)
}

export function getHashQueryInt(name: string, fallback: number, hash?: string): number {
  const raw = getHashQueryParam(name, hash)
  const parsed = raw ? Number.parseInt(raw, 10) : fallback
  return Number.isNaN(parsed) ? fallback : parsed
}
