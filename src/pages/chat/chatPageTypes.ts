export const GROUP_MEMBERS_PANEL_CACHE_TTL_MS = 10 * 60 * 1000

export interface ChatPageProps {
  standaloneSessionWindow?: boolean
  initialSessionId?: string | null
  standaloneSource?: string | null
  standaloneInitialDisplayName?: string | null
  standaloneInitialAvatarUrl?: string | null
  standaloneInitialContactType?: string | null
}

export type StandaloneLoadStage = 'idle' | 'connecting' | 'loading' | 'ready'

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

export interface SessionExportCacheMeta {
  updatedAt: number
  stale: boolean
  includeRelations: boolean
  source: 'memory' | 'disk' | 'fresh'
}

export type GroupMessageCountStatus = 'loading' | 'ready' | 'failed'

export interface GroupPanelMember {
  username: string
  displayName: string
  avatarUrl?: string
  nickname?: string
  alias?: string
  remark?: string
  groupNickname?: string
  isOwner?: boolean
  isFriend: boolean
  messageCount: number
  messageCountStatus: GroupMessageCountStatus
}

export interface GroupMembersPanelCacheEntry {
  updatedAt: number
  members: GroupPanelMember[]
  includeMessageCounts: boolean
}

export interface LoadMessagesOptions {
  preferLatestPath?: boolean
  deferGroupSenderWarmup?: boolean
  forceInitialLimit?: number
  switchRequestSeq?: number
}
