import type { ChatSession as AppChatSession, ContactInfo } from '../../types/models'
import type { SnsPost } from '../../types/sns'
import type * as configService from '../../services/config'
import { toKindByContact, toKindByContactType, type SessionRow } from './exportPageShared'

export type SessionDataSource = 'cache' | 'network' | null
export type ContactsDataSource = 'cache' | 'network' | null

export interface ContactsLoadSession {
  requestId: string
  startedAt: number
  attempt: number
  timeoutMs: number
}

export interface ContactsLoadIssue {
  kind: 'timeout' | 'error'
  title: string
  message: string
  reason: string
  errorDetail?: string
  occurredAt: number
  elapsedMs: number
}

export interface SessionDetail {
  wxid: string
  displayName: string
  remark?: string
  nickName?: string
  alias?: string
  avatarUrl?: string
  messageCount: number
  voiceMessages?: number
  imageMessages?: number
  videoMessages?: number
  emojiMessages?: number
  transferMessages?: number
  redPacketMessages?: number
  callMessages?: number
  privateMutualGroups?: number
  groupMemberCount?: number
  groupMyMessages?: number
  groupActiveSpeakers?: number
  groupMutualFriends?: number
  relationStatsLoaded?: boolean
  statsUpdatedAt?: number
  statsStale?: boolean
  firstMessageTime?: number
  latestMessageTime?: number
  messageTables: { dbName: string; tableName: string; count: number }[]
}

export interface SessionSnsTimelineTarget {
  username: string
  displayName: string
  avatarUrl?: string
}

export interface SessionSnsRankItem {
  name: string
  count: number
  latestTime: number
}

export type SessionMutualFriendDirection = 'incoming' | 'outgoing' | 'bidirectional'
export type SessionMutualFriendBehavior = 'likes' | 'comments' | 'both'

export interface SessionMutualFriendItem {
  name: string
  incomingLikeCount: number
  incomingCommentCount: number
  outgoingLikeCount: number
  outgoingCommentCount: number
  totalCount: number
  latestTime: number
  direction: SessionMutualFriendDirection
  behavior: SessionMutualFriendBehavior
}

export interface SessionMutualFriendsMetric {
  count: number
  items: SessionMutualFriendItem[]
  loadedPosts: number
  totalPosts: number | null
  computedAt: number
}

export interface SessionSnsRankCacheEntry {
  likes: SessionSnsRankItem[]
  comments: SessionSnsRankItem[]
  totalPosts: number
  computedAt: number
}

export const buildSessionSnsRankings = (posts: SnsPost[]): { likes: SessionSnsRankItem[]; comments: SessionSnsRankItem[] } => {
  const likeMap = new Map<string, SessionSnsRankItem>()
  const commentMap = new Map<string, SessionSnsRankItem>()

  for (const post of posts) {
    const createTime = Number(post?.createTime) || 0
    const likes = Array.isArray(post?.likes) ? post.likes : []
    const comments = Array.isArray(post?.comments) ? post.comments : []

    for (const likeNameRaw of likes) {
      const name = String(likeNameRaw || '').trim() || '未知用户'
      const current = likeMap.get(name)
      if (current) {
        current.count += 1
        if (createTime > current.latestTime) current.latestTime = createTime
        continue
      }
      likeMap.set(name, { name, count: 1, latestTime: createTime })
    }

    for (const comment of comments) {
      const name = String(comment?.nickname || '').trim() || '未知用户'
      const current = commentMap.get(name)
      if (current) {
        current.count += 1
        if (createTime > current.latestTime) current.latestTime = createTime
        continue
      }
      commentMap.set(name, { name, count: 1, latestTime: createTime })
    }
  }

  const sorter = (a: SessionSnsRankItem, b: SessionSnsRankItem): number => {
    if (b.count !== a.count) return b.count - a.count
    if (b.latestTime !== a.latestTime) return b.latestTime - a.latestTime
    return a.name.localeCompare(b.name, 'zh-CN')
  }

  return {
    likes: [...likeMap.values()].sort(sorter),
    comments: [...commentMap.values()].sort(sorter)
  }
}

