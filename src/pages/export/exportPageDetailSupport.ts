interface SessionContentMetric {
  totalMessages?: number
  voiceMessages?: number
  imageMessages?: number
  videoMessages?: number
  emojiMessages?: number
  transferMessages?: number
  redPacketMessages?: number
  callMessages?: number
}

interface SessionDetail {
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
  messageTables: Array<{ dbName: string; tableName: string; count: number }>
}

interface SessionExportMetric {
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

interface SessionExportCacheMeta {
  updatedAt: number
  stale: boolean
  includeRelations: boolean
  source: 'memory' | 'disk' | 'fresh'
}

interface SessionDetailFastPayload {
  displayName?: string
  remark?: string
  nickName?: string
  alias?: string
  avatarUrl?: string
  messageCount: number
}

interface SessionDetailExtraPayload {
  firstMessageTime?: number
  latestMessageTime?: number
  messageTables?: Array<{ dbName: string; tableName: string; count: number }>
}

interface MappedSessionLike {
  displayName?: string
  avatarUrl?: string
  messageCountHint?: number
}

interface MappedContactLike {
  displayName?: string
  remark?: string
  nickname?: string
  avatarUrl?: string
}

interface BuildInitialSessionDetailStateInput {
  sessionId: string
  previous: SessionDetail | null
  mappedSession?: MappedSessionLike
  mappedContact?: MappedContactLike
  cachedMetric?: SessionContentMetric
  countedCount?: number
}

const normalizeMessageCount = (value: unknown): number | undefined => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.floor(parsed)
}

export const buildInitialSessionDetailState = ({
  sessionId,
  previous,
  mappedSession,
  mappedContact,
  cachedMetric,
  countedCount
}: BuildInitialSessionDetailStateInput): SessionDetail => {
  const sameSession = previous?.wxid === sessionId
  const metricCount = normalizeMessageCount(cachedMetric?.totalMessages)
  const metricVoice = normalizeMessageCount(cachedMetric?.voiceMessages)
  const metricImage = normalizeMessageCount(cachedMetric?.imageMessages)
  const metricVideo = normalizeMessageCount(cachedMetric?.videoMessages)
  const metricEmoji = normalizeMessageCount(cachedMetric?.emojiMessages)
  const metricTransfer = normalizeMessageCount(cachedMetric?.transferMessages)
  const metricRedPacket = normalizeMessageCount(cachedMetric?.redPacketMessages)
  const metricCall = normalizeMessageCount(cachedMetric?.callMessages)
  const hintedCount = typeof mappedSession?.messageCountHint === 'number' && Number.isFinite(mappedSession.messageCountHint) && mappedSession.messageCountHint >= 0
    ? Math.floor(mappedSession.messageCountHint)
    : undefined
  const initialMessageCount = countedCount ?? metricCount ?? hintedCount

  return {
    wxid: sessionId,
    displayName: mappedSession?.displayName || mappedContact?.displayName || previous?.displayName || sessionId,
    remark: sameSession ? previous?.remark : mappedContact?.remark,
    nickName: sameSession ? previous?.nickName : mappedContact?.nickname,
    alias: sameSession ? previous?.alias : undefined,
    avatarUrl: mappedSession?.avatarUrl || mappedContact?.avatarUrl || (sameSession ? previous?.avatarUrl : undefined),
    messageCount: initialMessageCount ?? (sameSession ? previous.messageCount : Number.NaN),
    voiceMessages: metricVoice ?? (sameSession ? previous?.voiceMessages : undefined),
    imageMessages: metricImage ?? (sameSession ? previous?.imageMessages : undefined),
    videoMessages: metricVideo ?? (sameSession ? previous?.videoMessages : undefined),
    emojiMessages: metricEmoji ?? (sameSession ? previous?.emojiMessages : undefined),
    transferMessages: metricTransfer ?? (sameSession ? previous?.transferMessages : undefined),
    redPacketMessages: metricRedPacket ?? (sameSession ? previous?.redPacketMessages : undefined),
    callMessages: metricCall ?? (sameSession ? previous?.callMessages : undefined),
    privateMutualGroups: sameSession ? previous?.privateMutualGroups : undefined,
    groupMemberCount: sameSession ? previous?.groupMemberCount : undefined,
    groupMyMessages: sameSession ? previous?.groupMyMessages : undefined,
    groupActiveSpeakers: sameSession ? previous?.groupActiveSpeakers : undefined,
    groupMutualFriends: sameSession ? previous?.groupMutualFriends : undefined,
    relationStatsLoaded: sameSession ? previous?.relationStatsLoaded : false,
    statsUpdatedAt: sameSession ? previous?.statsUpdatedAt : undefined,
    statsStale: sameSession ? previous?.statsStale : undefined,
    firstMessageTime: sameSession ? previous?.firstMessageTime : undefined,
    latestMessageTime: sameSession ? previous?.latestMessageTime : undefined,
    messageTables: sameSession && Array.isArray(previous?.messageTables) ? previous.messageTables : []
  }
}

