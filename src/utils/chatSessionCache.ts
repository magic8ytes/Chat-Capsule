import { z } from 'zod'
import type { ChatSession, Message } from '../types/models'
import { readJsonSessionStorageWithSchema, writeJsonSessionStorage } from './localStorageCache.ts'

export const CHAT_SESSION_LIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const CHAT_SESSION_PREVIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const CHAT_SESSION_PREVIEW_LIMIT_PER_SESSION = 30
export const CHAT_SESSION_PREVIEW_MAX_SESSIONS = 18
export const CHAT_SESSION_WINDOW_CACHE_TTL_MS = 12 * 60 * 60 * 1000
export const CHAT_SESSION_WINDOW_CACHE_MAX_SESSIONS = 30
export const CHAT_SESSION_WINDOW_CACHE_MAX_MESSAGES = 300

export interface SessionListCachePayload {
  updatedAt: number
  sessions: ChatSession[]
}

export interface SessionPreviewCacheEntry {
  updatedAt: number
  messages: Message[]
}

interface SessionPreviewCachePayload {
  updatedAt: number
  entries: Record<string, SessionPreviewCacheEntry>
}

export interface SessionWindowCacheEntry {
  updatedAt: number
  messages: Message[]
  currentOffset: number
  hasMoreMessages: boolean
  hasMoreLater: boolean
  jumpStartTime: number
  jumpEndTime: number
}

const finiteNumberSchema = z.number().finite()

const chatSessionSchema = z.object({
  username: z.string(),
  type: finiteNumberSchema,
  unreadCount: finiteNumberSchema,
  summary: z.string(),
  sortTimestamp: finiteNumberSchema,
  lastTimestamp: finiteNumberSchema,
  lastMsgType: finiteNumberSchema,
  messageCountHint: finiteNumberSchema.optional(),
  displayName: z.string().optional(),
  avatarUrl: z.string().optional(),
  lastMsgSender: z.string().optional(),
  lastSenderDisplayName: z.string().optional(),
  selfWxid: z.string().optional(),
  isFolded: z.boolean().optional(),
  isMuted: z.boolean().optional()
}).passthrough()

const messageSchema = z.object({
  localId: finiteNumberSchema,
  serverId: finiteNumberSchema.optional(),
  createTime: finiteNumberSchema.optional(),
  sortSeq: finiteNumberSchema.optional(),
  localType: finiteNumberSchema.optional(),
  parsedContent: z.string().optional(),
  rawContent: z.string().optional()
}).passthrough()

const sessionPreviewCacheEntrySchema = z.object({
  updatedAt: finiteNumberSchema,
  messages: z.array(messageSchema)
}).strict()

const sessionListCachePayloadSchema = z.object({
  updatedAt: finiteNumberSchema,
  sessions: z.array(chatSessionSchema)
}).strict()

const sessionPreviewCachePayloadSchema = z.object({
  updatedAt: finiteNumberSchema,
  entries: z.record(z.string(), sessionPreviewCacheEntrySchema)
}).strict()

export function buildChatSessionListCacheKey(scope: string): string {
  return `weflow.chat.sessions.v1::${scope || 'default'}`
}

export function buildChatSessionPreviewCacheKey(scope: string): string {
  return `weflow.chat.preview.v1::${scope || 'default'}`
}

export function readSessionListCache(scope: string): SessionListCachePayload | null {
  const payload = readJsonSessionStorageWithSchema(buildChatSessionListCacheKey(scope), sessionListCachePayloadSchema)
  return payload ? (payload as SessionListCachePayload) : null
}

export function writeSessionListCache(scope: string, sessions: ChatSession[]): void {
  writeJsonSessionStorage(buildChatSessionListCacheKey(scope), {
    updatedAt: Date.now(),
    sessions
  } satisfies SessionListCachePayload)
}

