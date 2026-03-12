import { create } from 'zustand'
import type { ChatSession, Message, Contact } from '../types/models'

const normalizeUnreadCount = (value: number): number => {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

const syncLocalUnreadBaselines = (
  sessions: ChatSession[],
  currentSessionId: string | null,
  previousBaselines: Record<string, number>
): Record<string, number> => {
  if (!Array.isArray(sessions) || sessions.length === 0) return {}

  const nextBaselines: Record<string, number> = {}

  for (const session of sessions) {
    const rawUnreadCount = normalizeUnreadCount(session.unreadCount)

    if (currentSessionId && session.username === currentSessionId) {
      if (rawUnreadCount > 0) {
        nextBaselines[session.username] = rawUnreadCount
      }
      continue
    }

    const previousBaseline = previousBaselines[session.username]
    if (!Number.isFinite(previousBaseline)) continue

    const normalizedBaseline = Math.min(normalizeUnreadCount(previousBaseline), rawUnreadCount)
    if (normalizedBaseline > 0) {
      nextBaselines[session.username] = normalizedBaseline
    }
  }

  return nextBaselines
}

export interface ChatState {
  // 连接状态
  isConnected: boolean
  isConnecting: boolean
  connectionError: string | null

  // 会话列表
  sessions: ChatSession[]
  filteredSessions: ChatSession[]
  currentSessionId: string | null
  isLoadingSessions: boolean
  localUnreadBaselines: Record<string, number>

  // 消息
  messages: Message[]
  isLoadingMessages: boolean
  isLoadingMore: boolean
  hasMoreMessages: boolean
  hasMoreLater: boolean

  // 联系人缓存
  contacts: Map<string, Contact>

  // 搜索
  searchKeyword: string

  // 操作
  setConnected: (connected: boolean) => void
  setConnecting: (connecting: boolean) => void
  setConnectionError: (error: string | null) => void
  setSessions: (sessions: ChatSession[]) => void
  clearLocalUnread: (sessionId: string, rawUnreadCount?: number) => void
  setFilteredSessions: (sessions: ChatSession[]) => void
  setCurrentSession: (sessionId: string | null, options?: { preserveMessages?: boolean }) => void
  setLoadingSessions: (loading: boolean) => void
  setMessages: (messages: Message[]) => void
  appendMessages: (messages: Message[], prepend?: boolean) => void
  setLoadingMessages: (loading: boolean) => void
  setLoadingMore: (loading: boolean) => void
  setHasMoreMessages: (hasMore: boolean) => void
  setHasMoreLater: (hasMore: boolean) => void
  setContacts: (contacts: Contact[]) => void
  addContact: (contact: Contact) => void
  setSearchKeyword: (keyword: string) => void
  reset: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  isConnected: false,
  isConnecting: false,
  connectionError: null,
  sessions: [],
  filteredSessions: [],
  currentSessionId: null,
  isLoadingSessions: false,
  localUnreadBaselines: {},
  messages: [],
  isLoadingMessages: false,
  isLoadingMore: false,
  hasMoreMessages: true,
  hasMoreLater: false,
  contacts: new Map(),
  searchKeyword: '',

  setConnected: (connected) => set({ isConnected: connected }),
  setConnecting: (connecting) => set({ isConnecting: connecting }),
  setConnectionError: (error) => set({ connectionError: error }),

  setSessions: (sessions) => set((state) => {
    const nextSessions = Array.isArray(sessions) ? sessions : []
    return {
      sessions: nextSessions,
      filteredSessions: nextSessions,
      localUnreadBaselines: syncLocalUnreadBaselines(nextSessions, state.currentSessionId, state.localUnreadBaselines)
    }
  }),
  clearLocalUnread: (sessionId, rawUnreadCount = 0) => set((state) => {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return state

    const nextBaselines = { ...state.localUnreadBaselines }
    const normalizedUnreadCount = normalizeUnreadCount(rawUnreadCount)

    if (normalizedUnreadCount > 0) {
      nextBaselines[normalizedSessionId] = normalizedUnreadCount
    } else {
      delete nextBaselines[normalizedSessionId]
    }

    return { localUnreadBaselines: nextBaselines }
  }),
  setFilteredSessions: (sessions) => set({ filteredSessions: sessions }),

  setCurrentSession: (sessionId, options) => set((state) => ({
    currentSessionId: sessionId,
    messages: options?.preserveMessages ? state.messages : [],
    hasMoreMessages: true,
    hasMoreLater: false,
    localUnreadBaselines: syncLocalUnreadBaselines(state.sessions, sessionId, state.localUnreadBaselines)
  })),

  setLoadingSessions: (loading) => set({ isLoadingSessions: loading }),

  setMessages: (messages) => set({ messages }),

  appendMessages: (newMessages, prepend = false) => set((state) => {
    // 强制去重逻辑
    const getMsgKey = (m: Message) => {
      if (m.localId && m.localId > 0) return `l:${m.localId}`
      return `t:${m.createTime}:${m.sortSeq || 0}:${m.serverId || 0}`
    }
    const currentMessages = state.messages || []
    const existingKeys = new Set(currentMessages.map(getMsgKey))
    const filtered = newMessages.filter(m => !existingKeys.has(getMsgKey(m)))

    if (filtered.length === 0) return state

    return {
      messages: prepend
        ? [...filtered, ...currentMessages]
        : [...currentMessages, ...filtered]
    }
  }),

  setLoadingMessages: (loading) => set({ isLoadingMessages: loading }),
  setLoadingMore: (loading) => set({ isLoadingMore: loading }),
  setHasMoreMessages: (hasMore) => set({ hasMoreMessages: hasMore }),
  setHasMoreLater: (hasMore) => set({ hasMoreLater: hasMore }),

  setContacts: (contacts) => set({
    contacts: new Map(contacts.map(c => [c.username, c]))
  }),

  addContact: (contact) => set((state) => {
    const newContacts = new Map(state.contacts)
    newContacts.set(contact.username, contact)
    return { contacts: newContacts }
  }),

  setSearchKeyword: (keyword) => set({ searchKeyword: keyword }),

  reset: () => set({
    isConnected: false,
    isConnecting: false,
    connectionError: null,
    sessions: [],
    filteredSessions: [],
    currentSessionId: null,
    isLoadingSessions: false,
    localUnreadBaselines: {},
    messages: [],
    isLoadingMessages: false,
    isLoadingMore: false,
    hasMoreMessages: true,
    hasMoreLater: false,
    contacts: new Map(),
    searchKeyword: ''
  })
}))