export const mergeFastSessionDetailState = (
  previous: SessionDetail | null,
  sessionId: string,
  detail: SessionDetailFastPayload
): SessionDetail => ({
  wxid: sessionId,
  displayName: detail.displayName || previous?.displayName || sessionId,
  remark: detail.remark ?? previous?.remark,
  nickName: detail.nickName ?? previous?.nickName,
  alias: detail.alias ?? previous?.alias,
  avatarUrl: detail.avatarUrl || previous?.avatarUrl,
  messageCount: Number.isFinite(detail.messageCount) ? detail.messageCount : previous?.messageCount ?? Number.NaN,
  voiceMessages: previous?.voiceMessages,
  imageMessages: previous?.imageMessages,
  videoMessages: previous?.videoMessages,
  emojiMessages: previous?.emojiMessages,
  transferMessages: previous?.transferMessages,
  redPacketMessages: previous?.redPacketMessages,
  callMessages: previous?.callMessages,
  privateMutualGroups: previous?.privateMutualGroups,
  groupMemberCount: previous?.groupMemberCount,
  groupMyMessages: previous?.groupMyMessages,
  groupActiveSpeakers: previous?.groupActiveSpeakers,
  groupMutualFriends: previous?.groupMutualFriends,
  relationStatsLoaded: previous?.relationStatsLoaded,
  statsUpdatedAt: previous?.statsUpdatedAt,
  statsStale: previous?.statsStale,
  firstMessageTime: previous?.firstMessageTime,
  latestMessageTime: previous?.latestMessageTime,
  messageTables: Array.isArray(previous?.messageTables) ? previous.messageTables : []
})

export const mergeSessionDetailExtraState = (
  previous: SessionDetail | null,
  sessionId: string,
  detail: SessionDetailExtraPayload
): SessionDetail | null => {
  if (!previous || previous.wxid !== sessionId) return previous
  return {
    ...previous,
    firstMessageTime: detail.firstMessageTime,
    latestMessageTime: detail.latestMessageTime,
    messageTables: Array.isArray(detail.messageTables) ? detail.messageTables : []
  }
}

export const applySessionDetailStatsState = (
  previous: SessionDetail | null,
  sessionId: string,
  metric: SessionExportMetric,
  cacheMeta?: SessionExportCacheMeta,
  relationLoadedOverride?: boolean
): SessionDetail | null => {
  if (!previous || previous.wxid !== sessionId) return previous
  const relationLoaded = relationLoadedOverride ?? Boolean(previous.relationStatsLoaded)
  return {
    ...previous,
    messageCount: Number.isFinite(metric.totalMessages) ? metric.totalMessages : previous.messageCount,
    voiceMessages: Number.isFinite(metric.voiceMessages) ? metric.voiceMessages : previous.voiceMessages,
    imageMessages: Number.isFinite(metric.imageMessages) ? metric.imageMessages : previous.imageMessages,
    videoMessages: Number.isFinite(metric.videoMessages) ? metric.videoMessages : previous.videoMessages,
    emojiMessages: Number.isFinite(metric.emojiMessages) ? metric.emojiMessages : previous.emojiMessages,
    transferMessages: Number.isFinite(metric.transferMessages) ? metric.transferMessages : previous.transferMessages,
    redPacketMessages: Number.isFinite(metric.redPacketMessages) ? metric.redPacketMessages : previous.redPacketMessages,
    callMessages: Number.isFinite(metric.callMessages) ? metric.callMessages : previous.callMessages,
    groupMemberCount: Number.isFinite(metric.groupMemberCount) ? metric.groupMemberCount : previous.groupMemberCount,
    groupMyMessages: Number.isFinite(metric.groupMyMessages) ? metric.groupMyMessages : previous.groupMyMessages,
    groupActiveSpeakers: Number.isFinite(metric.groupActiveSpeakers) ? metric.groupActiveSpeakers : previous.groupActiveSpeakers,
    privateMutualGroups: relationLoaded && Number.isFinite(metric.privateMutualGroups)
      ? metric.privateMutualGroups
      : previous.privateMutualGroups,
    groupMutualFriends: relationLoaded && Number.isFinite(metric.groupMutualFriends)
      ? metric.groupMutualFriends
      : previous.groupMutualFriends,
    relationStatsLoaded: relationLoaded,
    statsUpdatedAt: cacheMeta?.updatedAt ?? previous.statsUpdatedAt,
    statsStale: typeof cacheMeta?.stale === 'boolean' ? cacheMeta.stale : previous.statsStale,
    firstMessageTime: Number.isFinite(metric.firstTimestamp) ? metric.firstTimestamp : previous.firstMessageTime,
    latestMessageTime: Number.isFinite(metric.lastTimestamp) ? metric.lastTimestamp : previous.latestMessageTime
  }
}

export const mergeSessionDetailCacheMetaState = (
  previous: SessionDetail | null,
  sessionId: string,
  cacheMeta: SessionExportCacheMeta
): SessionDetail | null => {
  if (!previous || previous.wxid !== sessionId) return previous
  return {
    ...previous,
    statsUpdatedAt: cacheMeta.updatedAt,
    statsStale: cacheMeta.stale
  }
}

export const shouldRunPreciseSessionDetailRefresh = (options: {
  lastPreciseAt: number
  quickMetric?: SessionExportMetric
  quickCacheMeta?: SessionExportCacheMeta
  cooldownMs: number
  now?: number
}): boolean => {
  const now = options.now ?? Date.now()
  const hasRecentPrecise = now - options.lastPreciseAt <= options.cooldownMs
  if (hasRecentPrecise) return false
  return !options.quickMetric || Boolean(options.quickCacheMeta?.stale)
}
