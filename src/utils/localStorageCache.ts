import type { ZodType } from 'zod'

function getStorage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

export function readJsonStorage<T>(key: string): T | null {
  try {
    const raw = getStorage('local')?.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function readJsonStorageWithSchema<T>(key: string, schema: ZodType<T>): T | null {
  const payload = readJsonStorage<unknown>(key)
  if (payload == null) return null
  const result = schema.safeParse(payload)
  return result.success ? result.data : null
}

export function writeJsonStorage(key: string, value: unknown): boolean {
  try {
    getStorage('local')?.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function readStringStorage(key: string): string | null {
  try {
    return getStorage('local')?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeStringStorage(key: string, value: string): boolean {
  try {
    getStorage('local')?.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeStorageKey(key: string): boolean {
  try {
    getStorage('local')?.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function readJsonSessionStorage<T>(key: string): T | null {
  try {
    const raw = getStorage('session')?.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function readJsonSessionStorageWithSchema<T>(key: string, schema: ZodType<T>): T | null {
  const payload = readJsonSessionStorage<unknown>(key)
  if (payload == null) return null
  const result = schema.safeParse(payload)
  return result.success ? result.data : null
}

export function writeJsonSessionStorage(key: string, value: unknown): boolean {
  try {
    getStorage('session')?.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeSessionStorageKey(key: string): boolean {
  try {
    getStorage('session')?.removeItem(key)
    return true
  } catch {
    return false
  }
}