export const buildSessionMutualFriendsMetric = (
  posts: SnsPost[],
  totalPosts: number | null
): SessionMutualFriendsMetric => {
  const friendMap = new Map<string, SessionMutualFriendItem>()

  for (const post of posts) {
    const createTime = Number(post?.createTime) || 0
    const likes = Array.isArray(post?.likes) ? post.likes : []
    const comments = Array.isArray(post?.comments) ? post.comments : []

    for (const likeNameRaw of likes) {
      const name = String(likeNameRaw || '').trim() || '未知用户'
      const existing = friendMap.get(name)
      if (existing) {
        existing.incomingLikeCount += 1
        existing.totalCount += 1
        existing.behavior = existing.incomingCommentCount > 0 ? 'both' : 'likes'
        if (createTime > existing.latestTime) existing.latestTime = createTime
        continue
      }
      friendMap.set(name, {
        name,
        incomingLikeCount: 1,
        incomingCommentCount: 0,
        outgoingLikeCount: 0,
        outgoingCommentCount: 0,
        totalCount: 1,
        latestTime: createTime,
        direction: 'incoming',
        behavior: 'likes'
      })
    }

    for (const comment of comments) {
      const name = String(comment?.nickname || '').trim() || '未知用户'
      const existing = friendMap.get(name)
      if (existing) {
        existing.incomingCommentCount += 1
        existing.totalCount += 1
        existing.behavior = existing.incomingLikeCount > 0 ? 'both' : 'comments'
        if (createTime > existing.latestTime) existing.latestTime = createTime
        continue
      }
      friendMap.set(name, {
        name,
        incomingLikeCount: 0,
        incomingCommentCount: 1,
        outgoingLikeCount: 0,
        outgoingCommentCount: 0,
        totalCount: 1,
        latestTime: createTime,
        direction: 'incoming',
        behavior: 'comments'
      })
    }
  }

  const items = [...friendMap.values()].sort((a, b) => {
    if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount
    if (b.latestTime !== a.latestTime) return b.latestTime - a.latestTime
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  return {
    count: items.length,
    items,
    loadedPosts: posts.length,
    totalPosts,
    computedAt: Date.now()
  }
}

export const getSessionMutualFriendDirectionLabel = (direction: SessionMutualFriendDirection): string => {
  if (direction === 'incoming') return '对方赞/评TA'
  if (direction === 'outgoing') return 'TA赞/评对方'
  return '双方有互动'
}

export const getSessionMutualFriendBehaviorLabel = (behavior: SessionMutualFriendBehavior): string => {
  if (behavior === 'likes') return '赞'
  if (behavior === 'comments') return '评'
  return '赞/评'
}

export const summarizeMutualFriendBehavior = (likeCount: number, commentCount: number): SessionMutualFriendBehavior => {
  if (likeCount > 0 && commentCount > 0) return 'both'
  if (likeCount > 0) return 'likes'
  return 'comments'
}

export const describeSessionMutualFriendRelation = (
  item: SessionMutualFriendItem,
  targetDisplayName: string
): string => {
  if (item.direction === 'incoming') {
    if (item.behavior === 'likes') return `${item.name} 给 ${targetDisplayName} 点过赞`
    if (item.behavior === 'comments') return `${item.name} 给 ${targetDisplayName} 评论过`
    return `${item.name} 给 ${targetDisplayName} 点过赞、评论过`
  }
  if (item.direction === 'outgoing') {
    if (item.behavior === 'likes') return `${targetDisplayName} 给 ${item.name} 点过赞`
    if (item.behavior === 'comments') return `${targetDisplayName} 给 ${item.name} 评论过`
    return `${targetDisplayName} 给 ${item.name} 点过赞、评论过`
  }
  if (item.behavior === 'likes') return `${targetDisplayName} 和 ${item.name} 双方都有点赞互动`
  if (item.behavior === 'comments') return `${targetDisplayName} 和 ${item.name} 双方都有评论互动`
  return `${targetDisplayName} 和 ${item.name} 双方都有点赞或评论互动`
}

export interface SessionExportMetric {
  totalMessages: number
  voiceMessages: number
  imageMessages: number
  videoMessages: number
  emojiMessages: number
  transferMessages: number
  redPacketMessages: number
  callMessages: number
  firstTimestamp?: number
  lastTimestamp?: number
  privateMutualGroups?: number
  groupMemberCount?: number
  groupMyMessages?: number
  groupActiveSpeakers?: number
  groupMutualFriends?: number
}

export interface SessionContentMetric {
  totalMessages?: number
  voiceMessages?: number
  imageMessages?: number
  videoMessages?: number
  emojiMessages?: number
  transferMessages?: number
  redPacketMessages?: number
  callMessages?: number
}

export interface SessionExportCacheMeta {
  updatedAt: number
  stale: boolean
  includeRelations: boolean
  source: 'memory' | 'disk' | 'fresh'
}

export type SessionLoadStageStatus = 'pending' | 'loading' | 'done' | 'failed'

export interface SessionLoadStageState {
  status: SessionLoadStageStatus
  startedAt?: number
  finishedAt?: number
  error?: string
}

export interface SessionLoadTraceState {
  messageCount: SessionLoadStageState
  mediaMetrics: SessionLoadStageState
  snsPostCounts: SessionLoadStageState
  mutualFriends: SessionLoadStageState
}

export interface SessionLoadStageSummary {
  total: number
  loaded: number
  statusLabel: string
  startedAt?: number
  finishedAt?: number
  latestProgressAt?: number
}

export const toContactMapFromCaches = (
  contacts: configService.ContactsListCacheContact[],
  avatarEntries: Record<string, configService.ContactsAvatarCacheEntry>
): Record<string, ContactInfo> => {
  const map: Record<string, ContactInfo> = {}
  for (const contact of contacts || []) {
    if (!contact?.username) continue
    map[contact.username] = {
      ...contact,
      avatarUrl: avatarEntries[contact.username]?.avatarUrl
    }
  }
  return map
}

export const mergeAvatarCacheIntoContacts = (
  sourceContacts: ContactInfo[],
  avatarEntries: Record<string, configService.ContactsAvatarCacheEntry>
): ContactInfo[] => {
  if (!sourceContacts.length || Object.keys(avatarEntries).length === 0) {
    return sourceContacts
  }

  let changed = false
  const merged = sourceContacts.map((contact) => {
    const cachedAvatar = avatarEntries[contact.username]?.avatarUrl
    if (!cachedAvatar || contact.avatarUrl) {
      return contact
    }
    changed = true
    return {
      ...contact,
      avatarUrl: cachedAvatar
    }
  })

  return changed ? merged : sourceContacts
}

export const upsertAvatarCacheFromContacts = (
  avatarEntries: Record<string, configService.ContactsAvatarCacheEntry>,
  sourceContacts: ContactInfo[],
  options?: { prune?: boolean; markCheckedUsernames?: string[]; now?: number }
): {
  avatarEntries: Record<string, configService.ContactsAvatarCacheEntry>
  changed: boolean
  updatedAt: number | null
} => {
  const nextCache = { ...avatarEntries }
  const now = options?.now || Date.now()
  const markCheckedSet = new Set((options?.markCheckedUsernames || []).filter(Boolean))
  const usernamesInSource = new Set<string>()
  let changed = false

  for (const contact of sourceContacts) {
    const username = String(contact.username || '').trim()
    if (!username) continue
    usernamesInSource.add(username)
    const prev = nextCache[username]
    const avatarUrl = String(contact.avatarUrl || '').trim()
    if (!avatarUrl) continue
    const updatedAt = !prev || prev.avatarUrl !== avatarUrl ? now : prev.updatedAt
    const checkedAt = markCheckedSet.has(username) ? now : (prev?.checkedAt || now)
    if (!prev || prev.avatarUrl !== avatarUrl || prev.updatedAt !== updatedAt || prev.checkedAt !== checkedAt) {
      nextCache[username] = {
        avatarUrl,
        updatedAt,
        checkedAt
      }
      changed = true
    }
  }

  for (const username of markCheckedSet) {
    const prev = nextCache[username]
    if (!prev) continue
    if (prev.checkedAt !== now) {
      nextCache[username] = {
        ...prev,
        checkedAt: now
      }
      changed = true
    }
  }

  if (options?.prune) {
    for (const username of Object.keys(nextCache)) {
      if (usernamesInSource.has(username)) continue
      delete nextCache[username]
      changed = true
    }
  }

  return {
    avatarEntries: nextCache,
    changed,
    updatedAt: changed ? now : null
  }
}

export const toSessionRowsWithContacts = (
  sessions: AppChatSession[],
  contactMap: Record<string, ContactInfo>
): SessionRow[] => {
  const sessionMap = new Map<string, AppChatSession>()
  for (const session of sessions || []) {
    sessionMap.set(session.username, session)
  }

  const contacts = Object.values(contactMap)
    .filter((contact) => (
      contact.type === 'friend' ||
      contact.type === 'group' ||
      contact.type === 'official' ||
      contact.type === 'former_friend'
    ))

  if (contacts.length > 0) {
    return contacts
      .map((contact) => {
        const session = sessionMap.get(contact.username)
        const latestTs = session?.sortTimestamp || session?.lastTimestamp || 0
        return {
          ...(session || {
            username: contact.username,
            type: 0,
            unreadCount: 0,
            summary: '',
            sortTimestamp: latestTs,
            lastTimestamp: latestTs,
            lastMsgType: 0
          }),
          username: contact.username,
          kind: toKindByContact(contact),
          wechatId: contact.username,
          displayName: contact.displayName || session?.displayName || contact.username,
          avatarUrl: contact.avatarUrl || session?.avatarUrl,
          hasSession: Boolean(session)
        } as SessionRow
      })
      .sort((a, b) => {
        const latestA = a.sortTimestamp || a.lastTimestamp || 0
        const latestB = b.sortTimestamp || b.lastTimestamp || 0
        if (latestA !== latestB) return latestB - latestA
        return (a.displayName || a.username).localeCompare(b.displayName || b.username, 'zh-Hans-CN')
      })
  }

  return sessions
    .map((session) => {
      const contact = contactMap[session.username]
      return {
        ...session,
        kind: toKindByContactType(session, contact),
        wechatId: contact?.username || session.username,
        displayName: contact?.displayName || session.displayName || session.username,
        avatarUrl: contact?.avatarUrl || session.avatarUrl,
        hasSession: true
      } as SessionRow
    })
    .sort((a, b) => (b.sortTimestamp || b.lastTimestamp || 0) - (a.sortTimestamp || a.lastTimestamp || 0))
}

export const normalizeMessageCount = (value: unknown): number | undefined => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.floor(parsed)
}

export const pickSessionMediaMetric = (
  metricRaw: SessionExportMetric | SessionContentMetric | undefined
): SessionContentMetric | null => {
  if (!metricRaw) return null
  const voiceMessages = normalizeMessageCount(metricRaw.voiceMessages)
  const imageMessages = normalizeMessageCount(metricRaw.imageMessages)
  const videoMessages = normalizeMessageCount(metricRaw.videoMessages)
  const emojiMessages = normalizeMessageCount(metricRaw.emojiMessages)
  if (
    typeof voiceMessages !== 'number' &&
    typeof imageMessages !== 'number' &&
    typeof videoMessages !== 'number' &&
    typeof emojiMessages !== 'number'
  ) {
    return null
  }
  return {
    voiceMessages,
    imageMessages,
    videoMessages,
    emojiMessages
  }
}

export const hasCompleteSessionMediaMetric = (metricRaw: SessionContentMetric | undefined): boolean => {
  if (!metricRaw) return false
  return (
    typeof normalizeMessageCount(metricRaw.voiceMessages) === 'number' &&
    typeof normalizeMessageCount(metricRaw.imageMessages) === 'number' &&
    typeof normalizeMessageCount(metricRaw.videoMessages) === 'number' &&
    typeof normalizeMessageCount(metricRaw.emojiMessages) === 'number'
  )
}

export const createDefaultSessionLoadStage = (): SessionLoadStageState => ({ status: 'pending' })

export const createDefaultSessionLoadTrace = (): SessionLoadTraceState => ({
  messageCount: createDefaultSessionLoadStage(),
  mediaMetrics: createDefaultSessionLoadStage(),
  snsPostCounts: createDefaultSessionLoadStage(),
  mutualFriends: createDefaultSessionLoadStage()
})