export function readSessionPreviewCache(scope: string): Record<string, SessionPreviewCacheEntry> {
  const payload = readJsonSessionStorageWithSchema(buildChatSessionPreviewCacheKey(scope), sessionPreviewCachePayloadSchema)
  if (!payload) {
    return {}
  }
  if (Date.now() - payload.updatedAt > CHAT_SESSION_PREVIEW_CACHE_TTL_MS) {
    return {}
  }
  return payload.entries as unknown as Record<string, SessionPreviewCacheEntry>
}

export function writeSessionPreviewCache(scope: string, entries: Record<string, SessionPreviewCacheEntry>): void {
  writeJsonSessionStorage(buildChatSessionPreviewCacheKey(scope), {
    updatedAt: Date.now(),
    entries
  } satisfies SessionPreviewCachePayload)
}

export function upsertSessionPreviewEntries(
  currentEntries: Record<string, SessionPreviewCacheEntry>,
  sessionId: string,
  previewMessages: Message[]
): Record<string, SessionPreviewCacheEntry> {
  const normalizedSessionId = String(sessionId || '').trim()
  if (!normalizedSessionId || !Array.isArray(previewMessages) || previewMessages.length === 0) {
    return currentEntries
  }

  const trimmedMessages = previewMessages.slice(-CHAT_SESSION_PREVIEW_LIMIT_PER_SESSION)
  const nextEntries = {
    ...currentEntries,
    [normalizedSessionId]: {
      updatedAt: Date.now(),
      messages: trimmedMessages
    }
  }

  const sortedIds = Object.entries(nextEntries)
    .sort((lhs, rhs) => (rhs[1]?.updatedAt || 0) - (lhs[1]?.updatedAt || 0))
    .map(([entryId]) => entryId)
  const keptIds = new Set(sortedIds.slice(0, CHAT_SESSION_PREVIEW_MAX_SESSIONS))

  return Object.entries(nextEntries).reduce<Record<string, SessionPreviewCacheEntry>>((accumulator, [entryId, entry]) => {
    if (keptIds.has(entryId)) {
      accumulator[entryId] = entry
    }
    return accumulator
  }, {})
}

export function saveSessionWindowCacheEntry(
  cache: Map<string, SessionWindowCacheEntry>,
  sessionId: string,
  entry: Omit<SessionWindowCacheEntry, 'updatedAt'>
): void {
  const normalizedSessionId = String(sessionId || '').trim()
  if (!normalizedSessionId || !Array.isArray(entry.messages) || entry.messages.length === 0) return

  const trimmedMessages = entry.messages.length > CHAT_SESSION_WINDOW_CACHE_MAX_MESSAGES
    ? entry.messages.slice(-CHAT_SESSION_WINDOW_CACHE_MAX_MESSAGES)
    : entry.messages.slice()

  cache.set(normalizedSessionId, {
    updatedAt: Date.now(),
    ...entry,
    messages: trimmedMessages,
    currentOffset: trimmedMessages.length
  })

  if (cache.size <= CHAT_SESSION_WINDOW_CACHE_MAX_SESSIONS) return

  const sortedByTime = [...cache.entries()].sort((lhs, rhs) => (lhs[1].updatedAt || 0) - (rhs[1].updatedAt || 0))
  for (const [entryId] of sortedByTime) {
    if (cache.size <= CHAT_SESSION_WINDOW_CACHE_MAX_SESSIONS) break
    cache.delete(entryId)
  }
}

export function restoreSessionWindowCacheEntry(
  cache: Map<string, SessionWindowCacheEntry>,
  sessionId: string
): SessionWindowCacheEntry | null {
  const normalizedSessionId = String(sessionId || '').trim()
  if (!normalizedSessionId) return null

  const entry = cache.get(normalizedSessionId)
  if (!entry) return null
  if (Date.now() - entry.updatedAt > CHAT_SESSION_WINDOW_CACHE_TTL_MS) {
    cache.delete(normalizedSessionId)
    return null
  }
  if (!Array.isArray(entry.messages) || entry.messages.length === 0) {
    cache.delete(normalizedSessionId)
    return null
  }

  cache.set(normalizedSessionId, {
    ...entry,
    updatedAt: Date.now()
  })
  return entry
}
