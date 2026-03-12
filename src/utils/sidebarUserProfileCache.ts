import { z } from 'zod'
import { readJsonSessionStorageWithSchema, removeSessionStorageKey, writeJsonSessionStorage } from './localStorageCache.ts'

export interface SidebarUserProfile {
  wxid: string
  displayName: string
  alias?: string
  avatarUrl?: string
}

const optionalTrimmedStringSchema = z.preprocess((value) => {
  if (value == null) return undefined
  return typeof value === 'string' ? value.trim() : value
}, z.string().min(1).optional())

const sidebarUserProfileCacheSchema = z.object({
  wxid: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  alias: optionalTrimmedStringSchema,
  avatarUrl: optionalTrimmedStringSchema,
  updatedAt: z.number().finite().optional()
}).passthrough()

export const SIDEBAR_USER_PROFILE_CACHE_KEY = 'sidebar_user_profile_cache_v1'

export function normalizeAccountId(value?: string | null): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (trimmed.toLowerCase().startsWith('wxid_')) {
    const match = trimmed.match(/^(wxid_[^_]+)/i)
    return match?.[1] || trimmed
  }
  const suffixMatch = trimmed.match(/^(.+)_([a-zA-Z0-9]{4})$/)
  return suffixMatch ? suffixMatch[1] : trimmed
}

export function readSidebarUserProfileCache(): SidebarUserProfile | null {
  const parsed = readJsonSessionStorageWithSchema(SIDEBAR_USER_PROFILE_CACHE_KEY, sidebarUserProfileCacheSchema)
  if (!parsed) return null
  return {
    wxid: parsed.wxid,
    displayName: parsed.displayName,
    alias: parsed.alias,
    avatarUrl: parsed.avatarUrl
  }
}

export function writeSidebarUserProfileCache(profile: SidebarUserProfile): boolean {
  if (!profile.wxid || !profile.displayName) return false
  return writeJsonSessionStorage(SIDEBAR_USER_PROFILE_CACHE_KEY, {
    ...profile,
    updatedAt: Date.now()
  })
}

export function clearSidebarUserProfileCache(): boolean {
  return removeSessionStorageKey(SIDEBAR_USER_PROFILE_CACHE_KEY)
}
