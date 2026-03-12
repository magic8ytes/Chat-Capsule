import type { ChatSession as AppChatSession, ContactInfo } from '../../types/models'
import type * as configService from '../../services/config'

export type ConversationTab = 'private' | 'group' | 'official' | 'former_friend'
export type TaskScope = 'single' | 'multi' | 'content' | 'sns'
export type ContentType = 'text' | 'voice' | 'image' | 'video' | 'emoji'
export type ContentCardType = ContentType | 'sns'
export type SnsRankMode = 'likes' | 'comments'

export type SessionLayout = 'shared' | 'per-session'

export type DisplayNamePreference = 'group-nickname' | 'remark' | 'nickname'

export type TextExportFormat = 'chatlab' | 'chatlab-jsonl' | 'json' | 'arkme-json' | 'html' | 'txt' | 'excel' | 'weclone' | 'sql'
export type SnsTimelineExportFormat = 'json' | 'html' | 'arkmejson'

export interface ExportOptions {
  format: TextExportFormat
  dateRange: { start: Date; end: Date } | null
  useAllTime: boolean
  exportAvatars: boolean
  exportMedia: boolean
  exportImages: boolean
  exportVoices: boolean
  exportVideos: boolean
  exportEmojis: boolean
  exportVoiceAsText: boolean
  excelCompactColumns: boolean
  txtColumns: string[]
  displayNamePreference: DisplayNamePreference
  exportConcurrency: number
}

export interface SessionRow extends AppChatSession {
  kind: ConversationTab
  wechatId?: string
  hasSession: boolean
}

export interface ExportDialogState {
  open: boolean
  scope: TaskScope
  contentType?: ContentType
  sessionIds: string[]
  sessionNames: string[]
  title: string
}

export const defaultTxtColumns = ['index', 'time', 'senderRole', 'messageType', 'content']
export const DETAIL_PRECISE_REFRESH_COOLDOWN_MS = 10 * 60 * 1000
export const SESSION_MEDIA_METRIC_PREFETCH_ROWS = 10
export const SESSION_MEDIA_METRIC_BATCH_SIZE = 12
export const SESSION_MEDIA_METRIC_BACKGROUND_FEED_SIZE = 48
export const SESSION_MEDIA_METRIC_BACKGROUND_FEED_INTERVAL_MS = 120
export const SESSION_MEDIA_METRIC_CACHE_FLUSH_DELAY_MS = 1200
export const SNS_USER_POST_COUNT_BATCH_SIZE = 12
export const SNS_USER_POST_COUNT_BATCH_INTERVAL_MS = 120
export const SNS_RANK_PAGE_SIZE = 50
export const SNS_RANK_DISPLAY_LIMIT = 15
export const CONTACT_ENRICH_TIMEOUT_MS = 7000
export const EXPORT_SNS_STATS_CACHE_STALE_MS = 12 * 60 * 60 * 1000
export const EXPORT_AVATAR_ENRICH_BATCH_SIZE = 80
export const DEFAULT_CONTACTS_LOAD_TIMEOUT_MS = 3000
export const EXPORT_REENTER_SESSION_SOFT_REFRESH_MS = 5 * 60 * 1000
export const EXPORT_REENTER_CONTACTS_SOFT_REFRESH_MS = 5 * 60 * 1000
export const EXPORT_REENTER_SNS_SOFT_REFRESH_MS = 3 * 60 * 1000

export const contentTypeLabels: Record<ContentType, string> = {
  text: '聊天文本',
  voice: '语音',
  image: '图片',
  video: '视频',
  emoji: '表情包'
}

export const conversationTabLabels: Record<ConversationTab, string> = {
  private: '私聊',
  group: '群聊',
  official: '公众号',
  former_friend: '曾经的好友'
}

export const getContentTypeLabel = (type: ContentType): string => {
  return contentTypeLabels[type] || type
}

export const formatOptions: Array<{ value: TextExportFormat; label: string; desc: string }> = [
  { value: 'chatlab', label: 'ChatLab', desc: '标准格式，支持其他软件导入' },
  { value: 'chatlab-jsonl', label: 'ChatLab JSONL', desc: '流式格式，适合大量消息' },
  { value: 'json', label: 'JSON', desc: '详细格式，包含完整消息信息' },
  { value: 'arkme-json', label: 'Arkme JSON', desc: '紧凑 JSON，支持 sender 去重与关系统计' },
  { value: 'html', label: 'HTML', desc: '网页格式，可直接浏览' },
  { value: 'txt', label: 'TXT', desc: '纯文本，通用格式' },
  { value: 'excel', label: 'Excel', desc: '电子表格，适合统计分析' },
  { value: 'weclone', label: 'WeClone CSV', desc: 'WeClone 兼容字段格式（CSV）' },
  { value: 'sql', label: 'PostgreSQL', desc: '数据库脚本，便于导入到数据库' }
]

export const displayNameOptions: Array<{ value: DisplayNamePreference; label: string; desc: string }> = [
  { value: 'group-nickname', label: '群昵称优先', desc: '仅群聊有效，私聊显示备注/昵称' },
  { value: 'remark', label: '备注优先', desc: '有备注显示备注，否则显示昵称' },
  { value: 'nickname', label: '微信昵称', desc: '始终显示微信昵称' }
]

export const toKindByContactType = (session: AppChatSession, contact?: ContactInfo): ConversationTab => {
  if (session.username.endsWith('@chatroom')) return 'group'
  if (session.username.startsWith('gh_')) return 'official'
  if (contact?.type === 'official') return 'official'
  if (contact?.type === 'former_friend') return 'former_friend'
  return 'private'
}

export const toKindByContact = (contact: ContactInfo): ConversationTab => {
  if (contact.type === 'group') return 'group'
  if (contact.type === 'official') return 'official'
  if (contact.type === 'former_friend') return 'former_friend'
  return 'private'
}

export const isContentScopeSession = (session: SessionRow): boolean => (
  session.kind === 'private' || session.kind === 'group' || session.kind === 'former_friend'
)

export const isExportConversationSession = (session: SessionRow): boolean => (
  session.kind === 'private' || session.kind === 'group' || session.kind === 'former_friend'
)

export const exportKindPriority: Record<ConversationTab, number> = {
  private: 0,
  group: 1,
  former_friend: 2,
  official: 3
}

export const toComparableNameSet = (values: Array<string | undefined | null>): Set<string> => {
  const set = new Set<string>()
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (!normalized) continue
    set.add(normalized)
  }
  return set
}

export const matchesContactTab = (contact: ContactInfo, tab: ConversationTab): boolean => {
  if (tab === 'private') return contact.type === 'friend'
  if (tab === 'group') return contact.type === 'group'
  if (tab === 'official') return contact.type === 'official'
  return contact.type === 'former_friend'
}

export const createTaskId = (): string => `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export type ExportWriteLayout = configService.ExportWriteLayout
