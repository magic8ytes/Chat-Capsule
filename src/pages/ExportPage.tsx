import { memo, useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { createPortal } from 'react-dom'
import {
  Aperture,
  Calendar,
  Check,
  CheckSquare,
  Copy,
  Database,
  Download,
  ExternalLink,
  Hash,
  Image as ImageIcon,
  Loader2,
  AlertTriangle,
  ClipboardList,
  MessageSquare,
  MessageSquareText,
  Mic,
  RefreshCw,
  Search,
  Square,
  Video,
  WandSparkles,
  X
} from 'lucide-react'
import type { ChatSession as AppChatSession, ContactInfo } from '../types/models'
import type { ExportOptions as ElectronExportOptions, ExportProgress } from '../types/electron'
import * as configService from '../services/config'
import { app, chat, dialog, exportApi, shell, sns, windowControl } from '../services/ipc'
import {
  emitExportSessionStatus,
  emitSingleExportDialogStatus,
  onExportSessionStatusRequest,
  onOpenSingleExport
} from '../services/exportBridge'
import { useContactTypeCountsStore } from '../stores/contactTypeCountsStore'
import { SnsPostItem } from '../components/Sns/SnsPostItem'
import { ContactSnsTimelineDialog } from '../components/Sns/ContactSnsTimelineDialog'
import { AvatarImage } from '../components/AvatarImage'
import { getAvatarLetter, isSingleContactSession } from '../components/Sns/contactSnsTimeline'
import { ExportDefaultsSettingsForm, type ExportDefaultsSettingsPatch } from '../components/Export/ExportDefaultsSettingsForm'
import { SectionInfoTooltip } from '../components/Export/SectionInfoTooltip'
import ExportTaskDialog from '../components/Export/ExportTaskDialog'
import TaskCenterModal from '../components/Export/TaskCenterModal'
import { WriteLayoutSelector } from '../components/Export/WriteLayoutSelector'
import ExportContactRow, { type ExportContactMetricState } from '../components/Export/ExportContactRow'
import SessionLoadDetailModal from '../components/Export/SessionLoadDetailModal'
import SessionMutualFriendsDialog from '../components/Export/SessionMutualFriendsDialog'
import SessionDetailPanel from '../components/Export/SessionDetailPanel'
import {
  applyProgressToTaskPerformance,
  createEmptyProgress,
  createEmptyTaskPerformance,
  finalizeTaskPerformance,
  isTextBatchTask,
  type ExportTask,
  type ExportTaskPayload
} from '../components/Export/exportTaskUtils'
import type { SnsPost } from '../types/sns'
import {
  cloneExportDateRange,
  createDefaultDateRange,
  createDefaultExportDateRangeSelection,
  getExportDateRangeLabel,
  resolveExportDateRangeConfig,
  type ExportDateRangeSelection
} from '../utils/exportDateRange'
import './ExportPage.scss'
import { buildAccountScope } from '../utils/accountScope'
import { withTimeout } from '../utils/async'
import {
  formatAbsoluteDate,
  formatPathBrief,
  formatRecentTimestamp,
  formatYmdDateFromSeconds,
  formatYmdHmDateTime
} from '../utils/formatters'
import { createLogger } from '../utils/logger'
import {
  CONTACT_ENRICH_TIMEOUT_MS,
  DEFAULT_CONTACTS_LOAD_TIMEOUT_MS,
  DETAIL_PRECISE_REFRESH_COOLDOWN_MS,
  EXPORT_AVATAR_ENRICH_BATCH_SIZE,
  EXPORT_REENTER_CONTACTS_SOFT_REFRESH_MS,
  EXPORT_REENTER_SESSION_SOFT_REFRESH_MS,
  EXPORT_REENTER_SNS_SOFT_REFRESH_MS,
  EXPORT_SNS_STATS_CACHE_STALE_MS,
  SESSION_MEDIA_METRIC_BACKGROUND_FEED_INTERVAL_MS,
  SESSION_MEDIA_METRIC_BACKGROUND_FEED_SIZE,
  SESSION_MEDIA_METRIC_BATCH_SIZE,
  SESSION_MEDIA_METRIC_CACHE_FLUSH_DELAY_MS,
  SESSION_MEDIA_METRIC_PREFETCH_ROWS,
  SNS_RANK_DISPLAY_LIMIT,
  SNS_RANK_PAGE_SIZE,
  SNS_USER_POST_COUNT_BATCH_INTERVAL_MS,
  SNS_USER_POST_COUNT_BATCH_SIZE,
  contentTypeLabels,
  conversationTabLabels,
  createTaskId,
  defaultTxtColumns,
  displayNameOptions,
  exportKindPriority,
  formatOptions,
  getContentTypeLabel,
  isContentScopeSession,
  isExportConversationSession,
  matchesContactTab,
  toComparableNameSet,
  type ContentCardType,
  type ContentType,
  type ConversationTab,
  type DisplayNamePreference,
  type ExportDialogState,
  type ExportOptions,
  type SessionLayout,
  type SessionRow,
  type SnsRankMode,
  type SnsTimelineExportFormat,
  type TaskScope,
  type TextExportFormat
} from './export/exportPageShared'
import {
  buildSessionMutualFriendsMetric,
  buildSessionSnsRankings,
  createDefaultSessionLoadStage,
  createDefaultSessionLoadTrace,
  describeSessionMutualFriendRelation,
  getSessionMutualFriendDirectionLabel,
  hasCompleteSessionMediaMetric,
  mergeAvatarCacheIntoContacts,
  pickSessionMediaMetric,
  summarizeMutualFriendBehavior,
  toContactMapFromCaches,
  toSessionRowsWithContacts,
  upsertAvatarCacheFromContacts,
  type ContactsDataSource,
  type ContactsLoadIssue,
  type ContactsLoadSession,
  type SessionContentMetric,
  type SessionDataSource,
  type SessionDetail,
  type SessionExportCacheMeta,
  type SessionExportMetric,
  normalizeMessageCount,
  type SessionLoadStageState,
  type SessionLoadStageStatus,
  type SessionLoadStageSummary,
  type SessionLoadTraceState,
  type SessionMutualFriendItem,
  type SessionMutualFriendsMetric,
  type SessionSnsRankCacheEntry,
  type SessionSnsRankItem,
  type SessionSnsTimelineTarget
} from './export/exportPageSupport'
import {
  applySessionDetailStatsState,
  buildInitialSessionDetailState,
  mergeFastSessionDetailState,
  mergeSessionDetailCacheMetaState,
  mergeSessionDetailExtraState,
  shouldRunPreciseSessionDetailRefresh
} from './export/exportPageDetailSupport'


function ExportPage() {
  const logger = createLogger('ExportPage')
  const location = useLocation()
  const isExportRoute = location.pathname === '/export'

  const [isLoading, setIsLoading] = useState(true)
  const [isSessionEnriching, setIsSessionEnriching] = useState(false)
  const [isSnsStatsLoading, setIsSnsStatsLoading] = useState(true)
  const [isBaseConfigLoading, setIsBaseConfigLoading] = useState(true)
  const [isTaskCenterOpen, setIsTaskCenterOpen] = useState(false)
  const [expandedPerfTaskId, setExpandedPerfTaskId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [sessionDataSource, setSessionDataSource] = useState<SessionDataSource>(null)
  const [sessionContactsUpdatedAt, setSessionContactsUpdatedAt] = useState<number | null>(null)
  const [sessionAvatarUpdatedAt, setSessionAvatarUpdatedAt] = useState<number | null>(null)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [activeTab, setActiveTab] = useState<ConversationTab>('private')
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set())
  const [contactsList, setContactsList] = useState<ContactInfo[]>([])
  const [isContactsListLoading, setIsContactsListLoading] = useState(true)
  const [, setContactsDataSource] = useState<ContactsDataSource>(null)
  const [contactsUpdatedAt, setContactsUpdatedAt] = useState<number | null>(null)
  const [avatarCacheUpdatedAt, setAvatarCacheUpdatedAt] = useState<number | null>(null)
  const [sessionMessageCounts, setSessionMessageCounts] = useState<Record<string, number>>({})
  const [isLoadingSessionCounts, setIsLoadingSessionCounts] = useState(false)
  const [isSessionCountStageReady, setIsSessionCountStageReady] = useState(false)
  const [sessionContentMetrics, setSessionContentMetrics] = useState<Record<string, SessionContentMetric>>({})
  const [sessionLoadTraceMap, setSessionLoadTraceMap] = useState<Record<string, SessionLoadTraceState>>({})
  const [sessionLoadProgressPulseMap, setSessionLoadProgressPulseMap] = useState<Record<string, { at: number; delta: number }>>({})
  const [contactsLoadTimeoutMs, setContactsLoadTimeoutMs] = useState(DEFAULT_CONTACTS_LOAD_TIMEOUT_MS)
  const [contactsLoadSession, setContactsLoadSession] = useState<ContactsLoadSession | null>(null)
  const [contactsLoadIssue, setContactsLoadIssue] = useState<ContactsLoadIssue | null>(null)
  const [showContactsDiagnostics, setShowContactsDiagnostics] = useState(false)
  const [contactsDiagnosticTick, setContactsDiagnosticTick] = useState(Date.now())
  const [showSessionDetailPanel, setShowSessionDetailPanel] = useState(false)
  const [showSessionLoadDetailModal, setShowSessionLoadDetailModal] = useState(false)
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null)
  const [isLoadingSessionDetail, setIsLoadingSessionDetail] = useState(false)
  const [isLoadingSessionDetailExtra, setIsLoadingSessionDetailExtra] = useState(false)
  const [isRefreshingSessionDetailStats, setIsRefreshingSessionDetailStats] = useState(false)
  const [isLoadingSessionRelationStats, setIsLoadingSessionRelationStats] = useState(false)
  const [copiedDetailField, setCopiedDetailField] = useState<string | null>(null)
  const [snsUserPostCounts, setSnsUserPostCounts] = useState<Record<string, number>>({})
  const [snsUserPostCountsStatus, setSnsUserPostCountsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [sessionSnsTimelineTarget, setSessionSnsTimelineTarget] = useState<SessionSnsTimelineTarget | null>(null)
  const [sessionSnsTimelinePosts, setSessionSnsTimelinePosts] = useState<SnsPost[]>([])
  const [sessionSnsTimelineLoading, setSessionSnsTimelineLoading] = useState(false)
  const [sessionSnsTimelineLoadingMore, setSessionSnsTimelineLoadingMore] = useState(false)
  const [sessionSnsTimelineHasMore, setSessionSnsTimelineHasMore] = useState(false)
  const [sessionSnsTimelineTotalPosts, setSessionSnsTimelineTotalPosts] = useState<number | null>(null)
  const [sessionSnsTimelineStatsLoading, setSessionSnsTimelineStatsLoading] = useState(false)
  const [sessionSnsRankMode, setSessionSnsRankMode] = useState<SnsRankMode | null>(null)
  const [sessionSnsLikeRankings, setSessionSnsLikeRankings] = useState<SessionSnsRankItem[]>([])
  const [sessionSnsCommentRankings, setSessionSnsCommentRankings] = useState<SessionSnsRankItem[]>([])
  const [sessionSnsRankLoading, setSessionSnsRankLoading] = useState(false)
  const [sessionSnsRankError, setSessionSnsRankError] = useState<string | null>(null)
  const [sessionSnsRankLoadedPosts, setSessionSnsRankLoadedPosts] = useState(0)
  const [sessionSnsRankTotalPosts, setSessionSnsRankTotalPosts] = useState<number | null>(null)
  const [sessionMutualFriendsMetrics, setSessionMutualFriendsMetrics] = useState<Record<string, SessionMutualFriendsMetric>>({})
  const [sessionMutualFriendsDialogTarget, setSessionMutualFriendsDialogTarget] = useState<SessionSnsTimelineTarget | null>(null)
  const [sessionMutualFriendsSearch, setSessionMutualFriendsSearch] = useState('')

  const [exportFolder, setExportFolder] = useState('')
  const [writeLayout, setWriteLayout] = useState<configService.ExportWriteLayout>('B')
  const [sessionNameWithTypePrefix, setSessionNameWithTypePrefix] = useState(true)
  const [snsExportFormat, setSnsExportFormat] = useState<SnsTimelineExportFormat>('html')
  const [snsExportImages, setSnsExportImages] = useState(false)
  const [snsExportLivePhotos, setSnsExportLivePhotos] = useState(false)
  const [snsExportVideos, setSnsExportVideos] = useState(false)
  const [isTimeRangeDialogOpen, setIsTimeRangeDialogOpen] = useState(false)
  const [isExportDefaultsModalOpen, setIsExportDefaultsModalOpen] = useState(false)
  const [timeRangeSelection, setTimeRangeSelection] = useState<ExportDateRangeSelection>(() => createDefaultExportDateRangeSelection())
  const [exportDefaultFormat, setExportDefaultFormat] = useState<TextExportFormat>('excel')
  const [exportDefaultAvatars, setExportDefaultAvatars] = useState(true)
  const [exportDefaultDateRangeSelection, setExportDefaultDateRangeSelection] = useState<ExportDateRangeSelection>(() => createDefaultExportDateRangeSelection())
  const [exportDefaultMedia, setExportDefaultMedia] = useState<configService.ExportDefaultMediaConfig>({
    images: true,
    videos: true,
    voices: true,
    emojis: true
  })
  const [exportDefaultVoiceAsText, setExportDefaultVoiceAsText] = useState(false)
  const [exportDefaultExcelCompactColumns, setExportDefaultExcelCompactColumns] = useState(true)
  const [exportDefaultConcurrency, setExportDefaultConcurrency] = useState(2)

  const [options, setOptions] = useState<ExportOptions>({
    format: 'json',
    dateRange: {
      start: new Date(new Date().setHours(0, 0, 0, 0)),
      end: new Date()
    },
    useAllTime: false,
    exportAvatars: true,
    exportMedia: true,
    exportImages: true,
    exportVoices: true,
    exportVideos: true,
    exportEmojis: true,
    exportVoiceAsText: false,
    excelCompactColumns: true,
    txtColumns: defaultTxtColumns,
    displayNamePreference: 'remark',
    exportConcurrency: 2
  })

  const [exportDialog, setExportDialog] = useState<ExportDialogState>({
    open: false,
    scope: 'single',
    sessionIds: [],
    sessionNames: [],
    title: ''
  })

  const [tasks, setTasks] = useState<ExportTask[]>([])
  const [lastExportBySession, setLastExportBySession] = useState<Record<string, number>>({})
  const [lastExportByContent, setLastExportByContent] = useState<Record<string, number>>({})
  const [exportRecordsBySession, setExportRecordsBySession] = useState<Record<string, configService.ExportSessionRecordEntry[]>>({})
  const [lastSnsExportPostCount, setLastSnsExportPostCount] = useState(0)
  const [snsStats, setSnsStats] = useState<{ totalPosts: number; totalFriends: number }>({
    totalPosts: 0,
    totalFriends: 0
  })
  const [hasSeededSnsStats, setHasSeededSnsStats] = useState(false)
  const [nowTick, setNowTick] = useState(Date.now())
  const [isContactsListAtTop, setIsContactsListAtTop] = useState(true)
  const tabCounts = useContactTypeCountsStore(state => state.tabCounts)
  const isSharedTabCountsLoading = useContactTypeCountsStore(state => state.isLoading)
  const isSharedTabCountsReady = useContactTypeCountsStore(state => state.isReady)
  const ensureSharedTabCountsLoaded = useContactTypeCountsStore(state => state.ensureLoaded)
  const syncContactTypeCounts = useContactTypeCountsStore(state => state.syncFromContacts)

  const progressUnsubscribeRef = useRef<(() => void) | null>(null)
  const runningTaskIdRef = useRef<string | null>(null)
  const tasksRef = useRef<ExportTask[]>([])
  const hasSeededSnsStatsRef = useRef(false)
  const sessionLoadTokenRef = useRef(0)
  const preselectAppliedRef = useRef(false)
  const exportCacheScopeRef = useRef('default')
  const exportCacheScopeReadyRef = useRef(false)
  const contactsLoadVersionRef = useRef(0)
  const contactsLoadAttemptRef = useRef(0)
  const contactsLoadTimeoutTimerRef = useRef<number | null>(null)
  const contactsLoadTimeoutMsRef = useRef(DEFAULT_CONTACTS_LOAD_TIMEOUT_MS)
  const contactsAvatarCacheRef = useRef<Record<string, configService.ContactsAvatarCacheEntry>>({})
  const contactsVirtuosoRef = useRef<VirtuosoHandle | null>(null)
  const sessionTableSectionRef = useRef<HTMLDivElement | null>(null)
  const detailRequestSeqRef = useRef(0)
  const sessionsRef = useRef<SessionRow[]>([])
  const sessionContentMetricsRef = useRef<Record<string, SessionContentMetric>>({})
  const contactsListSizeRef = useRef(0)
  const contactsUpdatedAtRef = useRef<number | null>(null)
  const sessionsHydratedAtRef = useRef(0)
  const snsStatsHydratedAtRef = useRef(0)
  const inProgressSessionIdsRef = useRef<string[]>([])
  const activeTaskCountRef = useRef(0)
  const hasBaseConfigReadyRef = useRef(false)
  const sessionCountRequestIdRef = useRef(0)
  const isLoadingSessionCountsRef = useRef(false)
  const activeTabRef = useRef<ConversationTab>('private')
  const detailStatsPriorityRef = useRef(false)
  const sessionSnsTimelinePostsRef = useRef<SnsPost[]>([])
  const sessionSnsTimelineLoadingRef = useRef(false)
  const sessionSnsTimelineRequestTokenRef = useRef(0)
  const sessionSnsRankRequestTokenRef = useRef(0)
  const sessionSnsRankLoadingRef = useRef(false)
  const sessionSnsRankCacheRef = useRef<Record<string, SessionSnsRankCacheEntry>>({})
  const snsUserPostCountsHydrationTokenRef = useRef(0)
  const snsUserPostCountsBatchTimerRef = useRef<number | null>(null)
  const sessionPreciseRefreshAtRef = useRef<Record<string, number>>({})
  const sessionLoadProgressSnapshotRef = useRef<Record<string, { loaded: number; total: number }>>({})
  const sessionMediaMetricQueueRef = useRef<string[]>([])
  const sessionMediaMetricQueuedSetRef = useRef<Set<string>>(new Set())
  const sessionMediaMetricLoadingSetRef = useRef<Set<string>>(new Set())
  const sessionMediaMetricReadySetRef = useRef<Set<string>>(new Set())
  const sessionMediaMetricRunIdRef = useRef(0)
  const sessionMediaMetricWorkerRunningRef = useRef(false)
  const sessionMediaMetricBackgroundFeedTimerRef = useRef<number | null>(null)
  const sessionMediaMetricPersistTimerRef = useRef<number | null>(null)
  const sessionMediaMetricPendingPersistRef = useRef<Record<string, configService.ExportSessionContentMetricCacheEntry>>({})
  const sessionMediaMetricVisibleRangeRef = useRef<{ startIndex: number; endIndex: number }>({
    startIndex: 0,
    endIndex: -1
  })
  const sessionMutualFriendsMetricsRef = useRef<Record<string, SessionMutualFriendsMetric>>({})
  const sessionMutualFriendsDirectMetricsRef = useRef<Record<string, SessionMutualFriendsMetric>>({})
  const sessionMutualFriendsQueueRef = useRef<string[]>([])
  const sessionMutualFriendsQueuedSetRef = useRef<Set<string>>(new Set())
  const sessionMutualFriendsLoadingSetRef = useRef<Set<string>>(new Set())
  const sessionMutualFriendsReadySetRef = useRef<Set<string>>(new Set())
  const sessionMutualFriendsRunIdRef = useRef(0)
  const sessionMutualFriendsWorkerRunningRef = useRef(false)
  const sessionMutualFriendsBackgroundFeedTimerRef = useRef<number | null>(null)
  const sessionMutualFriendsVisibleRangeRef = useRef<{ startIndex: number; endIndex: number }>({
    startIndex: 0,
    endIndex: -1
  })

  const ensureExportCacheScope = useCallback(async (): Promise<string> => {
    if (exportCacheScopeReadyRef.current) {
      return exportCacheScopeRef.current
    }
    const [myWxid, dbPath] = await Promise.all([
      configService.getMyWxid(),
      configService.getDbPath()
    ])
    const scopeKey = buildAccountScope(dbPath, myWxid)
    exportCacheScopeRef.current = scopeKey
    exportCacheScopeReadyRef.current = true
    return scopeKey
  }, [])

  const loadContactsCaches = useCallback(async (scopeKey: string) => {
    const [contactsItem, avatarItem] = await Promise.all([
      configService.getContactsListCache(scopeKey),
      configService.getContactsAvatarCache(scopeKey)
    ])
    return {
      contactsItem,
      avatarItem
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const value = await configService.getContactsLoadTimeoutMs()
        if (!cancelled) {
          setContactsLoadTimeoutMs(value)
        }
      } catch (error) {
        logger.error('读取通讯录超时配置失败:', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    contactsLoadTimeoutMsRef.current = contactsLoadTimeoutMs
  }, [contactsLoadTimeoutMs])

  useEffect(() => {
    isLoadingSessionCountsRef.current = isLoadingSessionCounts
  }, [isLoadingSessionCounts])

  useEffect(() => {
    sessionContentMetricsRef.current = sessionContentMetrics
  }, [sessionContentMetrics])

  useEffect(() => {
    sessionMutualFriendsMetricsRef.current = sessionMutualFriendsMetrics
  }, [sessionMutualFriendsMetrics])

  const patchSessionLoadTraceStage = useCallback((
    sessionIds: string[],
    stageKey: keyof SessionLoadTraceState,
    status: SessionLoadStageStatus,
    options?: { force?: boolean; error?: string }
  ) => {
    if (sessionIds.length === 0) return
    const now = Date.now()
    setSessionLoadTraceMap(prev => {
      let changed = false
      const next = { ...prev }
      for (const sessionIdRaw of sessionIds) {
        const sessionId = String(sessionIdRaw || '').trim()
        if (!sessionId) continue
        const prevTrace = next[sessionId] || createDefaultSessionLoadTrace()
        const prevStage = prevTrace[stageKey] || createDefaultSessionLoadStage()
        if (!options?.force && prevStage.status === 'done' && status !== 'done') {
          continue
        }
        let stageChanged = false
        const nextStage: SessionLoadStageState = { ...prevStage }
        if (nextStage.status !== status) {
          nextStage.status = status
          stageChanged = true
        }
        if (status === 'loading') {
          if (!nextStage.startedAt) {
            nextStage.startedAt = now
            stageChanged = true
          }
          if (nextStage.finishedAt) {
            nextStage.finishedAt = undefined
            stageChanged = true
          }
          if (nextStage.error) {
            nextStage.error = undefined
            stageChanged = true
          }
        } else if (status === 'done') {
          if (!nextStage.startedAt) {
            nextStage.startedAt = now
            stageChanged = true
          }
          if (!nextStage.finishedAt) {
            nextStage.finishedAt = now
            stageChanged = true
          }
          if (nextStage.error) {
            nextStage.error = undefined
            stageChanged = true
          }
        } else if (status === 'failed') {
          if (!nextStage.startedAt) {
            nextStage.startedAt = now
            stageChanged = true
          }
          if (!nextStage.finishedAt) {
            nextStage.finishedAt = now
            stageChanged = true
          }
          const nextError = options?.error || '加载失败'
          if (nextStage.error !== nextError) {
            nextStage.error = nextError
            stageChanged = true
          }
        } else if (status === 'pending') {
          if (nextStage.startedAt !== undefined) {
            nextStage.startedAt = undefined
            stageChanged = true
          }
          if (nextStage.finishedAt !== undefined) {
            nextStage.finishedAt = undefined
            stageChanged = true
          }
          if (nextStage.error !== undefined) {
            nextStage.error = undefined
            stageChanged = true
          }
        }
        if (!stageChanged) continue
        next[sessionId] = {
          ...prevTrace,
          [stageKey]: nextStage
        }
        changed = true
      }
      return changed ? next : prev
    })
  }, [])

  const loadContactsList = useCallback(async (options?: { scopeKey?: string }) => {
    const scopeKey = options?.scopeKey || await ensureExportCacheScope()
    const loadVersion = contactsLoadVersionRef.current + 1
    contactsLoadVersionRef.current = loadVersion
    contactsLoadAttemptRef.current += 1
    const startedAt = Date.now()
    const timeoutMs = contactsLoadTimeoutMsRef.current
    const requestId = `export-contacts-${startedAt}-${contactsLoadAttemptRef.current}`
    setContactsLoadSession({
      requestId,
      startedAt,
      attempt: contactsLoadAttemptRef.current,
      timeoutMs
    })
    setContactsLoadIssue(null)
    setShowContactsDiagnostics(false)
    if (contactsLoadTimeoutTimerRef.current) {
      window.clearTimeout(contactsLoadTimeoutTimerRef.current)
      contactsLoadTimeoutTimerRef.current = null
    }
    const timeoutTimerId = window.setTimeout(() => {
      if (contactsLoadVersionRef.current !== loadVersion) return
      const elapsedMs = Date.now() - startedAt
      setContactsLoadIssue({
        kind: 'timeout',
        title: '联系人列表加载超时',
        message: `等待超过 ${timeoutMs}ms，联系人列表仍未返回。`,
        reason: 'chat.getContacts 长时间未返回，可能是数据库查询繁忙或连接异常。',
        occurredAt: Date.now(),
        elapsedMs
      })
    }, timeoutMs)
    contactsLoadTimeoutTimerRef.current = timeoutTimerId

    setIsContactsListLoading(true)
    try {
      const contactsResult = await chat.getContacts()
      if (contactsLoadVersionRef.current !== loadVersion) return

      if (contactsResult.success && contactsResult.contacts) {
        if (contactsLoadTimeoutTimerRef.current === timeoutTimerId) {
          window.clearTimeout(contactsLoadTimeoutTimerRef.current)
          contactsLoadTimeoutTimerRef.current = null
        }
        const contactsWithAvatarCache = mergeAvatarCacheIntoContacts(
          contactsResult.contacts,
          contactsAvatarCacheRef.current
        )
        setContactsList(contactsWithAvatarCache)
        syncContactTypeCounts(contactsWithAvatarCache)
        setContactsDataSource('network')
        setContactsUpdatedAt(Date.now())
        setContactsLoadIssue(null)
        setIsContactsListLoading(false)

        const upsertResult = upsertAvatarCacheFromContacts(
          contactsAvatarCacheRef.current,
          contactsWithAvatarCache,
          { prune: true }
        )
        contactsAvatarCacheRef.current = upsertResult.avatarEntries
        if (upsertResult.updatedAt) {
          setAvatarCacheUpdatedAt(upsertResult.updatedAt)
        }

        void configService.setContactsAvatarCache(scopeKey, contactsAvatarCacheRef.current).catch((error) => {
          logger.error('写入导出页头像缓存失败:', error)
        })
        void configService.setContactsListCache(
          scopeKey,
          contactsWithAvatarCache.map(contact => ({
            username: contact.username,
            displayName: contact.displayName,
            remark: contact.remark,
            nickname: contact.nickname,
            type: contact.type
          }))
        ).catch((error) => {
          logger.error('写入导出页通讯录缓存失败:', error)
        })
        return
      }

      const elapsedMs = Date.now() - startedAt
      setContactsLoadIssue({
        kind: 'error',
        title: '联系人列表加载失败',
        message: '联系人接口返回失败，未拿到联系人列表。',
        reason: 'chat.getContacts 返回 success=false。',
        errorDetail: contactsResult.error || '未知错误',
        occurredAt: Date.now(),
        elapsedMs
      })
    } catch (error) {
      logger.error('加载导出页联系人失败:', error)
      const elapsedMs = Date.now() - startedAt
      setContactsLoadIssue({
        kind: 'error',
        title: '联系人列表加载失败',
        message: '联系人请求执行异常。',
        reason: '调用 chat.getContacts 发生异常。',
        errorDetail: String(error),
        occurredAt: Date.now(),
        elapsedMs
      })
    } finally {
      if (contactsLoadTimeoutTimerRef.current === timeoutTimerId) {
        window.clearTimeout(contactsLoadTimeoutTimerRef.current)
        contactsLoadTimeoutTimerRef.current = null
      }
      if (contactsLoadVersionRef.current === loadVersion) {
        setIsContactsListLoading(false)
      }
    }
  }, [ensureExportCacheScope, syncContactTypeCounts])

  useEffect(() => {
    if (!isExportRoute) return
    let cancelled = false
    void (async () => {
      const scopeKey = await ensureExportCacheScope()
      if (cancelled) return
      let cachedContactsCount = 0
      let cachedContactsUpdatedAt = 0
      try {
        const [cacheItem, avatarCacheItem] = await Promise.all([
          configService.getContactsListCache(scopeKey),
          configService.getContactsAvatarCache(scopeKey)
        ])
        cachedContactsCount = Array.isArray(cacheItem?.contacts) ? cacheItem.contacts.length : 0
        cachedContactsUpdatedAt = Number(cacheItem?.updatedAt || 0)
        const avatarCacheMap = avatarCacheItem?.avatars || {}
        contactsAvatarCacheRef.current = avatarCacheMap
        setAvatarCacheUpdatedAt(avatarCacheItem?.updatedAt || null)
        if (!cancelled && cacheItem && Array.isArray(cacheItem.contacts) && cacheItem.contacts.length > 0) {
          const cachedContacts: ContactInfo[] = cacheItem.contacts.map(contact => ({
            ...contact,
            avatarUrl: avatarCacheMap[contact.username]?.avatarUrl
          }))
          setContactsList(cachedContacts)
          syncContactTypeCounts(cachedContacts)
          setContactsDataSource('cache')
          setContactsUpdatedAt(cacheItem.updatedAt || null)
          setIsContactsListLoading(false)
        }
      } catch (error) {
        logger.error('读取导出页联系人缓存失败:', error)
      }

      const latestContactsUpdatedAt = Math.max(
        Number(contactsUpdatedAtRef.current || 0),
        cachedContactsUpdatedAt
      )
      const hasFreshContactSnapshot = (contactsListSizeRef.current > 0 || cachedContactsCount > 0) &&
        latestContactsUpdatedAt > 0 &&
        Date.now() - latestContactsUpdatedAt <= EXPORT_REENTER_CONTACTS_SOFT_REFRESH_MS

      if (!cancelled && !hasFreshContactSnapshot) {
        void loadContactsList({ scopeKey })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isExportRoute, ensureExportCacheScope, loadContactsList, syncContactTypeCounts])

  useEffect(() => {
    if (isExportRoute) return
    contactsLoadVersionRef.current += 1
  }, [isExportRoute])

  useEffect(() => {
    if (contactsLoadTimeoutTimerRef.current) {
      window.clearTimeout(contactsLoadTimeoutTimerRef.current)
      contactsLoadTimeoutTimerRef.current = null
    }
    return () => {
      if (contactsLoadTimeoutTimerRef.current) {
        window.clearTimeout(contactsLoadTimeoutTimerRef.current)
        contactsLoadTimeoutTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!contactsLoadIssue || contactsList.length > 0) return
    if (!(isContactsListLoading && contactsLoadIssue.kind === 'timeout')) return
    const timer = window.setInterval(() => {
      setContactsDiagnosticTick(Date.now())
    }, 500)
    return () => window.clearInterval(timer)
  }, [contactsList.length, isContactsListLoading, contactsLoadIssue])

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    contactsListSizeRef.current = contactsList.length
  }, [contactsList.length])

  useEffect(() => {
    contactsUpdatedAtRef.current = contactsUpdatedAt
  }, [contactsUpdatedAt])

  useEffect(() => {
    if (!expandedPerfTaskId) return
    const target = tasks.find(task => task.id === expandedPerfTaskId)
    if (!target || !isTextBatchTask(target)) {
      setExpandedPerfTaskId(null)
    }
  }, [tasks, expandedPerfTaskId])

  useEffect(() => {
    hasSeededSnsStatsRef.current = hasSeededSnsStats
  }, [hasSeededSnsStats])

  useEffect(() => {
    sessionSnsTimelinePostsRef.current = sessionSnsTimelinePosts
  }, [sessionSnsTimelinePosts])

  const preselectSessionIds = useMemo(() => {
    const state = location.state as { preselectSessionIds?: unknown; preselectSessionId?: unknown } | null
    const rawList = Array.isArray(state?.preselectSessionIds)
      ? state?.preselectSessionIds
      : (typeof state?.preselectSessionId === 'string' ? [state.preselectSessionId] : [])

    return rawList
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
  }, [location.state])

  useEffect(() => {
    if (!isExportRoute) return
    const timer = setInterval(() => setNowTick(Date.now()), 60 * 1000)
    return () => clearInterval(timer)
  }, [isExportRoute])

  useEffect(() => {
    if (!isTaskCenterOpen || !expandedPerfTaskId) return
    const target = tasks.find(task => task.id === expandedPerfTaskId)
    if (!target || target.status !== 'running' || !isTextBatchTask(target)) return
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isTaskCenterOpen, expandedPerfTaskId, tasks])

  const loadBaseConfig = useCallback(async (): Promise<boolean> => {
    setIsBaseConfigLoading(true)
    let isReady = true
    try {
      const [savedPath, savedFormat, savedAvatars, savedMedia, savedVoiceAsText, savedExcelCompactColumns, savedTxtColumns, savedConcurrency, savedSessionMap, savedContentMap, savedSessionRecordMap, savedSnsPostCount, savedWriteLayout, savedSessionNameWithTypePrefix, savedDefaultDateRange, exportCacheScope] = await Promise.all([
        configService.getExportPath(),
        configService.getExportDefaultFormat(),
        configService.getExportDefaultAvatars(),
        configService.getExportDefaultMedia(),
        configService.getExportDefaultVoiceAsText(),
        configService.getExportDefaultExcelCompactColumns(),
        configService.getExportDefaultTxtColumns(),
        configService.getExportDefaultConcurrency(),
        configService.getExportLastSessionRunMap(),
        configService.getExportLastContentRunMap(),
        configService.getExportSessionRecordMap(),
        configService.getExportLastSnsPostCount(),
        configService.getExportWriteLayout(),
        configService.getExportSessionNamePrefixEnabled(),
        configService.getExportDefaultDateRange(),
        ensureExportCacheScope()
      ])

      const cachedSnsStats = await configService.getExportSnsStatsCache(exportCacheScope)

      if (savedPath) {
        setExportFolder(savedPath)
      } else {
        const downloadsPath = await app.getDownloadsPath()
        setExportFolder(downloadsPath)
      }

      setWriteLayout(savedWriteLayout)
      setSessionNameWithTypePrefix(savedSessionNameWithTypePrefix)
      setLastExportBySession(savedSessionMap)
      setLastExportByContent(savedContentMap)
      setExportRecordsBySession(savedSessionRecordMap)
      setLastSnsExportPostCount(savedSnsPostCount)
      setExportDefaultFormat((savedFormat as TextExportFormat) || 'excel')
      setExportDefaultAvatars(savedAvatars ?? true)
      setExportDefaultMedia(savedMedia ?? {
        images: true,
        videos: true,
        voices: true,
        emojis: true
      })
      setExportDefaultVoiceAsText(savedVoiceAsText ?? false)
      setExportDefaultExcelCompactColumns(savedExcelCompactColumns ?? true)
      setExportDefaultConcurrency(savedConcurrency ?? 2)
      const resolvedDefaultDateRange = resolveExportDateRangeConfig(savedDefaultDateRange)
      setExportDefaultDateRangeSelection(resolvedDefaultDateRange)
      setTimeRangeSelection(resolvedDefaultDateRange)

      if (cachedSnsStats && Date.now() - cachedSnsStats.updatedAt <= EXPORT_SNS_STATS_CACHE_STALE_MS) {
        setSnsStats({
          totalPosts: cachedSnsStats.totalPosts || 0,
          totalFriends: cachedSnsStats.totalFriends || 0
        })
        snsStatsHydratedAtRef.current = Date.now()
        hasSeededSnsStatsRef.current = true
        setHasSeededSnsStats(true)
      }

      const txtColumns = savedTxtColumns && savedTxtColumns.length > 0 ? savedTxtColumns : defaultTxtColumns
      setOptions(prev => ({
        ...prev,
        format: ((savedFormat as TextExportFormat) || 'excel'),
        exportAvatars: savedAvatars ?? true,
        exportMedia: Boolean(
          (savedMedia?.images ?? prev.exportImages) ||
          (savedMedia?.voices ?? prev.exportVoices) ||
          (savedMedia?.videos ?? prev.exportVideos) ||
          (savedMedia?.emojis ?? prev.exportEmojis)
        ),
        exportImages: savedMedia?.images ?? prev.exportImages,
        exportVoices: savedMedia?.voices ?? prev.exportVoices,
        exportVideos: savedMedia?.videos ?? prev.exportVideos,
        exportEmojis: savedMedia?.emojis ?? prev.exportEmojis,
        exportVoiceAsText: savedVoiceAsText ?? prev.exportVoiceAsText,
        excelCompactColumns: savedExcelCompactColumns ?? prev.excelCompactColumns,
        txtColumns,
        exportConcurrency: savedConcurrency ?? prev.exportConcurrency
      }))
    } catch (error) {
      isReady = false
      logger.error('加载导出配置失败:', error)
    } finally {
      setIsBaseConfigLoading(false)
    }
    if (isReady) {
      hasBaseConfigReadyRef.current = true
    }
    return isReady
  }, [ensureExportCacheScope])

  const loadSnsStats = useCallback(async (options?: { full?: boolean; silent?: boolean }) => {
    if (!options?.silent) {
      setIsSnsStatsLoading(true)
    }

    const applyStats = async (next: { totalPosts: number; totalFriends: number } | null) => {
      if (!next) return
      const normalized = {
        totalPosts: Number.isFinite(next.totalPosts) ? Math.max(0, Math.floor(next.totalPosts)) : 0,
        totalFriends: Number.isFinite(next.totalFriends) ? Math.max(0, Math.floor(next.totalFriends)) : 0
      }
      setSnsStats(normalized)
      snsStatsHydratedAtRef.current = Date.now()
      hasSeededSnsStatsRef.current = true
      setHasSeededSnsStats(true)
      if (exportCacheScopeReadyRef.current) {
        await configService.setExportSnsStatsCache(exportCacheScopeRef.current, normalized)
      }
    }

    try {
      const fastResult = await withTimeout(sns.getExportStatsFast(), 2200)
      if (fastResult?.success && fastResult.data) {
        const fastStats = {
          totalPosts: fastResult.data.totalPosts || 0,
          totalFriends: fastResult.data.totalFriends || 0
        }
        if (fastStats.totalPosts > 0 || hasSeededSnsStatsRef.current) {
          await applyStats(fastStats)
        }
      }

      if (options?.full) {
        const result = await withTimeout(sns.getExportStats(), 9000)
        if (result?.success && result.data) {
          await applyStats({
            totalPosts: result.data.totalPosts || 0,
            totalFriends: result.data.totalFriends || 0
          })
        }
      }
    } catch (error) {
      logger.error('加载朋友圈导出统计失败:', error)
    } finally {
      if (!options?.silent) {
        setIsSnsStatsLoading(false)
      }
    }
  }, [])

  const loadSnsUserPostCounts = useCallback(async (options?: { force?: boolean }) => {
    if (snsUserPostCountsStatus === 'loading') return
    if (!options?.force && snsUserPostCountsStatus === 'ready') return

    const targetSessionIds = sessionsRef.current
      .filter((session) => session.hasSession && isSingleContactSession(session.username))
      .map((session) => session.username)

    snsUserPostCountsHydrationTokenRef.current += 1
    const runToken = snsUserPostCountsHydrationTokenRef.current
    if (snsUserPostCountsBatchTimerRef.current) {
      window.clearTimeout(snsUserPostCountsBatchTimerRef.current)
      snsUserPostCountsBatchTimerRef.current = null
    }

    if (targetSessionIds.length === 0) {
      setSnsUserPostCountsStatus('ready')
      return
    }

    const scopeKey = exportCacheScopeReadyRef.current
      ? exportCacheScopeRef.current
      : await ensureExportCacheScope()
    const targetSet = new Set(targetSessionIds)
    let cachedCounts: Record<string, number> = {}
    try {
      const cached = await configService.getExportSnsUserPostCountsCache(scopeKey)
      cachedCounts = cached?.counts || {}
    } catch (cacheError) {
      logger.error('读取导出页朋友圈条数缓存失败:', cacheError)
    }

    const cachedTargetCounts = Object.entries(cachedCounts).reduce<Record<string, number>>((acc, [sessionId, countRaw]) => {
      if (!targetSet.has(sessionId)) return acc
      const nextCount = Number(countRaw)
      acc[sessionId] = Number.isFinite(nextCount) ? Math.max(0, Math.floor(nextCount)) : 0
      return acc
    }, {})
    const cachedReadySessionIds = Object.keys(cachedTargetCounts)
    if (cachedReadySessionIds.length > 0) {
      setSnsUserPostCounts(prev => ({ ...prev, ...cachedTargetCounts }))
      patchSessionLoadTraceStage(cachedReadySessionIds, 'snsPostCounts', 'done')
    }

    const pendingSessionIds = options?.force
      ? targetSessionIds
      : targetSessionIds.filter((sessionId) => !(sessionId in cachedTargetCounts))
    if (pendingSessionIds.length === 0) {
      setSnsUserPostCountsStatus('ready')
      return
    }

    patchSessionLoadTraceStage(pendingSessionIds, 'snsPostCounts', 'pending', { force: true })
    patchSessionLoadTraceStage(pendingSessionIds, 'snsPostCounts', 'loading')
    setSnsUserPostCountsStatus('loading')

    let normalizedCounts: Record<string, number> = {}
    try {
      const result = await sns.getUserPostCounts()
      if (runToken !== snsUserPostCountsHydrationTokenRef.current) return

      if (!result.success || !result.counts) {
        patchSessionLoadTraceStage(pendingSessionIds, 'snsPostCounts', 'failed', {
          error: result.error || '朋友圈条数统计失败'
        })
        setSnsUserPostCountsStatus('error')
        return
      }

      for (const [rawUsername, rawCount] of Object.entries(result.counts)) {
        const username = String(rawUsername || '').trim()
        if (!username) continue
        const value = Number(rawCount)
        normalizedCounts[username] = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
      }

      void (async () => {
        try {
          await configService.setExportSnsUserPostCountsCache(scopeKey, normalizedCounts)
        } catch (cacheError) {
          logger.error('写入导出页朋友圈条数缓存失败:', cacheError)
        }
      })()
    } catch (error) {
      logger.error('加载朋友圈用户条数失败:', error)
      if (runToken !== snsUserPostCountsHydrationTokenRef.current) return
      patchSessionLoadTraceStage(pendingSessionIds, 'snsPostCounts', 'failed', {
        error: String(error)
      })
      setSnsUserPostCountsStatus('error')
      return
    }

    let cursor = 0
    const applyBatch = () => {
      if (runToken !== snsUserPostCountsHydrationTokenRef.current) return

      const batchSessionIds = pendingSessionIds.slice(cursor, cursor + SNS_USER_POST_COUNT_BATCH_SIZE)
      if (batchSessionIds.length === 0) {
        setSnsUserPostCountsStatus('ready')
        snsUserPostCountsBatchTimerRef.current = null
        return
      }

      const batchCounts: Record<string, number> = {}
      for (const sessionId of batchSessionIds) {
        const nextCount = normalizedCounts[sessionId]
        batchCounts[sessionId] = Number.isFinite(nextCount) ? Math.max(0, Math.floor(nextCount)) : 0
      }

      setSnsUserPostCounts(prev => ({ ...prev, ...batchCounts }))
      patchSessionLoadTraceStage(batchSessionIds, 'snsPostCounts', 'done')

      cursor += batchSessionIds.length
      if (cursor < targetSessionIds.length) {
        snsUserPostCountsBatchTimerRef.current = window.setTimeout(applyBatch, SNS_USER_POST_COUNT_BATCH_INTERVAL_MS)
      } else {
        setSnsUserPostCountsStatus('ready')
        snsUserPostCountsBatchTimerRef.current = null
      }
    }

    applyBatch()
  }, [ensureExportCacheScope, patchSessionLoadTraceStage, snsUserPostCountsStatus])

  const loadSessionSnsTimelinePosts = useCallback(async (target: SessionSnsTimelineTarget, options?: { reset?: boolean }) => {
    const reset = Boolean(options?.reset)
    if (sessionSnsTimelineLoadingRef.current) return

    sessionSnsTimelineLoadingRef.current = true
    if (reset) {
      setSessionSnsTimelineLoading(true)
      setSessionSnsTimelineLoadingMore(false)
      setSessionSnsTimelineHasMore(false)
    } else {
      setSessionSnsTimelineLoadingMore(true)
    }

    const requestToken = ++sessionSnsTimelineRequestTokenRef.current

    try {
      const limit = 20
      let endTime: number | undefined
      if (!reset && sessionSnsTimelinePostsRef.current.length > 0) {
        endTime = sessionSnsTimelinePostsRef.current[sessionSnsTimelinePostsRef.current.length - 1].createTime - 1
      }

      const result = await sns.getTimeline(limit, 0, [target.username], '', undefined, endTime)
      if (requestToken !== sessionSnsTimelineRequestTokenRef.current) return

      if (!result.success || !Array.isArray(result.timeline)) {
        if (reset) {
          setSessionSnsTimelinePosts([])
          setSessionSnsTimelineHasMore(false)
        }
        return
      }

      const timeline = [...(result.timeline as SnsPost[])].sort((a, b) => b.createTime - a.createTime)
      if (reset) {
        setSessionSnsTimelinePosts(timeline)
        setSessionSnsTimelineHasMore(timeline.length >= limit)
        return
      }

      const existingIds = new Set(sessionSnsTimelinePostsRef.current.map((post) => post.id))
      const uniqueOlder = timeline.filter((post) => !existingIds.has(post.id))
      if (uniqueOlder.length > 0) {
        const merged = [...sessionSnsTimelinePostsRef.current, ...uniqueOlder].sort((a, b) => b.createTime - a.createTime)
        setSessionSnsTimelinePosts(merged)
      }
      if (timeline.length < limit) {
        setSessionSnsTimelineHasMore(false)
      }
    } catch (error) {
      logger.error('加载联系人朋友圈失败:', error)
      if (requestToken === sessionSnsTimelineRequestTokenRef.current && reset) {
        setSessionSnsTimelinePosts([])
        setSessionSnsTimelineHasMore(false)
      }
    } finally {
      if (requestToken === sessionSnsTimelineRequestTokenRef.current) {
        sessionSnsTimelineLoadingRef.current = false
        setSessionSnsTimelineLoading(false)
        setSessionSnsTimelineLoadingMore(false)
      }
    }
  }, [])

  const closeSessionSnsTimeline = useCallback(() => {
    sessionSnsTimelineRequestTokenRef.current += 1
    sessionSnsTimelineLoadingRef.current = false
    sessionSnsRankRequestTokenRef.current += 1
    sessionSnsRankLoadingRef.current = false
    setSessionSnsRankMode(null)
    setSessionSnsLikeRankings([])
    setSessionSnsCommentRankings([])
    setSessionSnsRankLoading(false)
    setSessionSnsRankError(null)
    setSessionSnsRankLoadedPosts(0)
    setSessionSnsRankTotalPosts(null)
    setSessionSnsTimelineTarget(null)
    setSessionSnsTimelinePosts([])
    setSessionSnsTimelineLoading(false)
    setSessionSnsTimelineLoadingMore(false)
    setSessionSnsTimelineHasMore(false)
    setSessionSnsTimelineTotalPosts(null)
    setSessionSnsTimelineStatsLoading(false)
  }, [])

  const sessionSnsTimelineInitialTotalPosts = useMemo(() => {
    const username = String(sessionSnsTimelineTarget?.username || '').trim()
    if (!username) return null
    if (!Object.prototype.hasOwnProperty.call(snsUserPostCounts, username)) return null
    const count = Number(snsUserPostCounts[username] || 0)
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  }, [sessionSnsTimelineTarget, snsUserPostCounts])

  const sessionSnsTimelineInitialTotalPostsLoading = useMemo(() => {
    const username = String(sessionSnsTimelineTarget?.username || '').trim()
    if (!username) return false
    if (Object.prototype.hasOwnProperty.call(snsUserPostCounts, username)) return false
    return snsUserPostCountsStatus === 'loading' || snsUserPostCountsStatus === 'idle'
  }, [sessionSnsTimelineTarget, snsUserPostCounts, snsUserPostCountsStatus])

  const openSessionSnsTimelineByTarget = useCallback((target: SessionSnsTimelineTarget) => {
    sessionSnsRankRequestTokenRef.current += 1
    sessionSnsRankLoadingRef.current = false
    setSessionSnsRankMode(null)
    setSessionSnsLikeRankings([])
    setSessionSnsCommentRankings([])
    setSessionSnsRankLoading(false)
    setSessionSnsRankError(null)
    setSessionSnsRankLoadedPosts(0)
    setSessionSnsTimelineTarget(target)
    setSessionSnsTimelinePosts([])
    setSessionSnsTimelineHasMore(false)
    setSessionSnsTimelineLoadingMore(false)
    setSessionSnsTimelineLoading(false)
    const hasKnownCount = Object.prototype.hasOwnProperty.call(snsUserPostCounts, target.username)
    if (hasKnownCount) {
      const count = Number(snsUserPostCounts[target.username] || 0)
      const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
      setSessionSnsTimelineTotalPosts(normalizedCount)
      setSessionSnsTimelineStatsLoading(false)
      setSessionSnsRankTotalPosts(normalizedCount)
    } else {
      setSessionSnsTimelineTotalPosts(null)
      setSessionSnsTimelineStatsLoading(snsUserPostCountsStatus === 'loading' || snsUserPostCountsStatus === 'idle')
      setSessionSnsRankTotalPosts(null)
    }

    void loadSnsUserPostCounts()
  }, [
    loadSnsUserPostCounts,
    snsUserPostCounts,
    snsUserPostCountsStatus
  ])

  const openSessionSnsTimeline = useCallback(() => {
    const normalizedSessionId = String(sessionDetail?.wxid || '').trim()
    if (!isSingleContactSession(normalizedSessionId) || !sessionDetail) return

    const target: SessionSnsTimelineTarget = {
      username: normalizedSessionId,
      displayName: sessionDetail.displayName || sessionDetail.remark || sessionDetail.nickName || normalizedSessionId,
      avatarUrl: sessionDetail.avatarUrl
    }

    openSessionSnsTimelineByTarget(target)
  }, [openSessionSnsTimelineByTarget, sessionDetail])

  const openContactSnsTimeline = useCallback((contact: ContactInfo) => {
    const normalizedSessionId = String(contact?.username || '').trim()
    if (!isSingleContactSession(normalizedSessionId)) return
    openSessionSnsTimelineByTarget({
      username: normalizedSessionId,
      displayName: contact.displayName || contact.remark || contact.nickname || normalizedSessionId,
      avatarUrl: contact.avatarUrl
    })
  }, [openSessionSnsTimelineByTarget])

  const openSessionMutualFriendsDialog = useCallback((contact: ContactInfo) => {
    const normalizedSessionId = String(contact?.username || '').trim()
    if (!normalizedSessionId || !isSingleContactSession(normalizedSessionId)) return
    const metric = sessionMutualFriendsMetricsRef.current[normalizedSessionId]
    if (!metric) return
    setSessionMutualFriendsSearch('')
    setSessionMutualFriendsDialogTarget({
      username: normalizedSessionId,
      displayName: contact.displayName || contact.remark || contact.nickname || normalizedSessionId,
      avatarUrl: contact.avatarUrl
    })
  }, [])

  const closeSessionMutualFriendsDialog = useCallback(() => {
    setSessionMutualFriendsDialogTarget(null)
    setSessionMutualFriendsSearch('')
  }, [])

  const loadMoreSessionSnsTimeline = useCallback(() => {
    if (!sessionSnsTimelineTarget || sessionSnsTimelineLoading || sessionSnsTimelineLoadingMore || !sessionSnsTimelineHasMore) return
    void loadSessionSnsTimelinePosts(sessionSnsTimelineTarget, { reset: false })
  }, [
    loadSessionSnsTimelinePosts,
    sessionSnsTimelineHasMore,
    sessionSnsTimelineLoading,
    sessionSnsTimelineLoadingMore,
    sessionSnsTimelineTarget
  ])

  const loadSessionSnsRankings = useCallback(async (target: SessionSnsTimelineTarget) => {
    const normalizedUsername = String(target?.username || '').trim()
    if (!normalizedUsername || sessionSnsRankLoadingRef.current) return

    const knownTotal = snsUserPostCountsStatus === 'ready'
      ? Number(snsUserPostCounts[normalizedUsername] || 0)
      : null
    const normalizedKnownTotal = knownTotal !== null && Number.isFinite(knownTotal)
      ? Math.max(0, Math.floor(knownTotal))
      : null
    const cached = sessionSnsRankCacheRef.current[normalizedUsername]

    if (cached && (normalizedKnownTotal === null || cached.totalPosts === normalizedKnownTotal)) {
      setSessionSnsLikeRankings(cached.likes)
      setSessionSnsCommentRankings(cached.comments)
      setSessionSnsRankLoadedPosts(cached.totalPosts)
      setSessionSnsRankTotalPosts(cached.totalPosts)
      setSessionSnsRankError(null)
      setSessionSnsRankLoading(false)
      return
    }

    sessionSnsRankLoadingRef.current = true
    const requestToken = ++sessionSnsRankRequestTokenRef.current
    setSessionSnsRankLoading(true)
    setSessionSnsRankError(null)
    setSessionSnsRankLoadedPosts(0)
    setSessionSnsRankTotalPosts(normalizedKnownTotal)

    try {
      const allPosts: SnsPost[] = []
      let endTime: number | undefined
      let hasMore = true

      while (hasMore) {
        const result = await sns.getTimeline(
          SNS_RANK_PAGE_SIZE,
          0,
          [normalizedUsername],
          '',
          undefined,
          endTime
        )
        if (requestToken !== sessionSnsRankRequestTokenRef.current) return

        if (!result.success) {
          throw new Error(result.error || '加载朋友圈排行失败')
        }

        const pagePosts = Array.isArray(result.timeline)
          ? [...(result.timeline as SnsPost[])].sort((a, b) => b.createTime - a.createTime)
          : []
        if (pagePosts.length === 0) {
          hasMore = false
          break
        }

        allPosts.push(...pagePosts)
        setSessionSnsRankLoadedPosts(allPosts.length)
        if (normalizedKnownTotal === null) {
          setSessionSnsRankTotalPosts(allPosts.length)
        }

        endTime = pagePosts[pagePosts.length - 1].createTime - 1
        hasMore = pagePosts.length >= SNS_RANK_PAGE_SIZE
      }

      if (requestToken !== sessionSnsRankRequestTokenRef.current) return

      const rankings = buildSessionSnsRankings(allPosts)
      const totalPosts = allPosts.length
      sessionSnsRankCacheRef.current[normalizedUsername] = {
        likes: rankings.likes,
        comments: rankings.comments,
        totalPosts,
        computedAt: Date.now()
      }
      setSessionSnsLikeRankings(rankings.likes)
      setSessionSnsCommentRankings(rankings.comments)
      setSessionSnsRankLoadedPosts(totalPosts)
      setSessionSnsRankTotalPosts(totalPosts)
      setSessionSnsRankError(null)
    } catch (error) {
      if (requestToken !== sessionSnsRankRequestTokenRef.current) return
      const message = error instanceof Error ? error.message : String(error)
      setSessionSnsLikeRankings([])
      setSessionSnsCommentRankings([])
      setSessionSnsRankError(message || '加载朋友圈排行失败')
    } finally {
      if (requestToken === sessionSnsRankRequestTokenRef.current) {
        sessionSnsRankLoadingRef.current = false
        setSessionSnsRankLoading(false)
      }
    }
  }, [snsUserPostCounts, snsUserPostCountsStatus])

  const renderSessionSnsTimelineStats = useCallback((): string => {
    const loadedCount = sessionSnsTimelinePosts.length
    const loadPart = sessionSnsTimelineStatsLoading
      ? `已加载 ${loadedCount} / 总数统计中...`
      : sessionSnsTimelineTotalPosts === null
        ? `已加载 ${loadedCount} 条`
        : `已加载 ${loadedCount} / 共 ${sessionSnsTimelineTotalPosts} 条`

    if (sessionSnsTimelineLoading && loadedCount === 0) return `${loadPart} ｜ 加载中...`
    if (loadedCount === 0) return loadPart

    const latest = sessionSnsTimelinePosts[0]?.createTime
    const earliest = sessionSnsTimelinePosts[sessionSnsTimelinePosts.length - 1]?.createTime
    const rangeText = `${formatYmdDateFromSeconds(earliest)} ~ ${formatYmdDateFromSeconds(latest)}`
    return `${loadPart} ｜ ${rangeText}`
  }, [
    sessionSnsTimelineLoading,
    sessionSnsTimelinePosts,
    sessionSnsTimelineStatsLoading,
    sessionSnsTimelineTotalPosts
  ])

  const toggleSessionSnsRankMode = useCallback((mode: SnsRankMode) => {
    setSessionSnsRankMode((prev) => (prev === mode ? null : mode))
  }, [])

  const sessionSnsActiveRankings = useMemo(() => {
    if (sessionSnsRankMode === 'likes') return sessionSnsLikeRankings
    if (sessionSnsRankMode === 'comments') return sessionSnsCommentRankings
    return []
  }, [sessionSnsCommentRankings, sessionSnsLikeRankings, sessionSnsRankMode])

  const mergeSessionContentMetrics = useCallback((input: Record<string, SessionExportMetric | SessionContentMetric | undefined>) => {
    const entries = Object.entries(input)
    if (entries.length === 0) return

    const nextMessageCounts: Record<string, number> = {}
    const nextMetrics: Record<string, SessionContentMetric> = {}

    for (const [sessionIdRaw, metricRaw] of entries) {
      const sessionId = String(sessionIdRaw || '').trim()
      if (!sessionId || !metricRaw) continue
      const totalMessages = normalizeMessageCount(metricRaw.totalMessages)
      const voiceMessages = normalizeMessageCount(metricRaw.voiceMessages)
      const imageMessages = normalizeMessageCount(metricRaw.imageMessages)
      const videoMessages = normalizeMessageCount(metricRaw.videoMessages)
      const emojiMessages = normalizeMessageCount(metricRaw.emojiMessages)
      const transferMessages = normalizeMessageCount(metricRaw.transferMessages)
      const redPacketMessages = normalizeMessageCount(metricRaw.redPacketMessages)
      const callMessages = normalizeMessageCount(metricRaw.callMessages)

      if (
        typeof totalMessages !== 'number' &&
        typeof voiceMessages !== 'number' &&
        typeof imageMessages !== 'number' &&
        typeof videoMessages !== 'number' &&
        typeof emojiMessages !== 'number' &&
        typeof transferMessages !== 'number' &&
        typeof redPacketMessages !== 'number' &&
        typeof callMessages !== 'number'
      ) {
        continue
      }

      nextMetrics[sessionId] = {
        totalMessages,
        voiceMessages,
        imageMessages,
        videoMessages,
        emojiMessages,
        transferMessages,
        redPacketMessages,
        callMessages
      }
      if (typeof totalMessages === 'number') {
        nextMessageCounts[sessionId] = totalMessages
      }
    }

    if (Object.keys(nextMessageCounts).length > 0) {
      setSessionMessageCounts(prev => {
        let changed = false
        const merged = { ...prev }
        for (const [sessionId, count] of Object.entries(nextMessageCounts)) {
          if (merged[sessionId] === count) continue
          merged[sessionId] = count
          changed = true
        }
        return changed ? merged : prev
      })
    }

    if (Object.keys(nextMetrics).length > 0) {
      setSessionContentMetrics(prev => {
        let changed = false
        const merged = { ...prev }
        for (const [sessionId, metric] of Object.entries(nextMetrics)) {
          const previous = merged[sessionId] || {}
          const nextMetric: SessionContentMetric = {
            totalMessages: typeof metric.totalMessages === 'number' ? metric.totalMessages : previous.totalMessages,
            voiceMessages: typeof metric.voiceMessages === 'number' ? metric.voiceMessages : previous.voiceMessages,
            imageMessages: typeof metric.imageMessages === 'number' ? metric.imageMessages : previous.imageMessages,
            videoMessages: typeof metric.videoMessages === 'number' ? metric.videoMessages : previous.videoMessages,
            emojiMessages: typeof metric.emojiMessages === 'number' ? metric.emojiMessages : previous.emojiMessages,
            transferMessages: typeof metric.transferMessages === 'number' ? metric.transferMessages : previous.transferMessages,
            redPacketMessages: typeof metric.redPacketMessages === 'number' ? metric.redPacketMessages : previous.redPacketMessages,
            callMessages: typeof metric.callMessages === 'number' ? metric.callMessages : previous.callMessages
          }
          if (
            previous.totalMessages === nextMetric.totalMessages &&
            previous.voiceMessages === nextMetric.voiceMessages &&
            previous.imageMessages === nextMetric.imageMessages &&
            previous.videoMessages === nextMetric.videoMessages &&
            previous.emojiMessages === nextMetric.emojiMessages &&
            previous.transferMessages === nextMetric.transferMessages &&
            previous.redPacketMessages === nextMetric.redPacketMessages &&
            previous.callMessages === nextMetric.callMessages
          ) {
            continue
          }
          merged[sessionId] = nextMetric
          changed = true
        }
        return changed ? merged : prev
      })
    }
  }, [])

  const resetSessionMediaMetricLoader = useCallback(() => {
    sessionMediaMetricRunIdRef.current += 1
    sessionMediaMetricQueueRef.current = []
    sessionMediaMetricQueuedSetRef.current.clear()
    sessionMediaMetricLoadingSetRef.current.clear()
    sessionMediaMetricReadySetRef.current.clear()
    sessionMediaMetricWorkerRunningRef.current = false
    sessionMediaMetricPendingPersistRef.current = {}
    sessionMediaMetricVisibleRangeRef.current = { startIndex: 0, endIndex: -1 }
    if (sessionMediaMetricBackgroundFeedTimerRef.current) {
      window.clearTimeout(sessionMediaMetricBackgroundFeedTimerRef.current)
      sessionMediaMetricBackgroundFeedTimerRef.current = null
    }
    if (sessionMediaMetricPersistTimerRef.current) {
      window.clearTimeout(sessionMediaMetricPersistTimerRef.current)
      sessionMediaMetricPersistTimerRef.current = null
    }
  }, [])

  const flushSessionMediaMetricCache = useCallback(async () => {
    const pendingMetrics = sessionMediaMetricPendingPersistRef.current
    sessionMediaMetricPendingPersistRef.current = {}
    if (Object.keys(pendingMetrics).length === 0) return

    try {
      const scopeKey = await ensureExportCacheScope()
      const existing = await configService.getExportSessionContentMetricCache(scopeKey)
      const nextMetrics = {
        ...(existing?.metrics || {}),
        ...pendingMetrics
      }
      await configService.setExportSessionContentMetricCache(scopeKey, nextMetrics)
    } catch (error) {
      logger.error('写入导出页会话内容统计缓存失败:', error)
    }
  }, [ensureExportCacheScope])

  const scheduleFlushSessionMediaMetricCache = useCallback(() => {
    if (sessionMediaMetricPersistTimerRef.current) return
    sessionMediaMetricPersistTimerRef.current = window.setTimeout(() => {
      sessionMediaMetricPersistTimerRef.current = null
      void flushSessionMediaMetricCache()
    }, SESSION_MEDIA_METRIC_CACHE_FLUSH_DELAY_MS)
  }, [flushSessionMediaMetricCache])

  const resetSessionMutualFriendsLoader = useCallback(() => {
    sessionMutualFriendsRunIdRef.current += 1
    sessionMutualFriendsDirectMetricsRef.current = {}
    sessionMutualFriendsQueueRef.current = []
    sessionMutualFriendsQueuedSetRef.current.clear()
    sessionMutualFriendsLoadingSetRef.current.clear()
    sessionMutualFriendsReadySetRef.current.clear()
    sessionMutualFriendsWorkerRunningRef.current = false
    sessionMutualFriendsVisibleRangeRef.current = { startIndex: 0, endIndex: -1 }
    if (sessionMutualFriendsBackgroundFeedTimerRef.current) {
      window.clearTimeout(sessionMutualFriendsBackgroundFeedTimerRef.current)
      sessionMutualFriendsBackgroundFeedTimerRef.current = null
    }
  }, [])

  const isSessionMutualFriendsReady = useCallback((sessionId: string): boolean => {
    if (!sessionId) return true
    if (sessionMutualFriendsReadySetRef.current.has(sessionId)) return true
    const existing = sessionMutualFriendsMetricsRef.current[sessionId]
    if (existing && typeof existing.count === 'number' && Array.isArray(existing.items)) {
      sessionMutualFriendsReadySetRef.current.add(sessionId)
      return true
    }
    return false
  }, [])

  const enqueueSessionMutualFriendsRequests = useCallback((sessionIds: string[], options?: { front?: boolean }) => {
    const front = options?.front === true
    const incoming: string[] = []
    for (const sessionIdRaw of sessionIds) {
      const sessionId = String(sessionIdRaw || '').trim()
      if (!sessionId) continue
      if (sessionMutualFriendsQueuedSetRef.current.has(sessionId)) continue
      if (sessionMutualFriendsLoadingSetRef.current.has(sessionId)) continue
      if (isSessionMutualFriendsReady(sessionId)) continue
      sessionMutualFriendsQueuedSetRef.current.add(sessionId)
      incoming.push(sessionId)
    }
    if (incoming.length === 0) return
    patchSessionLoadTraceStage(incoming, 'mutualFriends', 'pending')
    if (front) {
      sessionMutualFriendsQueueRef.current = [...incoming, ...sessionMutualFriendsQueueRef.current]
    } else {
      sessionMutualFriendsQueueRef.current.push(...incoming)
    }
  }, [isSessionMutualFriendsReady, patchSessionLoadTraceStage])

  const hasPendingMetricLoads = useCallback((): boolean => (
    isLoadingSessionCountsRef.current ||
    sessionMediaMetricQueuedSetRef.current.size > 0 ||
    sessionMediaMetricLoadingSetRef.current.size > 0 ||
    sessionMediaMetricWorkerRunningRef.current ||
    snsUserPostCountsStatus === 'loading' ||
    snsUserPostCountsStatus === 'idle'
  ), [snsUserPostCountsStatus])

  const getSessionMutualFriendProfile = useCallback((sessionId: string): {
    displayName: string
    candidateNames: Set<string>
  } => {
    const normalizedSessionId = String(sessionId || '').trim()
    const contact = contactsList.find(item => item.username === normalizedSessionId)
    const session = sessionsRef.current.find(item => item.username === normalizedSessionId)
    const displayName = contact?.displayName || contact?.remark || contact?.nickname || session?.displayName || normalizedSessionId
    return {
      displayName,
      candidateNames: toComparableNameSet([
        displayName,
        contact?.displayName,
        contact?.remark,
        contact?.nickname,
        contact?.alias
      ])
    }
  }, [contactsList])

  const rebuildSessionMutualFriendsMetric = useCallback((targetSessionId: string): SessionMutualFriendsMetric | null => {
    const normalizedTargetSessionId = String(targetSessionId || '').trim()
    if (!normalizedTargetSessionId) return null

    const directMetrics = sessionMutualFriendsDirectMetricsRef.current
    const directMetric = directMetrics[normalizedTargetSessionId]
    if (!directMetric) return null

    const { candidateNames } = getSessionMutualFriendProfile(normalizedTargetSessionId)
    const mergedMap = new Map<string, SessionMutualFriendItem>()
    for (const item of directMetric.items) {
      mergedMap.set(item.name, { ...item })
    }

    for (const [sourceSessionId, sourceMetric] of Object.entries(directMetrics)) {
      if (!sourceMetric || sourceSessionId === normalizedTargetSessionId) continue
      const sourceProfile = getSessionMutualFriendProfile(sourceSessionId)
      if (!sourceProfile.displayName) continue
      if (mergedMap.has(sourceProfile.displayName)) continue

      const reverseMatches = sourceMetric.items.filter(item => candidateNames.has(item.name))
      if (reverseMatches.length === 0) continue

      const reverseCount = reverseMatches.reduce((sum, item) => sum + item.totalCount, 0)
      const reverseLikeCount = reverseMatches.reduce((sum, item) => sum + item.incomingLikeCount, 0)
      const reverseCommentCount = reverseMatches.reduce((sum, item) => sum + item.incomingCommentCount, 0)
      const reverseLatestTime = reverseMatches.reduce((latest, item) => Math.max(latest, item.latestTime), 0)
      const existing = mergedMap.get(sourceProfile.displayName)
      if (existing) {
        existing.outgoingLikeCount += reverseLikeCount
        existing.outgoingCommentCount += reverseCommentCount
        existing.totalCount += reverseCount
        existing.latestTime = Math.max(existing.latestTime, reverseLatestTime)
        existing.direction = (existing.incomingLikeCount + existing.incomingCommentCount) > 0
          ? 'bidirectional'
          : 'outgoing'
        existing.behavior = summarizeMutualFriendBehavior(
          existing.incomingLikeCount + existing.outgoingLikeCount,
          existing.incomingCommentCount + existing.outgoingCommentCount
        )
      } else {
        mergedMap.set(sourceProfile.displayName, {
          name: sourceProfile.displayName,
          incomingLikeCount: 0,
          incomingCommentCount: 0,
          outgoingLikeCount: reverseLikeCount,
          outgoingCommentCount: reverseCommentCount,
          totalCount: reverseCount,
          latestTime: reverseLatestTime,
          direction: 'outgoing',
          behavior: summarizeMutualFriendBehavior(reverseLikeCount, reverseCommentCount)
        })
      }
    }

    const items = [...mergedMap.values()].sort((a, b) => {
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount
      if (b.latestTime !== a.latestTime) return b.latestTime - a.latestTime
      return a.name.localeCompare(b.name, 'zh-CN')
    })

    return {
      ...directMetric,
      count: items.length,
      items
    }
  }, [getSessionMutualFriendProfile])

  const applySessionMutualFriendsMetric = useCallback((sessionId: string, directMetric: SessionMutualFriendsMetric) => {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return
    sessionMutualFriendsDirectMetricsRef.current[normalizedSessionId] = directMetric

    const impactedSessionIds = new Set<string>([normalizedSessionId])
    const allSessionIds = sessionsRef.current
      .filter(session => session.hasSession && isSingleContactSession(session.username))
      .map(session => session.username)

    for (const targetSessionId of allSessionIds) {
      if (targetSessionId === normalizedSessionId) continue
      const targetProfile = getSessionMutualFriendProfile(targetSessionId)
      if (directMetric.items.some(item => targetProfile.candidateNames.has(item.name))) {
        impactedSessionIds.add(targetSessionId)
      }
    }

    setSessionMutualFriendsMetrics(prev => {
      const next = { ...prev }
      let changed = false
      for (const targetSessionId of impactedSessionIds) {
        const rebuiltMetric = rebuildSessionMutualFriendsMetric(targetSessionId)
        if (!rebuiltMetric) continue
        const previousMetric = prev[targetSessionId]
        const previousSerialized = previousMetric ? JSON.stringify(previousMetric) : ''
        const nextSerialized = JSON.stringify(rebuiltMetric)
        if (previousSerialized === nextSerialized) continue
        next[targetSessionId] = rebuiltMetric
        changed = true
      }
      return changed ? next : prev
    })
  }, [getSessionMutualFriendProfile, rebuildSessionMutualFriendsMetric])

  const isSessionMediaMetricReady = useCallback((sessionId: string): boolean => {
    if (!sessionId) return true
    if (sessionMediaMetricReadySetRef.current.has(sessionId)) return true
    const existing = sessionContentMetricsRef.current[sessionId]
    if (hasCompleteSessionMediaMetric(existing)) {
      sessionMediaMetricReadySetRef.current.add(sessionId)
      return true
    }
    return false
  }, [])

  const enqueueSessionMediaMetricRequests = useCallback((sessionIds: string[], options?: { front?: boolean }) => {
    const front = options?.front === true
    const incoming: string[] = []
    for (const sessionIdRaw of sessionIds) {
      const sessionId = String(sessionIdRaw || '').trim()
      if (!sessionId) continue
      if (sessionMediaMetricQueuedSetRef.current.has(sessionId)) continue
      if (sessionMediaMetricLoadingSetRef.current.has(sessionId)) continue
      if (isSessionMediaMetricReady(sessionId)) continue
      sessionMediaMetricQueuedSetRef.current.add(sessionId)
      incoming.push(sessionId)
    }
    if (incoming.length === 0) return
    patchSessionLoadTraceStage(incoming, 'mediaMetrics', 'pending')
    if (front) {
      sessionMediaMetricQueueRef.current = [...incoming, ...sessionMediaMetricQueueRef.current]
    } else {
      sessionMediaMetricQueueRef.current.push(...incoming)
    }
  }, [isSessionMediaMetricReady, patchSessionLoadTraceStage])

  const applySessionMediaMetricsFromStats = useCallback((data?: Record<string, SessionExportMetric>) => {
    if (!data) return
    const nextMetrics: Record<string, SessionContentMetric> = {}
    let hasPatch = false
    for (const [sessionIdRaw, metricRaw] of Object.entries(data)) {
      const sessionId = String(sessionIdRaw || '').trim()
      if (!sessionId) continue
      const metric = pickSessionMediaMetric(metricRaw)
      if (!metric) continue
      nextMetrics[sessionId] = metric
      hasPatch = true
      sessionMediaMetricPendingPersistRef.current[sessionId] = {
        ...sessionMediaMetricPendingPersistRef.current[sessionId],
        ...metric
      }
      if (hasCompleteSessionMediaMetric(metric)) {
        sessionMediaMetricReadySetRef.current.add(sessionId)
      }
    }

    if (hasPatch) {
      mergeSessionContentMetrics(nextMetrics)
      scheduleFlushSessionMediaMetricCache()
    }
  }, [mergeSessionContentMetrics, scheduleFlushSessionMediaMetricCache])

  const runSessionMediaMetricWorker = useCallback(async (runId: number) => {
    if (sessionMediaMetricWorkerRunningRef.current) return
    sessionMediaMetricWorkerRunningRef.current = true
    try {
      while (runId === sessionMediaMetricRunIdRef.current) {
        if (isLoadingSessionCountsRef.current || detailStatsPriorityRef.current) {
          await new Promise(resolve => window.setTimeout(resolve, 80))
          continue
        }

        if (sessionMediaMetricQueueRef.current.length === 0) break

        const batchSessionIds: string[] = []
        while (batchSessionIds.length < SESSION_MEDIA_METRIC_BATCH_SIZE && sessionMediaMetricQueueRef.current.length > 0) {
          const nextId = sessionMediaMetricQueueRef.current.shift()
          if (!nextId) continue
          sessionMediaMetricQueuedSetRef.current.delete(nextId)
          if (sessionMediaMetricLoadingSetRef.current.has(nextId)) continue
          if (isSessionMediaMetricReady(nextId)) continue
          sessionMediaMetricLoadingSetRef.current.add(nextId)
          batchSessionIds.push(nextId)
        }
        if (batchSessionIds.length === 0) {
          continue
        }
        patchSessionLoadTraceStage(batchSessionIds, 'mediaMetrics', 'loading')

        try {
          const cacheResult = await chat.getExportSessionStats(
            batchSessionIds,
            { includeRelations: false, allowStaleCache: true, cacheOnly: true }
          )
          if (runId !== sessionMediaMetricRunIdRef.current) return
          if (cacheResult.success && cacheResult.data) {
            applySessionMediaMetricsFromStats(cacheResult.data as Record<string, SessionExportMetric>)
          }

          const missingSessionIds = batchSessionIds.filter(sessionId => !isSessionMediaMetricReady(sessionId))
          if (missingSessionIds.length > 0) {
            const freshResult = await chat.getExportSessionStats(
              missingSessionIds,
              { includeRelations: false, allowStaleCache: true }
            )
            if (runId !== sessionMediaMetricRunIdRef.current) return
            if (freshResult.success && freshResult.data) {
              applySessionMediaMetricsFromStats(freshResult.data as Record<string, SessionExportMetric>)
            }
          }
        } catch (error) {
          logger.error('导出页加载会话媒体统计失败:', error)
          patchSessionLoadTraceStage(batchSessionIds, 'mediaMetrics', 'failed', {
            error: String(error)
          })
        } finally {
          const completedSessionIds: string[] = []
          for (const sessionId of batchSessionIds) {
            sessionMediaMetricLoadingSetRef.current.delete(sessionId)
            if (isSessionMediaMetricReady(sessionId)) {
              sessionMediaMetricReadySetRef.current.add(sessionId)
              completedSessionIds.push(sessionId)
            }
          }
          if (completedSessionIds.length > 0) {
            patchSessionLoadTraceStage(completedSessionIds, 'mediaMetrics', 'done')
          }
        }

        await new Promise(resolve => window.setTimeout(resolve, 0))
      }
    } finally {
      sessionMediaMetricWorkerRunningRef.current = false
      if (runId === sessionMediaMetricRunIdRef.current && sessionMediaMetricQueueRef.current.length > 0) {
        void runSessionMediaMetricWorker(runId)
      }
    }
  }, [applySessionMediaMetricsFromStats, isSessionMediaMetricReady, patchSessionLoadTraceStage])

  const scheduleSessionMediaMetricWorker = useCallback(() => {
    if (!isSessionCountStageReady) return
    if (isLoadingSessionCountsRef.current) return
    if (sessionMediaMetricWorkerRunningRef.current) return
    const runId = sessionMediaMetricRunIdRef.current
    void runSessionMediaMetricWorker(runId)
  }, [isSessionCountStageReady, runSessionMediaMetricWorker])

  const loadSessionMutualFriendsMetric = useCallback(async (sessionId: string): Promise<SessionMutualFriendsMetric> => {
    const normalizedSessionId = String(sessionId || '').trim()
    const hasKnownTotal = Object.prototype.hasOwnProperty.call(snsUserPostCounts, normalizedSessionId)
    const knownTotalRaw = hasKnownTotal ? Number(snsUserPostCounts[normalizedSessionId] || 0) : NaN
    const knownTotal = Number.isFinite(knownTotalRaw) ? Math.max(0, Math.floor(knownTotalRaw)) : null
    const allPosts: SnsPost[] = []
    let endTime: number | undefined
    let hasMore = true

    while (hasMore) {
      const result = await sns.getTimeline(
        SNS_RANK_PAGE_SIZE,
        0,
        [normalizedSessionId],
        '',
        undefined,
        endTime
      )
      if (!result.success) {
        throw new Error(result.error || '共同好友统计失败')
      }

      const pagePosts = Array.isArray(result.timeline)
        ? [...(result.timeline as SnsPost[])].sort((a, b) => b.createTime - a.createTime)
        : []
      if (pagePosts.length === 0) {
        hasMore = false
        break
      }

      allPosts.push(...pagePosts)
      endTime = pagePosts[pagePosts.length - 1].createTime - 1
      hasMore = pagePosts.length >= SNS_RANK_PAGE_SIZE
    }

    return buildSessionMutualFriendsMetric(allPosts, knownTotal)
  }, [snsUserPostCounts])

  const runSessionMutualFriendsWorker = useCallback(async (runId: number) => {
    if (sessionMutualFriendsWorkerRunningRef.current) return
    sessionMutualFriendsWorkerRunningRef.current = true
    try {
      while (runId === sessionMutualFriendsRunIdRef.current) {
        if (hasPendingMetricLoads()) {
          await new Promise(resolve => window.setTimeout(resolve, 120))
          continue
        }

        const sessionId = sessionMutualFriendsQueueRef.current.shift()
        if (!sessionId) break
        sessionMutualFriendsQueuedSetRef.current.delete(sessionId)
        if (sessionMutualFriendsLoadingSetRef.current.has(sessionId)) continue
        if (isSessionMutualFriendsReady(sessionId)) continue

        sessionMutualFriendsLoadingSetRef.current.add(sessionId)
        patchSessionLoadTraceStage([sessionId], 'mutualFriends', 'loading')

        try {
          const metric = await loadSessionMutualFriendsMetric(sessionId)
          if (runId !== sessionMutualFriendsRunIdRef.current) return
          applySessionMutualFriendsMetric(sessionId, metric)
          sessionMutualFriendsReadySetRef.current.add(sessionId)
          patchSessionLoadTraceStage([sessionId], 'mutualFriends', 'done')
        } catch (error) {
          logger.error('导出页加载共同好友统计失败:', error)
          patchSessionLoadTraceStage([sessionId], 'mutualFriends', 'failed', {
            error: error instanceof Error ? error.message : String(error)
          })
        } finally {
          sessionMutualFriendsLoadingSetRef.current.delete(sessionId)
        }

        await new Promise(resolve => window.setTimeout(resolve, 0))
      }
    } finally {
      sessionMutualFriendsWorkerRunningRef.current = false
      if (runId === sessionMutualFriendsRunIdRef.current && sessionMutualFriendsQueueRef.current.length > 0) {
        void runSessionMutualFriendsWorker(runId)
      }
    }
  }, [
    applySessionMutualFriendsMetric,
    hasPendingMetricLoads,
    isSessionMutualFriendsReady,
    loadSessionMutualFriendsMetric,
    patchSessionLoadTraceStage
  ])

  const scheduleSessionMutualFriendsWorker = useCallback(() => {
    if (!isSessionCountStageReady) return
    if (hasPendingMetricLoads()) return
    if (sessionMutualFriendsWorkerRunningRef.current) return
    const runId = sessionMutualFriendsRunIdRef.current
    void runSessionMutualFriendsWorker(runId)
  }, [hasPendingMetricLoads, isSessionCountStageReady, runSessionMutualFriendsWorker])

  const loadSessionMessageCounts = useCallback(async (
    sourceSessions: SessionRow[],
    priorityTab: ConversationTab,
    options?: {
      scopeKey?: string
      seededCounts?: Record<string, number>
    }
  ): Promise<Record<string, number>> => {
    const requestId = sessionCountRequestIdRef.current + 1
    sessionCountRequestIdRef.current = requestId
    const isStale = () => sessionCountRequestIdRef.current !== requestId
    setIsSessionCountStageReady(false)

    const exportableSessions = sourceSessions.filter(session => session.hasSession)
    const exportableSessionIds = exportableSessions.map(session => session.username)
    const exportableSessionIdSet = new Set(exportableSessionIds)
    patchSessionLoadTraceStage(exportableSessionIds, 'messageCount', 'pending', { force: true })
    const seededHintCounts = exportableSessions.reduce<Record<string, number>>((acc, session) => {
      const nextCount = normalizeMessageCount(session.messageCountHint)
      if (typeof nextCount === 'number') {
        acc[session.username] = nextCount
      }
      return acc
    }, {})
    const seededPersistentCounts = Object.entries(options?.seededCounts || {}).reduce<Record<string, number>>((acc, [sessionId, countRaw]) => {
      if (!exportableSessionIdSet.has(sessionId)) return acc
      const nextCount = normalizeMessageCount(countRaw)
      if (typeof nextCount === 'number') {
        acc[sessionId] = nextCount
      }
      return acc
    }, {})
    const seededPersistentSessionIds = Object.keys(seededPersistentCounts)
    if (seededPersistentSessionIds.length > 0) {
      patchSessionLoadTraceStage(seededPersistentSessionIds, 'messageCount', 'done')
    }
    const seededCounts = { ...seededHintCounts, ...seededPersistentCounts }
    const accumulatedCounts: Record<string, number> = { ...seededCounts }
    setSessionMessageCounts(seededCounts)
    if (Object.keys(seededCounts).length > 0) {
      mergeSessionContentMetrics(
        Object.entries(seededCounts).reduce<Record<string, SessionContentMetric>>((acc, [sessionId, count]) => {
          acc[sessionId] = { totalMessages: count }
          return acc
        }, {})
      )
    }

    if (exportableSessions.length === 0) {
      setIsLoadingSessionCounts(false)
      if (!isStale()) {
        setIsSessionCountStageReady(true)
      }
      return { ...accumulatedCounts }
    }

    const prioritizedSessionIds = exportableSessions
      .filter(session => session.kind === priorityTab)
      .map(session => session.username)
    const prioritizedSet = new Set(prioritizedSessionIds)
    const remainingSessionIds = exportableSessions
      .filter(session => !prioritizedSet.has(session.username))
      .map(session => session.username)

    const applyCounts = (input: Record<string, number> | undefined) => {
      if (!input || isStale()) return
      const normalized = Object.entries(input).reduce<Record<string, number>>((acc, [sessionId, count]) => {
        const nextCount = normalizeMessageCount(count)
        if (typeof nextCount === 'number') {
          acc[sessionId] = nextCount
        }
        return acc
      }, {})
      if (Object.keys(normalized).length === 0) return
      for (const [sessionId, count] of Object.entries(normalized)) {
        accumulatedCounts[sessionId] = count
      }
      setSessionMessageCounts(prev => ({ ...prev, ...normalized }))
      mergeSessionContentMetrics(
        Object.entries(normalized).reduce<Record<string, SessionContentMetric>>((acc, [sessionId, count]) => {
          acc[sessionId] = { totalMessages: count }
          return acc
        }, {})
      )
    }

    setIsLoadingSessionCounts(true)
    try {
      if (detailStatsPriorityRef.current) {
        return { ...accumulatedCounts }
      }
      if (prioritizedSessionIds.length > 0) {
        patchSessionLoadTraceStage(prioritizedSessionIds, 'messageCount', 'loading')
        const priorityResult = await chat.getSessionMessageCounts(prioritizedSessionIds)
        if (isStale()) return { ...accumulatedCounts }
        if (priorityResult.success) {
          applyCounts(priorityResult.counts)
          patchSessionLoadTraceStage(prioritizedSessionIds, 'messageCount', 'done')
        } else {
          patchSessionLoadTraceStage(
            prioritizedSessionIds,
            'messageCount',
            'failed',
            { error: priorityResult.error || '总消息数加载失败' }
          )
        }
      }

      if (detailStatsPriorityRef.current) {
        return { ...accumulatedCounts }
      }
      if (remainingSessionIds.length > 0) {
        patchSessionLoadTraceStage(remainingSessionIds, 'messageCount', 'loading')
        const remainingResult = await chat.getSessionMessageCounts(remainingSessionIds)
        if (isStale()) return { ...accumulatedCounts }
        if (remainingResult.success) {
          applyCounts(remainingResult.counts)
          patchSessionLoadTraceStage(remainingSessionIds, 'messageCount', 'done')
        } else {
          patchSessionLoadTraceStage(
            remainingSessionIds,
            'messageCount',
            'failed',
            { error: remainingResult.error || '总消息数加载失败' }
          )
        }
      }
    } catch (error) {
      logger.error('导出页加载会话消息总数失败:', error)
      patchSessionLoadTraceStage(exportableSessionIds, 'messageCount', 'failed', {
        error: String(error)
      })
    } finally {
      if (!isStale()) {
        setIsLoadingSessionCounts(false)
        setIsSessionCountStageReady(true)
        if (options?.scopeKey && Object.keys(accumulatedCounts).length > 0) {
          try {
            await configService.setExportSessionMessageCountCache(options.scopeKey, accumulatedCounts)
          } catch (cacheError) {
            logger.error('写入导出页会话总消息缓存失败:', cacheError)
          }
        }
      }
    }
    return { ...accumulatedCounts }
  }, [mergeSessionContentMetrics, patchSessionLoadTraceStage])

  const loadSessions = useCallback(async () => {
    const loadToken = Date.now()
    sessionLoadTokenRef.current = loadToken
    sessionsHydratedAtRef.current = 0
    sessionPreciseRefreshAtRef.current = {}
    resetSessionMediaMetricLoader()
    resetSessionMutualFriendsLoader()
    setIsLoading(true)
    setIsSessionEnriching(false)
    sessionCountRequestIdRef.current += 1
    setSessionMessageCounts({})
    setSessionContentMetrics({})
    setSessionMutualFriendsMetrics({})
    sessionMutualFriendsMetricsRef.current = {}
    setSessionMutualFriendsDialogTarget(null)
    setSessionMutualFriendsSearch('')
    setSessionLoadTraceMap({})
    setSessionLoadProgressPulseMap({})
    sessionLoadProgressSnapshotRef.current = {}
    snsUserPostCountsHydrationTokenRef.current += 1
    if (snsUserPostCountsBatchTimerRef.current) {
      window.clearTimeout(snsUserPostCountsBatchTimerRef.current)
      snsUserPostCountsBatchTimerRef.current = null
    }
    setSnsUserPostCounts({})
    setSnsUserPostCountsStatus('idle')
    setIsLoadingSessionCounts(false)
    setIsSessionCountStageReady(false)

    const isStale = () => sessionLoadTokenRef.current !== loadToken

    try {
      const scopeKey = await ensureExportCacheScope()
      if (isStale()) return

      const [
        cachedContactsPayload,
        cachedMessageCountsPayload,
        cachedContentMetricsPayload
      ] = await Promise.all([
        loadContactsCaches(scopeKey),
        configService.getExportSessionMessageCountCache(scopeKey),
        configService.getExportSessionContentMetricCache(scopeKey)
      ])
      if (isStale()) return

      const {
        contactsItem: cachedContactsItem,
        avatarItem: cachedAvatarItem
      } = cachedContactsPayload

      const cachedContacts = cachedContactsItem?.contacts || []
      const cachedAvatarEntries = cachedAvatarItem?.avatars || {}
      const cachedContactMap = toContactMapFromCaches(cachedContacts, cachedAvatarEntries)
      if (cachedContacts.length > 0) {
        syncContactTypeCounts(Object.values(cachedContactMap))
        setSessions(toSessionRowsWithContacts([], cachedContactMap).filter(isExportConversationSession))
        setSessionDataSource('cache')
        setIsLoading(false)
      }
      setSessionContactsUpdatedAt(cachedContactsItem?.updatedAt || null)
      setSessionAvatarUpdatedAt(cachedAvatarItem?.updatedAt || null)

      const connectResult = await chat.connect()
      if (!connectResult.success) {
        logger.error('连接失败:', connectResult.error)
        if (!isStale()) setIsLoading(false)
        return
      }

      if (!isStale()) {
        void loadSnsStats({ full: true, silent: true })
      }

      const sessionsResult = await chat.getSessions()
      if (isStale()) return

      if (sessionsResult.success && sessionsResult.sessions) {
        const rawSessions = sessionsResult.sessions
        const baseSessions = toSessionRowsWithContacts(rawSessions, cachedContactMap).filter(isExportConversationSession)
        const exportableSessionIds = baseSessions
          .filter((session) => session.hasSession)
          .map((session) => session.username)
        const exportableSessionIdSet = new Set(exportableSessionIds)

        const cachedMessageCounts = Object.entries(cachedMessageCountsPayload?.counts || {}).reduce<Record<string, number>>((acc, [sessionId, countRaw]) => {
          if (!exportableSessionIdSet.has(sessionId)) return acc
          const nextCount = normalizeMessageCount(countRaw)
          if (typeof nextCount === 'number') {
            acc[sessionId] = nextCount
          }
          return acc
        }, {})

        const cachedCountAsMetrics = Object.entries(cachedMessageCounts).reduce<Record<string, SessionContentMetric>>((acc, [sessionId, count]) => {
          acc[sessionId] = { totalMessages: count }
          return acc
        }, {})
        const cachedContentMetrics = Object.entries(cachedContentMetricsPayload?.metrics || {}).reduce<Record<string, SessionContentMetric>>((acc, [sessionId, rawMetric]) => {
          if (!exportableSessionIdSet.has(sessionId)) return acc
          const metric = pickSessionMediaMetric(rawMetric)
          if (!metric) return acc
          acc[sessionId] = metric
          if (hasCompleteSessionMediaMetric(metric)) {
            sessionMediaMetricReadySetRef.current.add(sessionId)
          }
          return acc
        }, {})
        const cachedContentMetricReadySessionIds = Object.entries(cachedContentMetrics)
          .filter(([, metric]) => hasCompleteSessionMediaMetric(metric))
          .map(([sessionId]) => sessionId)
        if (cachedContentMetricReadySessionIds.length > 0) {
          patchSessionLoadTraceStage(cachedContentMetricReadySessionIds, 'mediaMetrics', 'done')
        }

        if (isStale()) return
        if (Object.keys(cachedMessageCounts).length > 0) {
          setSessionMessageCounts(cachedMessageCounts)
        }
        if (Object.keys(cachedCountAsMetrics).length > 0) {
          mergeSessionContentMetrics(cachedCountAsMetrics)
        }
        if (Object.keys(cachedContentMetrics).length > 0) {
          mergeSessionContentMetrics(cachedContentMetrics)
        }
        setSessions(baseSessions)
        sessionsHydratedAtRef.current = Date.now()
        void (async () => {
          await loadSessionMessageCounts(baseSessions, activeTabRef.current, {
            scopeKey,
            seededCounts: cachedMessageCounts
          })
          if (isStale()) return
        })()
        setSessionDataSource(cachedContacts.length > 0 ? 'cache' : 'network')
        if (cachedContacts.length === 0) {
          setSessionContactsUpdatedAt(Date.now())
        }
        setIsLoading(false)

        // 后台补齐联系人字段（昵称、头像、类型），不阻塞首屏会话列表渲染。
        setIsSessionEnriching(true)
        void (async () => {
          try {
            if (detailStatsPriorityRef.current) return
            let contactMap = { ...cachedContactMap }
            let avatarEntries = { ...cachedAvatarEntries }
            let hasFreshNetworkData = false
            let hasNetworkContactsSnapshot = false

            if (isStale()) return
            if (detailStatsPriorityRef.current) return
            const contactsResult = await withTimeout(chat.getContacts(), CONTACT_ENRICH_TIMEOUT_MS)
            if (isStale()) return

            const contactsFromNetwork: ContactInfo[] = contactsResult?.success && contactsResult.contacts ? contactsResult.contacts : []
            if (contactsFromNetwork.length > 0) {
              hasFreshNetworkData = true
              hasNetworkContactsSnapshot = true
              const contactsWithCachedAvatar = mergeAvatarCacheIntoContacts(contactsFromNetwork, avatarEntries)
              const nextContactMap = contactsWithCachedAvatar.reduce<Record<string, ContactInfo>>((map, contact) => {
                map[contact.username] = contact
                return map
              }, {})
              for (const [username, cachedContact] of Object.entries(cachedContactMap)) {
                if (!nextContactMap[username]) {
                  nextContactMap[username] = cachedContact
                }
              }
              contactMap = nextContactMap
              syncContactTypeCounts(Object.values(contactMap))
              const refreshAt = Date.now()
              setSessionContactsUpdatedAt(refreshAt)

              const upsertResult = upsertAvatarCacheFromContacts(avatarEntries, Object.values(contactMap), {
                prune: true,
                now: refreshAt
              })
              avatarEntries = upsertResult.avatarEntries
              if (upsertResult.updatedAt) {
                setSessionAvatarUpdatedAt(upsertResult.updatedAt)
              }
            }

            const sourceContacts = Object.values(contactMap)
            const sourceByUsername = new Map<string, ContactInfo>()
            for (const contact of sourceContacts) {
              if (!contact?.username) continue
              sourceByUsername.set(contact.username, contact)
            }
            const rawSessionMap = rawSessions.reduce<Record<string, AppChatSession>>((map, session) => {
              map[session.username] = session
              return map
            }, {})
            const candidateUsernames = sourceContacts.length > 0
              ? sourceContacts.map(contact => contact.username)
              : baseSessions.map(session => session.username)
            const needsEnrichment = candidateUsernames
              .filter(Boolean)
              .filter((username) => {
                const currentContact = sourceByUsername.get(username)
                const session = rawSessionMap[username]
                const currentAvatarUrl = currentContact?.avatarUrl || session?.avatarUrl
                return !currentAvatarUrl
              })

            let extraContactMap: Record<string, { displayName?: string; avatarUrl?: string }> = {}
            if (needsEnrichment.length > 0) {
              for (let i = 0; i < needsEnrichment.length; i += EXPORT_AVATAR_ENRICH_BATCH_SIZE) {
                if (isStale()) return
                if (detailStatsPriorityRef.current) return
                const batch = needsEnrichment.slice(i, i + EXPORT_AVATAR_ENRICH_BATCH_SIZE)
                if (batch.length === 0) continue
                try {
                  const enrichResult = await withTimeout(
                    chat.enrichSessionsContactInfo(batch, {
                      skipDisplayName: true,
                      onlyMissingAvatar: true
                    }),
                    CONTACT_ENRICH_TIMEOUT_MS
                  )
                  if (isStale()) return
                  if (enrichResult?.success && enrichResult.contacts) {
                    extraContactMap = {
                      ...extraContactMap,
                      ...enrichResult.contacts
                    }
                    hasFreshNetworkData = true
                    for (const [username, enriched] of Object.entries(enrichResult.contacts)) {
                      const current = sourceByUsername.get(username)
                      if (!current) continue
                      sourceByUsername.set(username, {
                        ...current,
                        displayName: enriched.displayName || current.displayName,
                        avatarUrl: enriched.avatarUrl || current.avatarUrl
                      })
                    }
                  }
                } catch (batchError) {
                  logger.error('导出页分批补充会话联系人信息失败:', batchError)
                }

                const batchContacts = batch
                  .map(username => sourceByUsername.get(username))
                  .filter((contact): contact is ContactInfo => Boolean(contact))
                const upsertResult = upsertAvatarCacheFromContacts(avatarEntries, batchContacts, {
                  markCheckedUsernames: batch
                })
                avatarEntries = upsertResult.avatarEntries
                if (upsertResult.updatedAt) {
                  setSessionAvatarUpdatedAt(upsertResult.updatedAt)
                }
                await new Promise(resolve => setTimeout(resolve, 0))
              }
            }

            const contactsForPersist = Array.from(sourceByUsername.values())
            if (hasNetworkContactsSnapshot && contactsForPersist.length > 0) {
              const upsertResult = upsertAvatarCacheFromContacts(avatarEntries, contactsForPersist, {
                prune: true
              })
              avatarEntries = upsertResult.avatarEntries
              if (upsertResult.updatedAt) {
                setSessionAvatarUpdatedAt(upsertResult.updatedAt)
              }
            }
            contactMap = contactsForPersist.reduce<Record<string, ContactInfo>>((map, contact) => {
              map[contact.username] = contact
              return map
            }, contactMap)

            if (isStale()) return
            const nextSessions = toSessionRowsWithContacts(rawSessions, contactMap).filter(isExportConversationSession)
              .map((session) => {
                const extra = extraContactMap[session.username]
                const displayName = extra?.displayName || session.displayName || session.username
                const avatarUrl = extra?.avatarUrl || session.avatarUrl || avatarEntries[session.username]?.avatarUrl
                if (displayName === session.displayName && avatarUrl === session.avatarUrl) {
                  return session
                }
                return {
                  ...session,
                  displayName,
                  avatarUrl
                }
              })
              .sort((a, b) => (b.sortTimestamp || b.lastTimestamp || 0) - (a.sortTimestamp || a.lastTimestamp || 0))

            const contactsCachePayload = Object.values(contactMap).map((contact) => ({
              username: contact.username,
              displayName: contact.displayName || contact.username,
              remark: contact.remark,
              nickname: contact.nickname,
              type: contact.type
            }))

            const persistAt = Date.now()
            setSessions(nextSessions)
            sessionsHydratedAtRef.current = persistAt
            if (hasNetworkContactsSnapshot && contactsCachePayload.length > 0) {
              await configService.setContactsListCache(scopeKey, contactsCachePayload)
              setSessionContactsUpdatedAt(persistAt)
            }
            if (Object.keys(avatarEntries).length > 0) {
              await configService.setContactsAvatarCache(scopeKey, avatarEntries)
              setSessionAvatarUpdatedAt(persistAt)
            }
            if (hasFreshNetworkData) {
              setSessionDataSource('network')
            }
          } catch (enrichError) {
            logger.error('导出页补充会话联系人信息失败:', enrichError)
          } finally {
            if (!isStale()) setIsSessionEnriching(false)
          }
        })()
      } else {
        setIsLoading(false)
      }
    } catch (error) {
      logger.error('加载会话失败:', error)
      if (!isStale()) setIsLoading(false)
    } finally {
      if (!isStale()) setIsLoading(false)
    }
  }, [ensureExportCacheScope, loadContactsCaches, loadSessionMessageCounts, loadSnsStats, mergeSessionContentMetrics, patchSessionLoadTraceStage, resetSessionMediaMetricLoader, resetSessionMutualFriendsLoader, syncContactTypeCounts])

  useEffect(() => {
    if (!isExportRoute) return
    const now = Date.now()
    const hasFreshSessionSnapshot = hasBaseConfigReadyRef.current &&
      sessionsRef.current.length > 0 &&
      now - sessionsHydratedAtRef.current <= EXPORT_REENTER_SESSION_SOFT_REFRESH_MS
    const hasFreshSnsSnapshot = hasSeededSnsStatsRef.current &&
      now - snsStatsHydratedAtRef.current <= EXPORT_REENTER_SNS_SOFT_REFRESH_MS

    void loadBaseConfig()
    void ensureSharedTabCountsLoaded()
    if (!hasFreshSessionSnapshot) {
      void loadSessions()
    }

    // 朋友圈统计延后一点加载，避免与首屏会话初始化抢占。
    const timer = window.setTimeout(() => {
      if (!hasFreshSnsSnapshot) {
        void loadSnsStats({ full: true })
      }
    }, 120)

    return () => window.clearTimeout(timer)
  }, [isExportRoute, ensureSharedTabCountsLoaded, loadBaseConfig, loadSessions, loadSnsStats])

  useEffect(() => {
    if (isExportRoute) return
    // 导出页隐藏时停止后台联系人补齐请求，避免与通讯录页面查询抢占。
    sessionLoadTokenRef.current = Date.now()
    sessionCountRequestIdRef.current += 1
    snsUserPostCountsHydrationTokenRef.current += 1
    if (snsUserPostCountsBatchTimerRef.current) {
      window.clearTimeout(snsUserPostCountsBatchTimerRef.current)
      snsUserPostCountsBatchTimerRef.current = null
    }
    resetSessionMutualFriendsLoader()
    setIsSessionEnriching(false)
    setIsLoadingSessionCounts(false)
    setSnsUserPostCountsStatus(prev => (prev === 'loading' ? 'idle' : prev))
  }, [isExportRoute, resetSessionMutualFriendsLoader])

  useEffect(() => {
    if (activeTab === 'official') {
      setActiveTab('private')
    }
  }, [activeTab])

  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  useEffect(() => {
    preselectAppliedRef.current = false
  }, [location.key, preselectSessionIds])

  useEffect(() => {
    if (preselectAppliedRef.current) return
    if (sessions.length === 0 || preselectSessionIds.length === 0) return

    const exists = new Set(sessions.map(session => session.username))
    const matched = preselectSessionIds.filter(id => exists.has(id))
    preselectAppliedRef.current = true

    if (matched.length > 0) {
      setSelectedSessions(new Set(matched))
    }
  }, [sessions, preselectSessionIds])

  const selectedCount = selectedSessions.size

  const toggleSelectSession = (sessionId: string) => {
    const target = sessions.find(session => session.username === sessionId)
    if (!target?.hasSession) return
    setSelectedSessions(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })
  }

  const toggleSelectAllVisible = () => {
    const visibleIds = filteredContacts
      .filter(contact => sessionRowByUsername.get(contact.username)?.hasSession)
      .map(contact => contact.username)
    if (visibleIds.length === 0) return

    setSelectedSessions(prev => {
      const next = new Set(prev)
      const allSelected = visibleIds.every(id => next.has(id))
      if (allSelected) {
        for (const id of visibleIds) {
          next.delete(id)
        }
      } else {
        for (const id of visibleIds) {
          next.add(id)
        }
      }
      return next
    })
  }

  const clearSelection = () => setSelectedSessions(new Set())

  const openExportDialog = useCallback((payload: Omit<ExportDialogState, 'open'>) => {
    setExportDialog({ open: true, ...payload })
    setIsTimeRangeDialogOpen(false)
    setTimeRangeSelection(exportDefaultDateRangeSelection)

    setOptions(prev => {
      const nextDateRange = cloneExportDateRange(exportDefaultDateRangeSelection.dateRange)

      const next: ExportOptions = {
        ...prev,
        format: exportDefaultFormat,
        exportAvatars: exportDefaultAvatars,
        useAllTime: exportDefaultDateRangeSelection.useAllTime,
        dateRange: nextDateRange,
        exportMedia: Boolean(
          exportDefaultMedia.images ||
          exportDefaultMedia.voices ||
          exportDefaultMedia.videos ||
          exportDefaultMedia.emojis
        ),
        exportImages: exportDefaultMedia.images,
        exportVoices: exportDefaultMedia.voices,
        exportVideos: exportDefaultMedia.videos,
        exportEmojis: exportDefaultMedia.emojis,
        exportVoiceAsText: exportDefaultVoiceAsText,
        excelCompactColumns: exportDefaultExcelCompactColumns,
        exportConcurrency: exportDefaultConcurrency
      }

      if (payload.scope === 'sns') {
        return next
      }

      if (payload.scope === 'content' && payload.contentType) {
        if (payload.contentType === 'text') {
          next.exportMedia = false
          next.exportImages = false
          next.exportVoices = false
          next.exportVideos = false
          next.exportEmojis = false
        } else {
          next.exportMedia = true
          next.exportImages = payload.contentType === 'image'
          next.exportVoices = payload.contentType === 'voice'
          next.exportVideos = payload.contentType === 'video'
          next.exportEmojis = payload.contentType === 'emoji'
          next.exportVoiceAsText = false
        }
      }

      return next
    })
  }, [
    exportDefaultDateRangeSelection,
    exportDefaultExcelCompactColumns,
    exportDefaultFormat,
    exportDefaultAvatars,
    exportDefaultMedia,
    exportDefaultVoiceAsText,
    exportDefaultConcurrency
  ])

  const closeExportDialog = useCallback(() => {
    setExportDialog(prev => ({ ...prev, open: false }))
    setIsTimeRangeDialogOpen(false)
  }, [])

  const openTimeRangeDialog = useCallback(() => {
    setIsTimeRangeDialogOpen(true)
  }, [])

  const closeTimeRangeDialog = useCallback(() => {
    setIsTimeRangeDialogOpen(false)
  }, [])

  const timeRangeSummaryLabel = useMemo(() => getExportDateRangeLabel(timeRangeSelection), [timeRangeSelection])

  useEffect(() => {
    const unsubscribe = onOpenSingleExport((payload) => {
      void (async () => {
        const sessionId = typeof payload?.sessionId === 'string'
          ? payload.sessionId.trim()
          : ''
        if (!sessionId) return

        const sessionName = typeof payload?.sessionName === 'string'
          ? payload.sessionName.trim()
          : ''
        const displayName = sessionName || sessionId
        const requestId = typeof payload?.requestId === 'string'
          ? payload.requestId.trim()
          : ''

        const emitStatus = (
          status: 'initializing' | 'opened' | 'failed',
          message?: string
        ) => {
          if (!requestId) return
          emitSingleExportDialogStatus({ requestId, status, message })
        }

        try {
          if (!hasBaseConfigReadyRef.current) {
            emitStatus('initializing')
            const ready = await loadBaseConfig()
            if (!ready) {
              emitStatus('failed', '导出模块初始化失败，请重试')
              return
            }
          }

          setSelectedSessions(new Set([sessionId]))
          openExportDialog({
            scope: 'single',
            sessionIds: [sessionId],
            sessionNames: [displayName],
            title: `导出会话：${displayName}`
          })
          emitStatus('opened')
        } catch (error) {
          logger.error('聊天页唤起导出弹窗失败:', error)
          emitStatus('failed', String(error))
        }
      })()
    })

    return unsubscribe
  }, [loadBaseConfig, openExportDialog])

  const buildExportOptions = (scope: TaskScope, contentType?: ContentType): ElectronExportOptions => {
    const sessionLayout: SessionLayout = writeLayout === 'C' ? 'per-session' : 'shared'
    const exportMediaEnabled = Boolean(options.exportImages || options.exportVoices || options.exportVideos || options.exportEmojis)

    const base: ElectronExportOptions = {
      format: options.format,
      exportAvatars: options.exportAvatars,
      exportMedia: exportMediaEnabled,
      exportImages: options.exportImages,
      exportVoices: options.exportVoices,
      exportVideos: options.exportVideos,
      exportEmojis: options.exportEmojis,
      exportVoiceAsText: options.exportVoiceAsText,
      excelCompactColumns: options.excelCompactColumns,
      txtColumns: options.txtColumns,
      displayNamePreference: options.displayNamePreference,
      exportConcurrency: options.exportConcurrency,
      sessionLayout,
      sessionNameWithTypePrefix,
      dateRange: options.useAllTime
        ? null
        : options.dateRange
          ? {
              start: Math.floor(options.dateRange.start.getTime() / 1000),
              end: Math.floor(options.dateRange.end.getTime() / 1000)
            }
          : null
    }

    if (scope === 'content' && contentType) {
      if (contentType === 'text') {
        const fastTextFormat: TextExportFormat = options.format === 'excel' ? 'arkme-json' : options.format
        const textExportConcurrency = Math.min(2, Math.max(1, base.exportConcurrency ?? options.exportConcurrency))
        return {
          ...base,
          format: fastTextFormat,
          contentType,
          exportConcurrency: textExportConcurrency,
          exportAvatars: base.exportAvatars,
          exportMedia: false,
          exportImages: false,
          exportVoices: false,
          exportVideos: false,
          exportEmojis: false
        }
      }

      return {
        ...base,
        contentType,
        exportMedia: true,
        exportImages: contentType === 'image',
        exportVoices: contentType === 'voice',
        exportVideos: contentType === 'video',
        exportEmojis: contentType === 'emoji',
        exportVoiceAsText: false
      }
    }

    return base
  }

  const buildSnsExportOptions = () => {
    const format: SnsTimelineExportFormat = snsExportFormat
    const dateRange = options.useAllTime
      ? null
      : options.dateRange
        ? {
            startTime: Math.floor(options.dateRange.start.getTime() / 1000),
            endTime: Math.floor(options.dateRange.end.getTime() / 1000)
          }
        : null

    return {
      format,
      exportImages: snsExportImages,
      exportLivePhotos: snsExportLivePhotos,
      exportVideos: snsExportVideos,
      startTime: dateRange?.startTime,
      endTime: dateRange?.endTime
    }
  }

  const markSessionExported = useCallback((sessionIds: string[], timestamp: number) => {
    setLastExportBySession(prev => {
      const next = { ...prev }
      for (const id of sessionIds) {
        next[id] = timestamp
      }
      void configService.setExportLastSessionRunMap(next)
      return next
    })
  }, [])

  const markContentExported = useCallback((sessionIds: string[], contentTypes: ContentType[], timestamp: number) => {
    setLastExportByContent(prev => {
      const next = { ...prev }
      for (const id of sessionIds) {
        for (const type of contentTypes) {
          next[`${id}::${type}`] = timestamp
        }
      }
      void configService.setExportLastContentRunMap(next)
      return next
    })
  }, [])

  const resolveTaskExportContentLabel = useCallback((payload: ExportTaskPayload): string => {
    if (payload.scope === 'content' && payload.contentType) {
      return getContentTypeLabel(payload.contentType)
    }
    if (payload.scope === 'sns') return '朋友圈'

    const labels: string[] = ['聊天文本']
    const opts = payload.options
    if (opts?.exportMedia) {
      if (opts.exportImages) labels.push('图片')
      if (opts.exportVoices) labels.push('语音')
      if (opts.exportVideos) labels.push('视频')
      if (opts.exportEmojis) labels.push('表情包')
    }
    return Array.from(new Set(labels)).join('、')
  }, [])

  const markSessionExportRecords = useCallback((
    sessionIds: string[],
    content: string,
    outputDir: string,
    exportTime: number
  ) => {
    const normalizedContent = String(content || '').trim()
    const normalizedOutputDir = String(outputDir || '').trim()
    const normalizedExportTime = Number.isFinite(exportTime) ? Math.max(0, Math.floor(exportTime)) : Date.now()
    if (!normalizedContent || !normalizedOutputDir) return
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) return

    setExportRecordsBySession(prev => {
      const next: Record<string, configService.ExportSessionRecordEntry[]> = { ...prev }
      let changed = false

      for (const rawSessionId of sessionIds) {
        const sessionId = String(rawSessionId || '').trim()
        if (!sessionId) continue
        const existingList = Array.isArray(next[sessionId]) ? [...next[sessionId]] : []
        const lastRecord = existingList[existingList.length - 1]
        if (
          lastRecord &&
          lastRecord.content === normalizedContent &&
          lastRecord.outputDir === normalizedOutputDir &&
          Math.abs(Number(lastRecord.exportTime || 0) - normalizedExportTime) <= 2000
        ) {
          continue
        }
        existingList.push({
          exportTime: normalizedExportTime,
          content: normalizedContent,
          outputDir: normalizedOutputDir
        })
        next[sessionId] = existingList.slice(-80)
        changed = true
      }

      if (!changed) return prev
      void configService.setExportSessionRecordMap(next)
      return next
    })
  }, [])

  const inferContentTypesFromOptions = (opts: ElectronExportOptions): ContentType[] => {
    const types: ContentType[] = ['text']
    if (opts.exportMedia) {
      if (opts.exportVoices) types.push('voice')
      if (opts.exportImages) types.push('image')
      if (opts.exportVideos) types.push('video')
      if (opts.exportEmojis) types.push('emoji')
    }
    return types
  }

  const updateTask = useCallback((taskId: string, updater: (task: ExportTask) => ExportTask) => {
    setTasks(prev => prev.map(task => (task.id === taskId ? updater(task) : task)))
  }, [])

  const runNextTask = useCallback(async () => {
    if (runningTaskIdRef.current) return

    const queue = [...tasksRef.current].reverse()
    const next = queue.find(task => task.status === 'queued')
    if (!next) return

    runningTaskIdRef.current = next.id
    updateTask(next.id, task => ({
      ...task,
      status: 'running',
      settledSessionIds: [],
      startedAt: Date.now(),
      finishedAt: undefined,
      error: undefined,
      performance: isTextBatchTask(task)
        ? (task.performance || createEmptyTaskPerformance())
        : task.performance
    }))
    const taskExportContentLabel = resolveTaskExportContentLabel(next.payload)

    progressUnsubscribeRef.current?.()
    const settledSessionIdsFromProgress = new Set<string>()
    if (next.payload.scope === 'sns') {
      progressUnsubscribeRef.current = sns.onExportProgress((payload) => {
        updateTask(next.id, task => {
          if (task.status !== 'running') return task
          return {
            ...task,
            progress: {
              current: payload.current || 0,
              total: payload.total || 0,
              currentName: '',
              phase: 'exporting',
              phaseLabel: payload.status || '',
              phaseProgress: payload.total > 0 ? payload.current : 0,
              phaseTotal: payload.total || 0
            }
          }
        })
      })
    } else {
      progressUnsubscribeRef.current = exportApi.onProgress((payload: ExportProgress) => {
        const now = Date.now()
        const currentSessionId = String(payload.currentSessionId || '').trim()
        if (payload.phase === 'complete' && currentSessionId && !settledSessionIdsFromProgress.has(currentSessionId)) {
          settledSessionIdsFromProgress.add(currentSessionId)
          const phaseLabel = String(payload.phaseLabel || '')
          const isFailed = phaseLabel.includes('失败')
          if (!isFailed) {
            const contentTypes = next.payload.contentType
              ? [next.payload.contentType]
              : (next.payload.options ? inferContentTypesFromOptions(next.payload.options) : [])
            markSessionExported([currentSessionId], now)
            if (contentTypes.length > 0) {
              markContentExported([currentSessionId], contentTypes, now)
            }
            markSessionExportRecords([currentSessionId], taskExportContentLabel, next.payload.outputDir, now)
          }
        }

        updateTask(next.id, task => {
          if (task.status !== 'running') return task
          const performance = applyProgressToTaskPerformance(task, payload, now)
          const settledSessionIds = task.settledSessionIds || []
          const nextSettledSessionIds = (
            payload.phase === 'complete' &&
            currentSessionId &&
            !settledSessionIds.includes(currentSessionId)
          )
            ? [...settledSessionIds, currentSessionId]
            : settledSessionIds
          return {
            ...task,
            progress: {
              current: payload.current,
              total: payload.total,
              currentName: payload.currentSession,
              phase: payload.phase,
              phaseLabel: payload.phaseLabel || '',
              phaseProgress: payload.phaseProgress || 0,
              phaseTotal: payload.phaseTotal || 0
            },
            settledSessionIds: nextSettledSessionIds,
            performance
          }
        })
      })
    }

    try {
      if (next.payload.scope === 'sns') {
        const snsOptions = next.payload.snsOptions || { format: 'html' as SnsTimelineExportFormat, exportImages: false, exportLivePhotos: false, exportVideos: false }
        const result = await sns.exportTimeline({
          outputDir: next.payload.outputDir,
          format: snsOptions.format,
          exportImages: snsOptions.exportImages,
          exportLivePhotos: snsOptions.exportLivePhotos,
          exportVideos: snsOptions.exportVideos,
          startTime: snsOptions.startTime,
          endTime: snsOptions.endTime
        })

        if (!result.success) {
          updateTask(next.id, task => ({
            ...task,
            status: 'error',
            finishedAt: Date.now(),
            error: result.error || '朋友圈导出失败',
            performance: finalizeTaskPerformance(task, Date.now())
          }))
        } else {
          const doneAt = Date.now()
          const exportedPosts = Math.max(0, result.postCount || 0)
          const mergedExportedCount = Math.max(lastSnsExportPostCount, exportedPosts)
          setLastSnsExportPostCount(mergedExportedCount)
          await configService.setExportLastSnsPostCount(mergedExportedCount)
          await loadSnsStats({ full: true })

          updateTask(next.id, task => ({
            ...task,
            status: 'success',
            finishedAt: doneAt,
            progress: {
              ...task.progress,
              current: exportedPosts,
              total: exportedPosts,
              phaseLabel: '完成',
              phaseProgress: 1,
              phaseTotal: 1
            },
            performance: finalizeTaskPerformance(task, doneAt)
          }))
        }
      } else {
        if (!next.payload.options) {
          throw new Error('导出参数缺失')
        }

        const result = await exportApi.exportSessions(
          next.payload.sessionIds,
          next.payload.outputDir,
          next.payload.options
        )

        if (!result.success) {
          updateTask(next.id, task => ({
            ...task,
            status: 'error',
            finishedAt: Date.now(),
            error: result.error || '导出失败',
            performance: finalizeTaskPerformance(task, Date.now())
          }))
        } else {
          const doneAt = Date.now()
          const contentTypes = next.payload.contentType
            ? [next.payload.contentType]
            : inferContentTypesFromOptions(next.payload.options)
          const successSessionIds = Array.isArray(result.successSessionIds)
            ? result.successSessionIds
            : []
          if (successSessionIds.length > 0) {
            const unsettledSuccessSessionIds = successSessionIds.filter((sessionId) => !settledSessionIdsFromProgress.has(sessionId))
            if (unsettledSuccessSessionIds.length > 0) {
              markSessionExported(unsettledSuccessSessionIds, doneAt)
              markSessionExportRecords(unsettledSuccessSessionIds, taskExportContentLabel, next.payload.outputDir, doneAt)
              if (contentTypes.length > 0) {
                markContentExported(unsettledSuccessSessionIds, contentTypes, doneAt)
              }
            }
          }

          updateTask(next.id, task => ({
            ...task,
            status: 'success',
            finishedAt: doneAt,
            progress: {
              ...task.progress,
              current: task.progress.total || next.payload.sessionIds.length,
              total: task.progress.total || next.payload.sessionIds.length,
              phaseLabel: '完成',
              phaseProgress: 1,
              phaseTotal: 1
            },
            performance: finalizeTaskPerformance(task, doneAt)
          }))
        }
      }
    } catch (error) {
      const doneAt = Date.now()
      updateTask(next.id, task => ({
        ...task,
        status: 'error',
        finishedAt: doneAt,
        error: String(error),
        performance: finalizeTaskPerformance(task, doneAt)
      }))
    } finally {
      progressUnsubscribeRef.current?.()
      progressUnsubscribeRef.current = null
      runningTaskIdRef.current = null
      void runNextTask()
    }
  }, [
    updateTask,
    markSessionExported,
    markSessionExportRecords,
    markContentExported,
    resolveTaskExportContentLabel,
    loadSnsStats,
    lastSnsExportPostCount
  ])

  useEffect(() => {
    void runNextTask()
  }, [tasks, runNextTask])

  useEffect(() => {
    return () => {
      progressUnsubscribeRef.current?.()
      progressUnsubscribeRef.current = null
    }
  }, [])

  const createTask = async () => {
    if (!exportDialog.open || !exportFolder) return
    if (exportDialog.scope !== 'sns' && exportDialog.sessionIds.length === 0) return

    const exportOptions = exportDialog.scope === 'sns'
      ? undefined
      : buildExportOptions(exportDialog.scope, exportDialog.contentType)
    const snsOptions = exportDialog.scope === 'sns'
      ? buildSnsExportOptions()
      : undefined
    const title =
      exportDialog.scope === 'single'
        ? `${exportDialog.sessionNames[0] || '会话'} 导出`
        : exportDialog.scope === 'multi'
          ? `批量导出（${exportDialog.sessionIds.length} 个会话）`
          : exportDialog.scope === 'sns'
            ? '朋友圈批量导出'
            : `${contentTypeLabels[exportDialog.contentType || 'text']}批量导出`

    const task: ExportTask = {
      id: createTaskId(),
      title,
      status: 'queued',
      settledSessionIds: [],
      createdAt: Date.now(),
      payload: {
        sessionIds: exportDialog.sessionIds,
        sessionNames: exportDialog.sessionNames,
        outputDir: exportFolder,
        options: exportOptions,
        scope: exportDialog.scope,
        contentType: exportDialog.contentType,
        snsOptions
      },
      progress: createEmptyProgress(),
      performance: exportDialog.scope === 'content' && exportDialog.contentType === 'text'
        ? createEmptyTaskPerformance()
        : undefined
    }

    setTasks(prev => [task, ...prev])
    closeExportDialog()

    await configService.setExportDefaultFormat(options.format)
    await configService.setExportDefaultAvatars(options.exportAvatars)
    await configService.setExportDefaultMedia({
      images: options.exportImages,
      voices: options.exportVoices,
      videos: options.exportVideos,
      emojis: options.exportEmojis
    })
    await configService.setExportDefaultVoiceAsText(options.exportVoiceAsText)
    await configService.setExportDefaultExcelCompactColumns(options.excelCompactColumns)
    await configService.setExportDefaultTxtColumns(options.txtColumns)
    await configService.setExportDefaultConcurrency(options.exportConcurrency)
  }

  const openSingleExport = useCallback((session: SessionRow) => {
    if (!session.hasSession) return
    openExportDialog({
      scope: 'single',
      sessionIds: [session.username],
      sessionNames: [session.displayName || session.username],
      title: `导出会话：${session.displayName || session.username}`
    })
  }, [openExportDialog])

  const resolveSessionExistingMessageCount = useCallback((session: SessionRow): number => {
    const counted = normalizeMessageCount(sessionMessageCounts[session.username])
    if (typeof counted === 'number') return counted
    const hinted = normalizeMessageCount(session.messageCountHint)
    if (typeof hinted === 'number') return hinted
    return 0
  }, [sessionMessageCounts])

  const orderSessionsForExport = useCallback((source: SessionRow[]): SessionRow[] => {
    return source
      .filter((session) => session.hasSession && isContentScopeSession(session))
      .map((session) => ({
        session,
        count: resolveSessionExistingMessageCount(session)
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => {
        const kindDiff = exportKindPriority[a.session.kind] - exportKindPriority[b.session.kind]
        if (kindDiff !== 0) return kindDiff
        if (a.count !== b.count) return b.count - a.count
        const tsA = a.session.sortTimestamp || a.session.lastTimestamp || 0
        const tsB = b.session.sortTimestamp || b.session.lastTimestamp || 0
        if (tsA !== tsB) return tsB - tsA
        return (a.session.displayName || a.session.username)
          .localeCompare(b.session.displayName || b.session.username, 'zh-Hans-CN')
      })
      .map((item) => item.session)
  }, [resolveSessionExistingMessageCount])

  const openBatchExport = () => {
    const selectedSet = new Set(selectedSessions)
    const selectedRows = sessions.filter((session) => selectedSet.has(session.username))
    const orderedRows = orderSessionsForExport(selectedRows)
    if (orderedRows.length === 0) {
      window.alert('所选会话暂无可导出的消息（总消息数为 0）')
      return
    }
    const ids = orderedRows.map((session) => session.username)
    const names = orderedRows.map((session) => session.displayName || session.username)

    openExportDialog({
      scope: 'multi',
      sessionIds: ids,
      sessionNames: names,
      title: `批量导出（${ids.length} 个会话）`
    })
  }

  const openContentExport = (contentType: ContentType) => {
    const orderedRows = orderSessionsForExport(sessions)
    if (orderedRows.length === 0) {
      window.alert('当前会话列表暂无可导出的消息（总消息数为 0）')
      return
    }
    const ids = orderedRows.map((session) => session.username)
    const names = orderedRows.map((session) => session.displayName || session.username)

    openExportDialog({
      scope: 'content',
      contentType,
      sessionIds: ids,
      sessionNames: names,
      title: `${contentTypeLabels[contentType]}批量导出`
    })
  }

  const openSnsExport = () => {
    openExportDialog({
      scope: 'sns',
      sessionIds: [],
      sessionNames: ['全部朋友圈动态'],
      title: '朋友圈批量导出'
    })
  }

  const runningSessionIds = useMemo(() => {
    const set = new Set<string>()
    for (const task of tasks) {
      if (task.status !== 'running') continue
      const settled = new Set(task.settledSessionIds || [])
      for (const id of task.payload.sessionIds) {
        if (settled.has(id)) continue
        set.add(id)
      }
    }
    return set
  }, [tasks])

  const queuedSessionIds = useMemo(() => {
    const set = new Set<string>()
    for (const task of tasks) {
      if (task.status !== 'queued') continue
      for (const id of task.payload.sessionIds) {
        set.add(id)
      }
    }
    return set
  }, [tasks])

  const inProgressSessionIds = useMemo(() => {
    const set = new Set<string>()
    for (const task of tasks) {
      if (task.status !== 'running' && task.status !== 'queued') continue
      for (const id of task.payload.sessionIds) {
        set.add(id)
      }
    }
    return Array.from(set).sort()
  }, [tasks])
  const activeTaskCount = useMemo(
    () => tasks.filter(task => task.status === 'running' || task.status === 'queued').length,
    [tasks]
  )

  const inProgressSessionIdsKey = useMemo(
    () => inProgressSessionIds.join('||'),
    [inProgressSessionIds]
  )
  const inProgressStatusKey = useMemo(
    () => `${activeTaskCount}::${inProgressSessionIdsKey}`,
    [activeTaskCount, inProgressSessionIdsKey]
  )

  useEffect(() => {
    inProgressSessionIdsRef.current = inProgressSessionIds
  }, [inProgressSessionIds])

  useEffect(() => {
    activeTaskCountRef.current = activeTaskCount
  }, [activeTaskCount])

  useEffect(() => {
    emitExportSessionStatus({
      inProgressSessionIds: inProgressSessionIdsRef.current,
      activeTaskCount: activeTaskCountRef.current
    })
  }, [inProgressStatusKey])

  useEffect(() => {
    const unsubscribe = onExportSessionStatusRequest(() => {
      emitExportSessionStatus({
        inProgressSessionIds: inProgressSessionIdsRef.current,
        activeTaskCount: activeTaskCountRef.current
      })
    })
    return unsubscribe
  }, [])

  const runningCardTypes = useMemo(() => {
    const set = new Set<ContentCardType>()
    for (const task of tasks) {
      if (task.status !== 'running') continue
      if (task.payload.scope === 'sns') {
        set.add('sns')
        continue
      }
      if (task.payload.scope === 'content' && task.payload.contentType) {
        set.add(task.payload.contentType)
      }
    }
    return set
  }, [tasks])

  const contentCards = useMemo(() => {
    const scopeSessions = sessions.filter(isContentScopeSession)
    const snsExportedCount = Math.min(lastSnsExportPostCount, snsStats.totalPosts)

    const sessionCards = [
      { type: 'text' as ContentType, icon: MessageSquareText },
      { type: 'voice' as ContentType, icon: Mic },
      { type: 'image' as ContentType, icon: ImageIcon },
      { type: 'video' as ContentType, icon: Video },
      { type: 'emoji' as ContentType, icon: WandSparkles }
    ].map(item => {
      let exported = 0
      for (const session of scopeSessions) {
        if (lastExportByContent[`${session.username}::${item.type}`]) {
          exported += 1
        }
      }

      return {
        ...item,
        label: contentTypeLabels[item.type],
        stats: [
          { label: '已导出', value: exported, unit: '个对话' }
        ]
      }
    })

    const snsCard = {
      type: 'sns' as ContentCardType,
      icon: Aperture,
      label: '朋友圈',
      headerCount: snsStats.totalPosts,
      stats: [
        { label: '已导出', value: snsExportedCount, unit: '条' }
      ]
    }

    return [...sessionCards, snsCard]
  }, [sessions, lastExportByContent, snsStats, lastSnsExportPostCount])

  const activeTabLabel = useMemo(() => {
    if (activeTab === 'private') return '私聊'
    if (activeTab === 'group') return '群聊'
    return '曾经的好友'
  }, [activeTab])
  const contactsHeaderMainLabel = useMemo(() => {
    if (activeTab === 'group') return '群聊名称'
    if (activeTab === 'private' || activeTab === 'former_friend') return '联系人'
    return '联系人（头像/名称/微信号）'
  }, [activeTab])
  const shouldShowSnsColumn = useMemo(() => (
    activeTab === 'private' || activeTab === 'former_friend'
  ), [activeTab])
  const shouldShowMutualFriendsColumn = shouldShowSnsColumn

  const sessionRowByUsername = useMemo(() => {
    const map = new Map<string, SessionRow>()
    for (const session of sessions) {
      map.set(session.username, session)
    }
    return map
  }, [sessions])

  const filteredContacts = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()
    const contacts = contactsList
      .filter((contact) => {
        if (!matchesContactTab(contact, activeTab)) return false
        if (!keyword) return true
        return (
          (contact.displayName || '').toLowerCase().includes(keyword) ||
          (contact.remark || '').toLowerCase().includes(keyword) ||
          (contact.nickname || '').toLowerCase().includes(keyword) ||
          (contact.alias || '').toLowerCase().includes(keyword) ||
          contact.username.toLowerCase().includes(keyword)
        )
      })

    const indexedContacts = contacts.map((contact, index) => ({
      contact,
      index,
      count: (() => {
        const counted = normalizeMessageCount(sessionMessageCounts[contact.username])
        if (typeof counted === 'number') return counted
        const hinted = normalizeMessageCount(sessionRowByUsername.get(contact.username)?.messageCountHint)
        return hinted
      })()
    }))

    indexedContacts.sort((a, b) => {
      const aHasCount = typeof a.count === 'number'
      const bHasCount = typeof b.count === 'number'
      if (aHasCount && bHasCount) {
        const diff = (b.count as number) - (a.count as number)
        if (diff !== 0) return diff
      } else if (aHasCount) {
        return -1
      } else if (bHasCount) {
        return 1
      }
      // 无统计值或同分时保持原顺序，避免列表频繁跳动。
      return a.index - b.index
    })

    return indexedContacts.map(item => item.contact)
  }, [contactsList, activeTab, searchKeyword, sessionMessageCounts, sessionRowByUsername])

  const keywordMatchedContactUsernameSet = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()
    const matched = new Set<string>()
    for (const contact of contactsList) {
      if (!contact?.username) continue
      if (!keyword) {
        matched.add(contact.username)
        continue
      }
      if (
        (contact.displayName || '').toLowerCase().includes(keyword) ||
        (contact.remark || '').toLowerCase().includes(keyword) ||
        (contact.nickname || '').toLowerCase().includes(keyword) ||
        (contact.alias || '').toLowerCase().includes(keyword) ||
        contact.username.toLowerCase().includes(keyword)
      ) {
        matched.add(contact.username)
      }
    }
    return matched
  }, [contactsList, searchKeyword])

  const loadDetailTargetsByTab = useMemo(() => {
    const targets: Record<ConversationTab, string[]> = {
      private: [],
      group: [],
      official: [],
      former_friend: []
    }
    for (const session of sessions) {
      if (!session.hasSession) continue
      if (!keywordMatchedContactUsernameSet.has(session.username)) continue
      targets[session.kind].push(session.username)
    }
    return targets
  }, [keywordMatchedContactUsernameSet, sessions])

  const formatLoadDetailTime = useCallback((value?: number): string => {
    if (!value || !Number.isFinite(value)) return '--'
    return new Date(value).toLocaleTimeString('zh-CN', { hour12: false })
  }, [])

  const getLoadDetailStatusLabel = useCallback((loaded: number, total: number, hasStarted: boolean): string => {
    if (total <= 0) return '待加载'
    if (loaded >= total) return `已完成 ${total}`
    if (hasStarted) return `加载中 ${loaded}/${total}`
    return '待加载'
  }, [])

  const summarizeLoadTraceForTab = useCallback((
    sessionIds: string[],
    stageKey: keyof SessionLoadTraceState
  ): SessionLoadStageSummary => {
    const total = sessionIds.length
    let loaded = 0
    let hasStarted = false
    let earliestStart: number | undefined
    let latestFinish: number | undefined
    let latestProgressAt: number | undefined
    for (const sessionId of sessionIds) {
      const stage = sessionLoadTraceMap[sessionId]?.[stageKey]
      if (stage?.status === 'done') {
        loaded += 1
        if (typeof stage.finishedAt === 'number') {
          latestProgressAt = latestProgressAt === undefined
            ? stage.finishedAt
            : Math.max(latestProgressAt, stage.finishedAt)
        }
      }
      if (stage?.status === 'loading' || stage?.status === 'failed' || typeof stage?.startedAt === 'number') {
        hasStarted = true
      }
      if (typeof stage?.startedAt === 'number') {
        earliestStart = earliestStart === undefined
          ? stage.startedAt
          : Math.min(earliestStart, stage.startedAt)
      }
      if (typeof stage?.finishedAt === 'number') {
        latestFinish = latestFinish === undefined
          ? stage.finishedAt
          : Math.max(latestFinish, stage.finishedAt)
      }
    }
    return {
      total,
      loaded,
      statusLabel: getLoadDetailStatusLabel(loaded, total, hasStarted),
      startedAt: earliestStart,
      finishedAt: loaded >= total ? latestFinish : undefined,
      latestProgressAt
    }
  }, [getLoadDetailStatusLabel, sessionLoadTraceMap])

  const createNotApplicableLoadSummary = useCallback((): SessionLoadStageSummary => {
    return {
      total: 0,
      loaded: 0,
      statusLabel: '不适用'
    }
  }, [])

  const sessionLoadDetailRows = useMemo(() => {
    const tabOrder: ConversationTab[] = ['private', 'group', 'former_friend']
    return tabOrder.map((tab) => {
      const sessionIds = loadDetailTargetsByTab[tab] || []
      const snsSessionIds = sessionIds.filter((sessionId) => isSingleContactSession(sessionId))
      const snsPostCounts = tab === 'private' || tab === 'former_friend'
        ? summarizeLoadTraceForTab(snsSessionIds, 'snsPostCounts')
        : createNotApplicableLoadSummary()
      const mutualFriends = tab === 'private' || tab === 'former_friend'
        ? summarizeLoadTraceForTab(snsSessionIds, 'mutualFriends')
        : createNotApplicableLoadSummary()
      return {
        tab,
        label: conversationTabLabels[tab],
        messageCount: summarizeLoadTraceForTab(sessionIds, 'messageCount'),
        mediaMetrics: summarizeLoadTraceForTab(sessionIds, 'mediaMetrics'),
        snsPostCounts,
        mutualFriends
      }
    })
  }, [createNotApplicableLoadSummary, loadDetailTargetsByTab, summarizeLoadTraceForTab])

  const formatLoadDetailPulseTime = useCallback((value?: number): string => {
    if (!value || !Number.isFinite(value)) return '--'
    return new Date(value).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }, [])

  useEffect(() => {
    const previousSnapshot = sessionLoadProgressSnapshotRef.current
    const nextSnapshot: Record<string, { loaded: number; total: number }> = {}
    const resetKeys: string[] = []
    const updates: Array<{ key: string; at: number; delta: number }> = []
    const stageKeys: Array<keyof SessionLoadTraceState> = ['messageCount', 'mediaMetrics', 'snsPostCounts', 'mutualFriends']

    for (const row of sessionLoadDetailRows) {
      for (const stageKey of stageKeys) {
        const summary = row[stageKey]
        const key = `${stageKey}:${row.tab}`
        const loaded = Number.isFinite(summary.loaded) ? Math.max(0, Math.floor(summary.loaded)) : 0
        const total = Number.isFinite(summary.total) ? Math.max(0, Math.floor(summary.total)) : 0
        nextSnapshot[key] = { loaded, total }

        const previous = previousSnapshot[key]
        if (!previous || previous.total !== total || loaded < previous.loaded) {
          resetKeys.push(key)
          continue
        }
        if (loaded > previous.loaded) {
          updates.push({
            key,
            at: summary.latestProgressAt || Date.now(),
            delta: loaded - previous.loaded
          })
        }
      }
    }

    sessionLoadProgressSnapshotRef.current = nextSnapshot
    if (resetKeys.length === 0 && updates.length === 0) return

    setSessionLoadProgressPulseMap(prev => {
      let changed = false
      const next = { ...prev }
      for (const key of resetKeys) {
        if (!(key in next)) continue
        delete next[key]
        changed = true
      }
      for (const update of updates) {
        const previous = next[update.key]
        if (previous && previous.at === update.at && previous.delta === update.delta) continue
        next[update.key] = { at: update.at, delta: update.delta }
        changed = true
      }
      return changed ? next : prev
    })
  }, [sessionLoadDetailRows])

  useEffect(() => {
    contactsVirtuosoRef.current?.scrollToIndex({ index: 0, align: 'start' })
    setIsContactsListAtTop(true)
  }, [activeTab, searchKeyword])

  const collectVisibleSessionMetricTargets = useCallback((sourceContacts: ContactInfo[]): string[] => {
    if (sourceContacts.length === 0) return []
    const startCandidate = sessionMediaMetricVisibleRangeRef.current.startIndex
    const endCandidate = sessionMediaMetricVisibleRangeRef.current.endIndex
    const startIndex = Math.max(0, Math.min(sourceContacts.length - 1, startCandidate >= 0 ? startCandidate : 0))
    const visibleEnd = endCandidate >= startIndex
      ? endCandidate
      : Math.min(sourceContacts.length - 1, startIndex + 9)
    const endIndex = Math.max(startIndex, Math.min(sourceContacts.length - 1, visibleEnd + SESSION_MEDIA_METRIC_PREFETCH_ROWS))
    const sessionIds: string[] = []
    for (let index = startIndex; index <= endIndex; index += 1) {
      const contact = sourceContacts[index]
      if (!contact?.username) continue
      const mappedSession = sessionRowByUsername.get(contact.username)
      if (!mappedSession?.hasSession) continue
      sessionIds.push(contact.username)
    }
    return sessionIds
  }, [sessionRowByUsername])

  const collectVisibleSessionMutualFriendsTargets = useCallback((sourceContacts: ContactInfo[]): string[] => {
    if (sourceContacts.length === 0) return []
    const startCandidate = sessionMutualFriendsVisibleRangeRef.current.startIndex
    const endCandidate = sessionMutualFriendsVisibleRangeRef.current.endIndex
    const startIndex = Math.max(0, Math.min(sourceContacts.length - 1, startCandidate >= 0 ? startCandidate : 0))
    const visibleEnd = endCandidate >= startIndex
      ? endCandidate
      : Math.min(sourceContacts.length - 1, startIndex + 9)
    const endIndex = Math.max(startIndex, Math.min(sourceContacts.length - 1, visibleEnd + SESSION_MEDIA_METRIC_PREFETCH_ROWS))
    const sessionIds: string[] = []
    for (let index = startIndex; index <= endIndex; index += 1) {
      const contact = sourceContacts[index]
      if (!contact?.username || !isSingleContactSession(contact.username)) continue
      const mappedSession = sessionRowByUsername.get(contact.username)
      if (!mappedSession?.hasSession) continue
      sessionIds.push(contact.username)
    }
    return sessionIds
  }, [sessionRowByUsername])

  const handleContactsRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    const startIndex = Number.isFinite(range?.startIndex) ? Math.max(0, Math.floor(range.startIndex)) : 0
    const endIndex = Number.isFinite(range?.endIndex) ? Math.max(startIndex, Math.floor(range.endIndex)) : startIndex
    sessionMediaMetricVisibleRangeRef.current = { startIndex, endIndex }
    sessionMutualFriendsVisibleRangeRef.current = { startIndex, endIndex }
    if (isLoadingSessionCountsRef.current || !isSessionCountStageReady) return
    const visibleTargets = collectVisibleSessionMetricTargets(filteredContacts)
    if (visibleTargets.length === 0) return
    enqueueSessionMediaMetricRequests(visibleTargets, { front: true })
    scheduleSessionMediaMetricWorker()
    const visibleMutualFriendsTargets = collectVisibleSessionMutualFriendsTargets(filteredContacts)
    if (visibleMutualFriendsTargets.length > 0) {
      enqueueSessionMutualFriendsRequests(visibleMutualFriendsTargets, { front: true })
      scheduleSessionMutualFriendsWorker()
    }
  }, [
    collectVisibleSessionMetricTargets,
    collectVisibleSessionMutualFriendsTargets,
    enqueueSessionMediaMetricRequests,
    enqueueSessionMutualFriendsRequests,
    filteredContacts,
    isSessionCountStageReady,
    scheduleSessionMediaMetricWorker,
    scheduleSessionMutualFriendsWorker
  ])

  useEffect(() => {
    if (!isSessionCountStageReady || filteredContacts.length === 0) return
    const runId = sessionMediaMetricRunIdRef.current
    const visibleTargets = collectVisibleSessionMetricTargets(filteredContacts)
    if (visibleTargets.length > 0) {
      enqueueSessionMediaMetricRequests(visibleTargets, { front: true })
      scheduleSessionMediaMetricWorker()
    }

    if (sessionMediaMetricBackgroundFeedTimerRef.current) {
      window.clearTimeout(sessionMediaMetricBackgroundFeedTimerRef.current)
      sessionMediaMetricBackgroundFeedTimerRef.current = null
    }

    const visibleTargetSet = new Set(visibleTargets)
    let cursor = 0
    const feedNext = () => {
      if (runId !== sessionMediaMetricRunIdRef.current) return
      if (isLoadingSessionCountsRef.current) return
      const batchIds: string[] = []
      while (cursor < filteredContacts.length && batchIds.length < SESSION_MEDIA_METRIC_BACKGROUND_FEED_SIZE) {
        const contact = filteredContacts[cursor]
        cursor += 1
        if (!contact?.username) continue
        if (visibleTargetSet.has(contact.username)) continue
        const mappedSession = sessionRowByUsername.get(contact.username)
        if (!mappedSession?.hasSession) continue
        batchIds.push(contact.username)
      }

      if (batchIds.length > 0) {
        enqueueSessionMediaMetricRequests(batchIds)
        scheduleSessionMediaMetricWorker()
      }

      if (cursor < filteredContacts.length) {
        sessionMediaMetricBackgroundFeedTimerRef.current = window.setTimeout(feedNext, SESSION_MEDIA_METRIC_BACKGROUND_FEED_INTERVAL_MS)
      }
    }

    feedNext()
    return () => {
      if (sessionMediaMetricBackgroundFeedTimerRef.current) {
        window.clearTimeout(sessionMediaMetricBackgroundFeedTimerRef.current)
        sessionMediaMetricBackgroundFeedTimerRef.current = null
      }
    }
  }, [
    collectVisibleSessionMetricTargets,
    enqueueSessionMediaMetricRequests,
    filteredContacts,
    isSessionCountStageReady,
    scheduleSessionMediaMetricWorker,
    sessionRowByUsername
  ])

  useEffect(() => {
    if (!isSessionCountStageReady || filteredContacts.length === 0) return
    const runId = sessionMutualFriendsRunIdRef.current
    const visibleTargets = collectVisibleSessionMutualFriendsTargets(filteredContacts)
    if (visibleTargets.length > 0) {
      enqueueSessionMutualFriendsRequests(visibleTargets, { front: true })
      scheduleSessionMutualFriendsWorker()
    }

    if (sessionMutualFriendsBackgroundFeedTimerRef.current) {
      window.clearTimeout(sessionMutualFriendsBackgroundFeedTimerRef.current)
      sessionMutualFriendsBackgroundFeedTimerRef.current = null
    }

    const visibleTargetSet = new Set(visibleTargets)
    let cursor = 0
    const feedNext = () => {
      if (runId !== sessionMutualFriendsRunIdRef.current) return
      const batchIds: string[] = []
      while (cursor < filteredContacts.length && batchIds.length < SESSION_MEDIA_METRIC_BACKGROUND_FEED_SIZE) {
        const contact = filteredContacts[cursor]
        cursor += 1
        if (!contact?.username || !isSingleContactSession(contact.username)) continue
        if (visibleTargetSet.has(contact.username)) continue
        const mappedSession = sessionRowByUsername.get(contact.username)
        if (!mappedSession?.hasSession) continue
        batchIds.push(contact.username)
      }

      if (batchIds.length > 0) {
        enqueueSessionMutualFriendsRequests(batchIds)
        scheduleSessionMutualFriendsWorker()
      }

      if (cursor < filteredContacts.length) {
        sessionMutualFriendsBackgroundFeedTimerRef.current = window.setTimeout(feedNext, SESSION_MEDIA_METRIC_BACKGROUND_FEED_INTERVAL_MS)
      }
    }

    feedNext()
    return () => {
      if (sessionMutualFriendsBackgroundFeedTimerRef.current) {
        window.clearTimeout(sessionMutualFriendsBackgroundFeedTimerRef.current)
        sessionMutualFriendsBackgroundFeedTimerRef.current = null
      }
    }
  }, [
    collectVisibleSessionMutualFriendsTargets,
    enqueueSessionMutualFriendsRequests,
    filteredContacts,
    isSessionCountStageReady,
    scheduleSessionMutualFriendsWorker,
    sessionRowByUsername
  ])

  useEffect(() => {
    return () => {
      snsUserPostCountsHydrationTokenRef.current += 1
      if (snsUserPostCountsBatchTimerRef.current) {
        window.clearTimeout(snsUserPostCountsBatchTimerRef.current)
        snsUserPostCountsBatchTimerRef.current = null
      }
      if (sessionMediaMetricBackgroundFeedTimerRef.current) {
        window.clearTimeout(sessionMediaMetricBackgroundFeedTimerRef.current)
        sessionMediaMetricBackgroundFeedTimerRef.current = null
      }
      if (sessionMediaMetricPersistTimerRef.current) {
        window.clearTimeout(sessionMediaMetricPersistTimerRef.current)
        sessionMediaMetricPersistTimerRef.current = null
      }
      if (sessionMutualFriendsBackgroundFeedTimerRef.current) {
        window.clearTimeout(sessionMutualFriendsBackgroundFeedTimerRef.current)
        sessionMutualFriendsBackgroundFeedTimerRef.current = null
      }
      void flushSessionMediaMetricCache()
    }
  }, [flushSessionMediaMetricCache])

  const contactByUsername = useMemo(() => {
    const map = new Map<string, ContactInfo>()
    for (const contact of contactsList) {
      map.set(contact.username, contact)
    }
    return map
  }, [contactsList])

  const currentSessionExportRecords = useMemo(() => {
    const sessionId = String(sessionDetail?.wxid || '').trim()
    if (!sessionId) return [] as configService.ExportSessionRecordEntry[]
    const records = Array.isArray(exportRecordsBySession[sessionId]) ? exportRecordsBySession[sessionId] : []
    return [...records]
      .sort((a, b) => Number(b.exportTime || 0) - Number(a.exportTime || 0))
      .slice(0, 20)
  }, [sessionDetail?.wxid, exportRecordsBySession])

  const sessionDetailSupportsSnsTimeline = useMemo(() => {
    const sessionId = String(sessionDetail?.wxid || '').trim()
    return isSingleContactSession(sessionId)
  }, [sessionDetail?.wxid])

  const sessionDetailSnsCountLabel = useMemo(() => {
    const sessionId = String(sessionDetail?.wxid || '').trim()
    if (!sessionId || !sessionDetailSupportsSnsTimeline) return '朋友圈：0条'

    if (snsUserPostCountsStatus === 'loading' || snsUserPostCountsStatus === 'idle') {
      return '朋友圈：统计中...'
    }
    if (snsUserPostCountsStatus === 'error') {
      return '朋友圈：统计失败'
    }

    const count = Number(snsUserPostCounts[sessionId] || 0)
    const normalized = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
    return `朋友圈：${normalized}条`
  }, [sessionDetail?.wxid, sessionDetailSupportsSnsTimeline, snsUserPostCounts, snsUserPostCountsStatus])

  const sessionMutualFriendsDialogMetric = useMemo(() => {
    const sessionId = String(sessionMutualFriendsDialogTarget?.username || '').trim()
    if (!sessionId) return null
    return sessionMutualFriendsMetrics[sessionId] || null
  }, [sessionMutualFriendsDialogTarget, sessionMutualFriendsMetrics])

  const filteredSessionMutualFriendsDialogItems = useMemo(() => {
    const items = sessionMutualFriendsDialogMetric?.items || []
    const keyword = sessionMutualFriendsSearch.trim().toLowerCase()
    if (!keyword) return items
    return items.filter(item => item.name.toLowerCase().includes(keyword))
  }, [sessionMutualFriendsDialogMetric, sessionMutualFriendsSearch])

  const applySessionDetailStats = useCallback((
    sessionId: string,
    metric: SessionExportMetric,
    cacheMeta?: SessionExportCacheMeta,
    relationLoadedOverride?: boolean
  ) => {
    mergeSessionContentMetrics({ [sessionId]: metric })
    setSessionDetail((prev) => applySessionDetailStatsState(
      prev,
      sessionId,
      metric,
      cacheMeta,
      relationLoadedOverride
    ))
  }, [mergeSessionContentMetrics])

  const loadSessionDetail = useCallback(async (sessionId: string) => {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return
    const preciseCacheKey = `${exportCacheScopeRef.current}::${normalizedSessionId}`

    detailStatsPriorityRef.current = true
    sessionCountRequestIdRef.current += 1
    setIsLoadingSessionCounts(false)

    const requestSeq = ++detailRequestSeqRef.current
    const mappedSession = sessionRowByUsername.get(normalizedSessionId)
    const mappedContact = contactByUsername.get(normalizedSessionId)
    const cachedMetric = sessionContentMetrics[normalizedSessionId]
    const countedCount = normalizeMessageCount(sessionMessageCounts[normalizedSessionId])

    setCopiedDetailField(null)
    setIsRefreshingSessionDetailStats(false)
    setIsLoadingSessionRelationStats(false)
    setSessionDetail((prev) => buildInitialSessionDetailState({
      sessionId: normalizedSessionId,
      previous: prev,
      mappedSession,
      mappedContact,
      cachedMetric,
      countedCount
    }))
    setIsLoadingSessionDetail(true)
    setIsLoadingSessionDetailExtra(true)

    try {
      const result = await chat.getSessionDetailFast(normalizedSessionId)
      if (requestSeq !== detailRequestSeqRef.current) return
      if (result.success && result.detail) {
        const fastMessageCount = normalizeMessageCount(result.detail.messageCount)
        if (typeof fastMessageCount === 'number') {
          setSessionMessageCounts((prev) => {
            if (prev[normalizedSessionId] === fastMessageCount) return prev
            return {
              ...prev,
              [normalizedSessionId]: fastMessageCount
            }
          })
          mergeSessionContentMetrics({
            [normalizedSessionId]: {
              totalMessages: fastMessageCount
            }
          })
        }
        setSessionDetail((prev) => mergeFastSessionDetailState(
          prev,
          normalizedSessionId,
          result.detail!
        ))
      }
    } catch (error) {
      logger.error('导出页加载会话详情失败:', error)
    } finally {
      if (requestSeq === detailRequestSeqRef.current) {
        setIsLoadingSessionDetail(false)
      }
    }

    try {
      const extraPromise = chat.getSessionDetailExtra(normalizedSessionId)
      void (async () => {
        try {
          const extraResult = await extraPromise
          if (requestSeq !== detailRequestSeqRef.current) return
          if (!extraResult.success || !extraResult.detail) return
          const detail = extraResult.detail
          setSessionDetail((prev) => mergeSessionDetailExtraState(
            prev,
            normalizedSessionId,
            detail
          ))
        } catch (error) {
          logger.error('导出页加载会话详情补充信息失败:', error)
        } finally {
          if (requestSeq === detailRequestSeqRef.current) {
            setIsLoadingSessionDetailExtra(false)
          }
        }
      })()

      let quickMetric: SessionExportMetric | undefined
      let quickCacheMeta: SessionExportCacheMeta | undefined
      try {
        const quickStatsResult = await chat.getExportSessionStats(
          [normalizedSessionId],
          { includeRelations: false, allowStaleCache: true, cacheOnly: true }
        )
        if (requestSeq !== detailRequestSeqRef.current) return
        if (quickStatsResult.success) {
          quickMetric = quickStatsResult.data?.[normalizedSessionId] as SessionExportMetric | undefined
          quickCacheMeta = quickStatsResult.cache?.[normalizedSessionId] as SessionExportCacheMeta | undefined
          if (quickMetric) {
            applySessionDetailStats(normalizedSessionId, quickMetric, quickCacheMeta, false)
          } else if (quickCacheMeta) {
            const cacheMeta = quickCacheMeta
            setSessionDetail((prev) => mergeSessionDetailCacheMetaState(
              prev,
              normalizedSessionId,
              cacheMeta
            ))
          }
        }
      } catch (error) {
        logger.error('导出页读取会话统计缓存失败:', error)
      }

      const lastPreciseAt = sessionPreciseRefreshAtRef.current[preciseCacheKey] || 0
      const shouldRunPreciseRefresh = shouldRunPreciseSessionDetailRefresh({
        lastPreciseAt,
        quickMetric,
        quickCacheMeta,
        cooldownMs: DETAIL_PRECISE_REFRESH_COOLDOWN_MS
      })

      if (shouldRunPreciseRefresh) {
        setIsRefreshingSessionDetailStats(true)
        void (async () => {
          try {
            // 后台精确补算三类重字段（转账/红包/通话），不阻塞首屏基础统计显示。
            const freshResult = await chat.getExportSessionStats(
              [normalizedSessionId],
              { includeRelations: false, forceRefresh: true, preferAccurateSpecialTypes: true }
            )
            if (requestSeq !== detailRequestSeqRef.current) return
            if (freshResult.success && freshResult.data) {
              const metric = freshResult.data[normalizedSessionId] as SessionExportMetric | undefined
              const cacheMeta = freshResult.cache?.[normalizedSessionId] as SessionExportCacheMeta | undefined
              if (metric) {
                applySessionDetailStats(normalizedSessionId, metric, cacheMeta, false)
                sessionPreciseRefreshAtRef.current[preciseCacheKey] = Date.now()
              } else if (cacheMeta) {
                setSessionDetail((prev) => mergeSessionDetailCacheMetaState(
                  prev,
                  normalizedSessionId,
                  cacheMeta
                ))
              }
            }
          } catch (error) {
            logger.error('导出页刷新会话统计失败:', error)
          } finally {
            if (requestSeq === detailRequestSeqRef.current) {
              setIsRefreshingSessionDetailStats(false)
            }
          }
        })()
      }
    } catch (error) {
      logger.error('导出页加载会话详情补充统计失败:', error)
      if (requestSeq === detailRequestSeqRef.current) {
        setIsLoadingSessionDetailExtra(false)
      }
    }
  }, [applySessionDetailStats, contactByUsername, mergeSessionContentMetrics, sessionContentMetrics, sessionMessageCounts, sessionRowByUsername])

  const loadSessionRelationStats = useCallback(async () => {
    const normalizedSessionId = String(sessionDetail?.wxid || '').trim()
    if (!normalizedSessionId || isLoadingSessionRelationStats) return

    const requestSeq = detailRequestSeqRef.current
    setIsLoadingSessionRelationStats(true)
    try {
      const relationResult = await chat.getExportSessionStats(
        [normalizedSessionId],
        { includeRelations: true, forceRefresh: true, preferAccurateSpecialTypes: true }
      )
      if (requestSeq !== detailRequestSeqRef.current) return

      const metric = relationResult.success && relationResult.data
        ? relationResult.data[normalizedSessionId] as SessionExportMetric | undefined
        : undefined
      const cacheMeta = relationResult.success
        ? relationResult.cache?.[normalizedSessionId] as SessionExportCacheMeta | undefined
        : undefined
      if (metric) {
        applySessionDetailStats(normalizedSessionId, metric, cacheMeta, true)
      }
    } catch (error) {
      logger.error('导出页加载会话关系统计失败:', error)
    } finally {
      if (requestSeq === detailRequestSeqRef.current) {
        setIsLoadingSessionRelationStats(false)
      }
    }
  }, [applySessionDetailStats, isLoadingSessionRelationStats, sessionDetail?.wxid])

  useEffect(() => {
    if (!showSessionDetailPanel || !sessionDetailSupportsSnsTimeline) return
    if (snsUserPostCountsStatus === 'idle') {
      void loadSnsUserPostCounts()
    }
  }, [
    loadSnsUserPostCounts,
    sessionDetailSupportsSnsTimeline,
    showSessionDetailPanel,
    snsUserPostCountsStatus
  ])

  useEffect(() => {
    if (!isExportRoute || !isSessionCountStageReady) return
    if (snsUserPostCountsStatus !== 'idle') return
    const timer = window.setTimeout(() => {
      void loadSnsUserPostCounts()
    }, 260)
    return () => window.clearTimeout(timer)
  }, [isExportRoute, isSessionCountStageReady, loadSnsUserPostCounts, snsUserPostCountsStatus])

  useEffect(() => {
    if (!sessionSnsTimelineTarget) return
    if (Object.prototype.hasOwnProperty.call(snsUserPostCounts, sessionSnsTimelineTarget.username)) {
      const total = Number(snsUserPostCounts[sessionSnsTimelineTarget.username] || 0)
      const normalizedTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
      setSessionSnsTimelineTotalPosts(normalizedTotal)
      setSessionSnsRankTotalPosts(normalizedTotal)
      setSessionSnsTimelineStatsLoading(false)
      return
    }
    if (snsUserPostCountsStatus === 'loading' || snsUserPostCountsStatus === 'idle') {
      setSessionSnsTimelineStatsLoading(true)
      return
    }
    setSessionSnsTimelineTotalPosts(null)
    setSessionSnsRankTotalPosts(null)
    setSessionSnsTimelineStatsLoading(false)
  }, [sessionSnsTimelineTarget, snsUserPostCounts, snsUserPostCountsStatus])

  useEffect(() => {
    if (sessionSnsTimelineTotalPosts === null) return
    if (sessionSnsTimelinePosts.length >= sessionSnsTimelineTotalPosts) {
      setSessionSnsTimelineHasMore(false)
    }
  }, [sessionSnsTimelinePosts.length, sessionSnsTimelineTotalPosts])

  useEffect(() => {
    if (!sessionSnsRankMode || !sessionSnsTimelineTarget) return
    void loadSessionSnsRankings(sessionSnsTimelineTarget)
  }, [loadSessionSnsRankings, sessionSnsRankMode, sessionSnsTimelineTarget])

  const closeSessionDetailPanel = useCallback(() => {
    detailRequestSeqRef.current += 1
    detailStatsPriorityRef.current = false
    sessionSnsTimelineRequestTokenRef.current += 1
    sessionSnsTimelineLoadingRef.current = false
    sessionSnsRankRequestTokenRef.current += 1
    sessionSnsRankLoadingRef.current = false
    setShowSessionDetailPanel(false)
    setIsLoadingSessionDetail(false)
    setIsLoadingSessionDetailExtra(false)
    setIsRefreshingSessionDetailStats(false)
    setIsLoadingSessionRelationStats(false)
    setSessionSnsRankMode(null)
    setSessionSnsLikeRankings([])
    setSessionSnsCommentRankings([])
    setSessionSnsRankLoading(false)
    setSessionSnsRankError(null)
    setSessionSnsRankLoadedPosts(0)
    setSessionSnsRankTotalPosts(null)
    setSessionSnsTimelineTarget(null)
    setSessionSnsTimelinePosts([])
    setSessionSnsTimelineLoading(false)
    setSessionSnsTimelineLoadingMore(false)
    setSessionSnsTimelineHasMore(false)
    setSessionSnsTimelineTotalPosts(null)
    setSessionSnsTimelineStatsLoading(false)
  }, [])

  const openSessionDetail = useCallback((sessionId: string) => {
    if (!sessionId) return
    detailStatsPriorityRef.current = true
    setShowSessionDetailPanel(true)
    if (isSingleContactSession(sessionId)) {
      void loadSnsUserPostCounts()
    }
    void loadSessionDetail(sessionId)
  }, [loadSessionDetail, loadSnsUserPostCounts])

  useEffect(() => {
    if (!showSessionDetailPanel) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSessionDetailPanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeSessionDetailPanel, showSessionDetailPanel])

  useEffect(() => {
    if (!showSessionLoadDetailModal) return
    if (snsUserPostCountsStatus === 'idle') {
      void loadSnsUserPostCounts()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSessionLoadDetailModal(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [loadSnsUserPostCounts, showSessionLoadDetailModal, snsUserPostCountsStatus])

  useEffect(() => {
    if (!sessionSnsTimelineTarget) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSessionSnsTimeline()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeSessionSnsTimeline, sessionSnsTimelineTarget])

  useEffect(() => {
    if (!sessionMutualFriendsDialogTarget) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSessionMutualFriendsDialog()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeSessionMutualFriendsDialog, sessionMutualFriendsDialogTarget])

  const handleCopyDetailField = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedDetailField(field)
      setTimeout(() => setCopiedDetailField(null), 1500)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedDetailField(field)
      setTimeout(() => setCopiedDetailField(null), 1500)
    }
  }, [])

  const contactsIssueElapsedMs = useMemo(() => {
    if (!contactsLoadIssue) return 0
    if (isContactsListLoading && contactsLoadSession) {
      return Math.max(contactsLoadIssue.elapsedMs, contactsDiagnosticTick - contactsLoadSession.startedAt)
    }
    return contactsLoadIssue.elapsedMs
  }, [contactsDiagnosticTick, isContactsListLoading, contactsLoadIssue, contactsLoadSession])

  const contactsDiagnosticsText = useMemo(() => {
    if (!contactsLoadIssue || !contactsLoadSession) return ''
    return [
      `请求ID: ${contactsLoadSession.requestId}`,
      `请求序号: 第 ${contactsLoadSession.attempt} 次`,
      `阈值配置: ${contactsLoadSession.timeoutMs}ms`,
      `当前状态: ${contactsLoadIssue.kind === 'timeout' ? '超时等待中' : '请求失败'}`,
      `累计耗时: ${(contactsIssueElapsedMs / 1000).toFixed(1)}s`,
      `发生时间: ${new Date(contactsLoadIssue.occurredAt).toLocaleString()}`,
      '阶段: chat.getContacts',
      `原因: ${contactsLoadIssue.reason}`,
      `错误详情: ${contactsLoadIssue.errorDetail || '无'}`
    ].join('\n')
  }, [contactsIssueElapsedMs, contactsLoadIssue, contactsLoadSession])

  const copyContactsDiagnostics = useCallback(async () => {
    if (!contactsDiagnosticsText) return
    try {
      await navigator.clipboard.writeText(contactsDiagnosticsText)
      alert('诊断信息已复制')
    } catch (error) {
      logger.error('复制诊断信息失败:', error)
      alert('复制失败，请手动复制诊断信息')
    }
  }, [contactsDiagnosticsText])

  const sessionContactsUpdatedAtLabel = useMemo(() => {
    if (!sessionContactsUpdatedAt) return ''
    return new Date(sessionContactsUpdatedAt).toLocaleString()
  }, [sessionContactsUpdatedAt])

  const sessionAvatarUpdatedAtLabel = useMemo(() => {
    if (!sessionAvatarUpdatedAt) return ''
    return new Date(sessionAvatarUpdatedAt).toLocaleString()
  }, [sessionAvatarUpdatedAt])

  const sessionAvatarCachedCount = useMemo(() => {
    return sessions.reduce((count, session) => (session.avatarUrl ? count + 1 : count), 0)
  }, [sessions])

  const visibleSelectableCount = useMemo(() => (
    filteredContacts.reduce((count, contact) => (
      sessionRowByUsername.get(contact.username)?.hasSession ? count + 1 : count
    ), 0)
  ), [filteredContacts, sessionRowByUsername])
  const isAllVisibleSelected = visibleSelectableCount > 0 && selectedCount === visibleSelectableCount

  const canCreateTask = exportDialog.scope === 'sns'
    ? Boolean(exportFolder)
    : Boolean(exportFolder) && exportDialog.sessionIds.length > 0
  const scopeLabel = exportDialog.scope === 'single'
    ? '单会话'
    : exportDialog.scope === 'multi'
      ? '多会话'
      : exportDialog.scope === 'sns'
        ? '朋友圈批量'
        : `按内容批量（${contentTypeLabels[exportDialog.contentType || 'text']}）`
  const scopeCountLabel = exportDialog.scope === 'sns'
    ? `共 ${snsStats.totalPosts} 条朋友圈动态`
    : `共 ${exportDialog.sessionIds.length} 个会话`
  const snsFormatOptions: Array<{ value: SnsTimelineExportFormat; label: string; desc: string }> = [
    { value: 'html', label: 'HTML', desc: '网页格式，可直接浏览' },
    { value: 'json', label: 'JSON', desc: '原始结构化格式（兼容旧导入）' },
    { value: 'arkmejson', label: 'ArkmeJSON', desc: '增强结构化格式，包含互动身份字段' }
  ]
  const formatCandidateOptions = exportDialog.scope === 'sns'
    ? snsFormatOptions
    : formatOptions
  const isSessionScopeDialog = exportDialog.scope === 'single' || exportDialog.scope === 'multi'
  const isContentScopeDialog = exportDialog.scope === 'content'
  const isContentTextDialog = isContentScopeDialog && exportDialog.contentType === 'text'
  const useCollapsedSessionFormatSelector = isSessionScopeDialog || isContentTextDialog
  const shouldShowFormatSection = !isContentScopeDialog || isContentTextDialog
  const shouldShowMediaSection = !isContentScopeDialog
  const avatarExportStatusLabel = options.exportAvatars ? '已开启聊天消息导出带头像' : '已关闭聊天消息导出带头像'
  const contentTextDialogSummary = '此模式只导出聊天文本，不包含图片语音视频表情包等多媒体文件。'
  const activeDialogFormatLabel = exportDialog.scope === 'sns'
    ? (snsFormatOptions.find(option => option.value === snsExportFormat)?.label ?? snsExportFormat)
    : (formatOptions.find(option => option.value === options.format)?.label ?? options.format)
  const shouldShowDisplayNameSection = !(
    exportDialog.scope === 'sns' ||
    (
      exportDialog.scope === 'content' &&
      (
        exportDialog.contentType === 'voice' ||
        exportDialog.contentType === 'image' ||
        exportDialog.contentType === 'video' ||
        exportDialog.contentType === 'emoji'
      )
    )
  )
  const isTabCountComputing = isSharedTabCountsLoading && !isSharedTabCountsReady
  const isSnsCardStatsLoading = !hasSeededSnsStats
  const taskRunningCount = tasks.filter(task => task.status === 'running').length
  const taskQueuedCount = tasks.filter(task => task.status === 'queued').length
  const taskCenterAlertCount = taskRunningCount + taskQueuedCount
  const hasFilteredContacts = filteredContacts.length > 0
  const sessionLoadDetailUpdatedAt = useMemo(() => {
    let latest = 0
    for (const row of sessionLoadDetailRows) {
      const candidateTimes = [
        row.messageCount.finishedAt || row.messageCount.startedAt || 0,
        row.mediaMetrics.finishedAt || row.mediaMetrics.startedAt || 0,
        row.snsPostCounts.finishedAt || row.snsPostCounts.startedAt || 0,
        row.mutualFriends.finishedAt || row.mutualFriends.startedAt || 0
      ]
      for (const candidate of candidateTimes) {
        if (candidate > latest) {
          latest = candidate
        }
      }
    }
    return latest
  }, [sessionLoadDetailRows])
  const isSessionLoadDetailActive = useMemo(() => (
    sessionLoadDetailRows.some(row => (
      row.messageCount.statusLabel.startsWith('加载中') ||
      row.mediaMetrics.statusLabel.startsWith('加载中') ||
      row.snsPostCounts.statusLabel.startsWith('加载中') ||
      row.mutualFriends.statusLabel.startsWith('加载中')
    ))
  ), [sessionLoadDetailRows])
  const closeTaskCenter = useCallback(() => {
    setIsTaskCenterOpen(false)
    setExpandedPerfTaskId(null)
  }, [])
  const toggleTaskPerfDetail = useCallback((taskId: string) => {
    setExpandedPerfTaskId(prev => (prev === taskId ? null : taskId))
  }, [])
  const renderContactRow = useCallback((_: number, contact: ContactInfo) => {
    const matchedSession = sessionRowByUsername.get(contact.username)
    const canExport = Boolean(matchedSession?.hasSession)
    const isSessionBindingPending = !matchedSession && (isLoading || isSessionEnriching)
    const checked = canExport && selectedSessions.has(contact.username)
    const isRunning = canExport && runningSessionIds.has(contact.username)
    const isQueued = canExport && queuedSessionIds.has(contact.username)
    const recentExportTimestamp = lastExportBySession[contact.username]
    const hasRecentExport = canExport && Boolean(recentExportTimestamp)
    const recentExportTime = hasRecentExport ? formatRecentTimestamp(recentExportTimestamp, nowTick) : ''
    const countedMessages = normalizeMessageCount(sessionMessageCounts[contact.username])
    const hintedMessages = normalizeMessageCount(matchedSession?.messageCountHint)
    const displayedMessageCount = countedMessages ?? hintedMessages
    const mediaMetric = sessionContentMetrics[contact.username]
    const messageCountState: ExportContactMetricState =
      !canExport
        ? (isSessionBindingPending ? { state: 'loading' } : { state: 'na', text: '--' })
        : typeof displayedMessageCount === 'number'
          ? { state: 'value', text: displayedMessageCount.toLocaleString('zh-CN') }
          : { state: 'loading' }
    const metricToDisplay = (value: unknown): ExportContactMetricState => {
      const normalized = normalizeMessageCount(value)
      if (!canExport) {
        return isSessionBindingPending ? { state: 'loading' } : { state: 'na', text: '--' }
      }
      if (typeof normalized === 'number') {
        return { state: 'value', text: normalized.toLocaleString('zh-CN') }
      }
      return { state: 'loading' }
    }
    const emojiMetric = metricToDisplay(mediaMetric?.emojiMessages)
    const voiceMetric = metricToDisplay(mediaMetric?.voiceMessages)
    const imageMetric = metricToDisplay(mediaMetric?.imageMessages)
    const videoMetric = metricToDisplay(mediaMetric?.videoMessages)
    const supportsSnsTimeline = isSingleContactSession(contact.username)
    const hasSnsCount = Object.prototype.hasOwnProperty.call(snsUserPostCounts, contact.username)
    const snsStageStatus = sessionLoadTraceMap[contact.username]?.snsPostCounts?.status
    const isSnsCountLoading = (
      supportsSnsTimeline &&
      !hasSnsCount &&
      (
        snsStageStatus === 'pending' ||
        snsStageStatus === 'loading' ||
        snsUserPostCountsStatus === 'loading' ||
        snsUserPostCountsStatus === 'idle'
      )
    )
    const snsRawCount = Number(snsUserPostCounts[contact.username] || 0)
    const snsCount = Number.isFinite(snsRawCount) ? Math.max(0, Math.floor(snsRawCount)) : 0
    const mutualFriendsMetric = sessionMutualFriendsMetrics[contact.username]
    const hasMutualFriendsMetric = Boolean(mutualFriendsMetric)
    const mutualFriendsStageStatus = sessionLoadTraceMap[contact.username]?.mutualFriends?.status
    const isMutualFriendsLoading = (
      supportsSnsTimeline &&
      canExport &&
      !hasMutualFriendsMetric &&
      (
        mutualFriendsStageStatus === 'pending' ||
        mutualFriendsStageStatus === 'loading'
      )
    )
    const openChatLabel = contact.type === 'friend'
      ? '打开私聊'
      : contact.type === 'group'
        ? '打开群聊'
        : '打开对话'

    return (
      <ExportContactRow
        contact={contact}
        checked={checked}
        canExport={canExport}
        isRunning={isRunning}
        isQueued={isQueued}
        hasRecentExport={hasRecentExport}
        recentExportTime={recentExportTime}
        messageCountState={messageCountState}
        emojiMetric={emojiMetric}
        voiceMetric={voiceMetric}
        imageMetric={imageMetric}
        videoMetric={videoMetric}
        shouldShowSnsColumn={shouldShowSnsColumn}
        shouldShowMutualFriendsColumn={shouldShowMutualFriendsColumn}
        supportsSnsTimeline={supportsSnsTimeline}
        isSnsCountLoading={isSnsCountLoading}
        hasSnsCount={hasSnsCount}
        snsCount={snsCount}
        isMutualFriendsLoading={isMutualFriendsLoading}
        hasMutualFriendsMetric={hasMutualFriendsMetric}
        mutualFriendsCount={mutualFriendsMetric?.count || 0}
        detailActive={showSessionDetailPanel && sessionDetail?.wxid === contact.username}
        openChatLabel={openChatLabel}
        onToggleSelect={() => toggleSelectSession(contact.username)}
        onOpenChat={() => {
          void windowControl.openSessionChatWindow(contact.username, {
            source: 'export',
            initialDisplayName: contact.displayName || contact.username,
            initialAvatarUrl: contact.avatarUrl,
            initialContactType: contact.type
          })
        }}
        onOpenSns={() => openContactSnsTimeline(contact)}
        onOpenMutualFriends={() => openSessionMutualFriendsDialog(contact)}
        onOpenSingleExport={() => {
          if (!matchedSession || !matchedSession.hasSession) return
          openSingleExport({
            ...matchedSession,
            displayName: contact.displayName || matchedSession.displayName || matchedSession.username
          })
        }}
        onOpenSessionDetail={() => openSessionDetail(contact.username)}
      />
    )
  }, [
    lastExportBySession,
    nowTick,
    openContactSnsTimeline,
    openSessionDetail,
    openSessionMutualFriendsDialog,
    openSingleExport,
    queuedSessionIds,
    runningSessionIds,
    selectedSessions,
    sessionDetail?.wxid,
    sessionContentMetrics,
    sessionMutualFriendsMetrics,
    sessionLoadTraceMap,
    sessionMessageCounts,
    sessionRowByUsername,
    isLoading,
    isSessionEnriching,
    showSessionDetailPanel,
    shouldShowMutualFriendsColumn,
    shouldShowSnsColumn,
    snsUserPostCounts,
    snsUserPostCountsStatus,
    toggleSelectSession
  ])
  const handleContactsListWheelCapture = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const deltaY = event.deltaY
    if (!deltaY) return
    const sectionTop = sessionTableSectionRef.current?.getBoundingClientRect().top ?? 0
    const sectionPinned = sectionTop <= 8

    if (deltaY > 0 && !sectionPinned) {
      event.preventDefault()
      window.scrollBy({ top: deltaY, behavior: 'auto' })
      return
    }

    if (deltaY < 0 && isContactsListAtTop) {
      event.preventDefault()
      window.scrollBy({ top: deltaY, behavior: 'auto' })
    }
  }, [isContactsListAtTop])
  useEffect(() => {
    if (hasFilteredContacts) return
    setIsContactsListAtTop(true)
  }, [hasFilteredContacts])
  const chooseExportFolder = useCallback(async () => {
    const result = await dialog.openFile({
      title: '选择导出目录',
      properties: ['openDirectory']
    })
    if (!result.canceled && result.filePaths.length > 0) {
      const nextPath = result.filePaths[0]
      setExportFolder(nextPath)
      await configService.setExportPath(nextPath)
    }
  }, [])

  const handleExportDefaultsChanged = useCallback((patch: ExportDefaultsSettingsPatch) => {
    if (patch.format) {
      setExportDefaultFormat(patch.format as TextExportFormat)
    }
    if (typeof patch.avatars === 'boolean') {
      setExportDefaultAvatars(patch.avatars)
      setOptions(prev => ({ ...prev, exportAvatars: patch.avatars! }))
    }
    if (patch.dateRange) {
      setExportDefaultDateRangeSelection(patch.dateRange)
    }
    if (patch.media) {
      const mediaPatch = patch.media
      setExportDefaultMedia(mediaPatch)
      setOptions(prev => ({
        ...prev,
        exportMedia: Boolean(mediaPatch.images || mediaPatch.voices || mediaPatch.videos || mediaPatch.emojis),
        exportImages: mediaPatch.images,
        exportVoices: mediaPatch.voices,
        exportVideos: mediaPatch.videos,
        exportEmojis: mediaPatch.emojis
      }))
    }
    if (typeof patch.voiceAsText === 'boolean') {
      setExportDefaultVoiceAsText(patch.voiceAsText)
    }
    if (typeof patch.excelCompactColumns === 'boolean') {
      setExportDefaultExcelCompactColumns(patch.excelCompactColumns)
    }
    if (typeof patch.concurrency === 'number') {
      setExportDefaultConcurrency(patch.concurrency)
    }
  }, [])

  return (
    <div className="export-board-page">
      <div className="export-top-panel">
        <div className="export-top-bar">
          <div className="global-export-controls">
            <div className="path-control">
              <span className="control-label">导出位置</span>
              <div className="path-inline-row">
                <div className="path-value">
                  <button
                    className="path-link"
                    type="button"
                    title={exportFolder}
                    onClick={() => void chooseExportFolder()}
                  >
                    {exportFolder || '未设置'}
                  </button>
                  <button className="path-change-btn" type="button" onClick={() => void chooseExportFolder()}>
                    更换
                  </button>
                </div>
                <button className="secondary-btn" onClick={() => exportFolder && void shell.openPath(exportFolder)}>
                  <ExternalLink size={14} /> 打开
                </button>
              </div>
            </div>

            <WriteLayoutSelector
              writeLayout={writeLayout}
              onChange={async (value) => {
                setWriteLayout(value)
                await configService.setExportWriteLayout(value)
              }}
              sessionNameWithTypePrefix={sessionNameWithTypePrefix}
              onSessionNameWithTypePrefixChange={async (enabled) => {
                setSessionNameWithTypePrefix(enabled)
                await configService.setExportSessionNamePrefixEnabled(enabled)
              }}
            />

            <div className="more-export-settings-control">
              <button
                className="more-export-settings-btn"
                type="button"
                onClick={() => setIsExportDefaultsModalOpen(true)}
              >
                更多导出设置
              </button>
            </div>
          </div>

          <button
            className={`task-center-card ${taskCenterAlertCount > 0 ? 'has-alert' : ''}`}
            type="button"
            onClick={() => setIsTaskCenterOpen(true)}
          >
            <span className="task-center-card-label">任务中心</span>
            {taskCenterAlertCount > 0 && (
              <span className="task-center-card-badge">{taskCenterAlertCount}</span>
            )}
          </button>
        </div>
      </div>

      <TaskCenterModal
        isOpen={isTaskCenterOpen}
        tasks={tasks}
        taskRunningCount={taskRunningCount}
        taskQueuedCount={taskQueuedCount}
        expandedPerfTaskId={expandedPerfTaskId}
        nowTick={nowTick}
        onClose={closeTaskCenter}
        onTogglePerfTask={toggleTaskPerfDetail}
      />

      {isExportDefaultsModalOpen && (
        <div
          className="export-defaults-modal-overlay"
          onClick={() => setIsExportDefaultsModalOpen(false)}
        >
          <div
            className="export-defaults-modal"
            role="dialog"
            aria-modal="true"
            aria-label="更多导出设置"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="export-defaults-modal-header">
              <div>
                <h3>更多导出设置</h3>
              </div>
              <button
                className="close-icon-btn"
                type="button"
                onClick={() => setIsExportDefaultsModalOpen(false)}
                aria-label="关闭更多导出设置"
              >
                <X size={16} />
              </button>
            </div>
            <div className="export-defaults-modal-body">
              <ExportDefaultsSettingsForm layout="split" onDefaultsChanged={handleExportDefaultsChanged} />
            </div>
            <div className="export-defaults-modal-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setIsExportDefaultsModalOpen(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="export-section-title-row">
        <h3 className="export-section-title">按类型批量导出</h3>
        <SectionInfoTooltip
          label="按类型批量导出"
          heading="按类型批量导出说明"
          messages={[
            '按数据类型统一导出，适合横向汇总同类内容，比如集中导出图片、语音或视频。',
            '发起前可先设置导出时间范围和格式，能减少无关数据，导出结果更聚焦。',
            '每个类型卡片中展示到已导出会话数，统计范围会涵盖下方按会话导出。'
          ]}
        />
      </div>
      <div className="content-card-grid">
        {contentCards.map(card => {
          const Icon = card.icon
          const isCardStatsLoading = card.type === 'sns'
            ? isSnsCardStatsLoading
            : false
          const isCardRunning = runningCardTypes.has(card.type)
          const isPrimaryCard = card.type === 'text'
          return (
            <div key={card.type} className="content-card">
              <div className="card-header">
                <div className="card-title"><Icon size={16} /> {card.label}</div>
                {card.type === 'sns' && (
                  <div className="card-title-meta">
                    {isCardStatsLoading ? (
                      <span className="count-loading">
                        统计中<span className="animated-ellipsis" aria-hidden="true">...</span>
                      </span>
                    ) : `${card.headerCount.toLocaleString()} 条`}
                  </div>
                )}
              </div>
              <div className="card-stats">
                {card.stats.map((stat) => (
                  <div key={stat.label} className="stat-item">
                    <span>{stat.label}</span>
                    <strong>
                      {isCardStatsLoading ? (
                        <span className="count-loading">
                          统计中<span className="animated-ellipsis" aria-hidden="true">...</span>
                        </span>
                      ) : `${stat.value.toLocaleString()} ${stat.unit}`}
                    </strong>
                  </div>
                ))}
              </div>
              <button
                className={`card-export-btn ${isPrimaryCard ? 'primary' : 'secondary'} ${isCardRunning ? 'running' : ''}`}
                disabled={isCardRunning}
                onClick={() => {
                  if (card.type === 'sns') {
                    openSnsExport()
                    return
                  }
                  openContentExport(card.type)
                }}
              >
                {isCardRunning ? (
                  <>
                    <span>批量导出中</span>
                    <Loader2 size={14} className="spin" />
                  </>
                ) : '批量导出'}
              </button>
            </div>
          )
        })}
      </div>

      <div className="export-section-title-row">
        <h3 className="export-section-title">按会话导出</h3>
        <SectionInfoTooltip
          label="按会话导出"
          heading="按会话导出说明"
          messages={[
            '按会话维度导出完整上下文，适合按客户、项目或群组进行归档。',
            '你可以先在列表中筛选目标会话，再批量导出，结果会保留每个会话的结构与时间线。'
          ]}
        />
        <button
          className={`session-load-detail-entry ${isSessionLoadDetailActive ? 'active' : ''}`}
          type="button"
          onClick={() => setShowSessionLoadDetailModal(true)}
        >
          <span className="session-load-detail-entry-icon" aria-hidden="true">
            <span className="session-load-detail-entry-bar" />
            <span className="session-load-detail-entry-bar" />
            <span className="session-load-detail-entry-bar" />
          </span>
          <span>数据加载详情</span>
        </button>
      </div>
      <div className="session-table-section" ref={sessionTableSectionRef}>
        <div className="session-table-layout">
          <div className="table-wrap">
            <div className="session-table-sticky">
              <div className="table-toolbar">
                <div className="table-tabs" role="tablist" aria-label="会话类型">
                  <button className={`tab-btn ${activeTab === 'private' ? 'active' : ''}`} onClick={() => setActiveTab('private')}>
                    私聊 {isTabCountComputing ? <span className="count-loading">计算中<span className="animated-ellipsis" aria-hidden="true">...</span></span> : tabCounts.private}
                  </button>
                  <button className={`tab-btn ${activeTab === 'group' ? 'active' : ''}`} onClick={() => setActiveTab('group')}>
                    群聊 {isTabCountComputing ? <span className="count-loading">计算中<span className="animated-ellipsis" aria-hidden="true">...</span></span> : tabCounts.group}
                  </button>
                  <button className={`tab-btn ${activeTab === 'former_friend' ? 'active' : ''}`} onClick={() => setActiveTab('former_friend')}>
                    曾经的好友 {isTabCountComputing ? <span className="count-loading">计算中<span className="animated-ellipsis" aria-hidden="true">...</span></span> : tabCounts.former_friend}
                  </button>
                </div>

                <div className="toolbar-actions">
                  <div className="search-input-wrap">
                    <Search size={14} />
                    <input
                      value={searchKeyword}
                      onChange={(event) => setSearchKeyword(event.target.value)}
                      placeholder={`搜索${activeTabLabel}联系人...`}
                    />
                    {searchKeyword && (
                      <button className="clear-search" onClick={() => setSearchKeyword('')}>
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <button className="secondary-btn" onClick={() => void loadContactsList()} disabled={isContactsListLoading}>
                    <RefreshCw size={14} className={isContactsListLoading ? 'spin' : ''} />
                    刷新
                  </button>
                </div>
              </div>

              {contactsList.length > 0 && isContactsListLoading && (
                <div className="table-stage-hint">
                  <Loader2 size={14} className="spin" />
                  联系人列表同步中…
                </div>
              )}

              {hasFilteredContacts && (
                <div className="contacts-list-header">
                  <span className="contacts-list-header-select">
                    <button
                      className={`select-icon-btn ${isAllVisibleSelected ? 'checked' : ''}`}
                      type="button"
                      onClick={toggleSelectAllVisible}
                      disabled={visibleSelectableCount === 0}
                      title={isAllVisibleSelected ? '取消全选当前筛选联系人' : '全选当前筛选联系人'}
                    >
                      {isAllVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                  </span>
                  <span className="contacts-list-header-main">
                    <span className="contacts-list-header-main-label">{contactsHeaderMainLabel}</span>
                  </span>
                  <span className="contacts-list-header-count">总消息数</span>
                  <span className="contacts-list-header-media">表情包</span>
                  <span className="contacts-list-header-media">语音</span>
                  <span className="contacts-list-header-media">图片</span>
                  <span className="contacts-list-header-media">视频</span>
                  {shouldShowSnsColumn && (
                    <span className="contacts-list-header-media">朋友圈</span>
                  )}
                  {shouldShowMutualFriendsColumn && (
                    <span className="contacts-list-header-media">共同好友</span>
                  )}
                  <span className="contacts-list-header-actions">
                    {selectedCount > 0 && (
                      <>
                        <button
                          className="selection-clear-btn"
                          type="button"
                          onClick={clearSelection}
                        >
                          清空
                        </button>
                        <button
                          className="selection-export-btn"
                          type="button"
                          onClick={openBatchExport}
                        >
                          <span>批量导出</span>
                          <span className="selection-export-count">{selectedCount}</span>
                        </button>
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>

            {contactsList.length === 0 && contactsLoadIssue ? (
              <div className="load-issue-state">
                <div className="issue-card">
                  <div className="issue-title">
                    <AlertTriangle size={18} />
                    <span>{contactsLoadIssue.title}</span>
                  </div>
                  <p className="issue-message">{contactsLoadIssue.message}</p>
                  <p className="issue-reason">{contactsLoadIssue.reason}</p>
                  <ul className="issue-hints">
                    <li>可能原因1：数据库当前仍在执行高开销查询（例如导出页后台统计）。</li>
                    <li>可能原因2：contact.db 数据量较大，首次查询时间过长。</li>
                    <li>可能原因3：数据库连接状态异常或 IPC 调用卡住。</li>
                  </ul>
                  <div className="issue-actions">
                    <button className="issue-btn primary" onClick={() => void loadContactsList()}>
                      <RefreshCw size={14} />
                      <span>重试加载</span>
                    </button>
                    <button className="issue-btn" onClick={() => setShowContactsDiagnostics(prev => !prev)}>
                      <ClipboardList size={14} />
                      <span>{showContactsDiagnostics ? '收起诊断详情' : '查看诊断详情'}</span>
                    </button>
                    <button className="issue-btn" onClick={copyContactsDiagnostics}>
                      <span>复制诊断信息</span>
                    </button>
                  </div>
                  {showContactsDiagnostics && (
                    <pre className="issue-diagnostics">{contactsDiagnosticsText}</pre>
                  )}
                </div>
              </div>
            ) : isContactsListLoading && contactsList.length === 0 ? (
              <div className="loading-state">
                <Loader2 size={32} className="spin" />
                <span>联系人加载中...</span>
              </div>
            ) : !hasFilteredContacts ? (
              <div className="empty-state">
                <span>暂无联系人</span>
              </div>
            ) : (
              <div
                className="contacts-list"
                onWheelCapture={handleContactsListWheelCapture}
              >
                <Virtuoso
                  ref={contactsVirtuosoRef}
                  className="contacts-virtuoso"
                  data={filteredContacts}
                  computeItemKey={(_, contact) => contact.username}
                  itemContent={renderContactRow}
                  rangeChanged={handleContactsRangeChanged}
                  atTopStateChange={setIsContactsListAtTop}
                  overscan={420}
                />
              </div>
            )}
          </div>

          <SessionLoadDetailModal
            open={showSessionLoadDetailModal}
            updatedAt={sessionLoadDetailUpdatedAt}
            rows={sessionLoadDetailRows}
            pulseMap={sessionLoadProgressPulseMap}
            formatLoadDetailTime={formatLoadDetailTime}
            formatLoadDetailPulseTime={formatLoadDetailPulseTime}
            onClose={() => setShowSessionLoadDetailModal(false)}
          />

          <SessionMutualFriendsDialog
            target={sessionMutualFriendsDialogTarget}
            metric={sessionMutualFriendsDialogMetric}
            search={sessionMutualFriendsSearch}
            filteredItems={filteredSessionMutualFriendsDialogItems}
            onSearchChange={setSessionMutualFriendsSearch}
            onClose={closeSessionMutualFriendsDialog}
            formatYmdDateFromSeconds={formatYmdDateFromSeconds}
            getDirectionLabel={getSessionMutualFriendDirectionLabel}
            describeRelation={describeSessionMutualFriendRelation}
          />

          <SessionDetailPanel
            open={showSessionDetailPanel}
            sessionDetail={sessionDetail}
            isLoadingSessionDetail={isLoadingSessionDetail}
            isLoadingSessionDetailExtra={isLoadingSessionDetailExtra}
            isRefreshingSessionDetailStats={isRefreshingSessionDetailStats}
            isLoadingSessionRelationStats={isLoadingSessionRelationStats}
            copiedDetailField={copiedDetailField}
            currentSessionExportRecords={currentSessionExportRecords}
            sessionDetailSupportsSnsTimeline={sessionDetailSupportsSnsTimeline}
            sessionDetailSnsCountLabel={sessionDetailSnsCountLabel}
            onClose={closeSessionDetailPanel}
            onCopyDetailField={handleCopyDetailField}
            onOpenSessionSnsTimeline={openSessionSnsTimeline}
            onOpenPath={(targetPath: string) => { void shell.openPath(targetPath) }}
            onLoadSessionRelationStats={() => { void loadSessionRelationStats() }}
            formatPathBrief={formatPathBrief}
            formatYmdHmDateTime={formatYmdHmDateTime}
            formatYmdDateFromSeconds={formatYmdDateFromSeconds}
          />

          <ContactSnsTimelineDialog
            target={sessionSnsTimelineTarget}
            onClose={closeSessionSnsTimeline}
            initialTotalPosts={sessionSnsTimelineInitialTotalPosts}
            initialTotalPostsLoading={sessionSnsTimelineInitialTotalPostsLoading}
          />
        </div>
      </div>

      <ExportTaskDialog
        dialog={exportDialog}
        canCreateTask={canCreateTask}
        scopeLabel={scopeLabel}
        scopeCountLabel={scopeCountLabel}
        avatarExportStatusLabel={avatarExportStatusLabel}
        activeDialogFormatLabel={activeDialogFormatLabel}
        contentTextDialogSummary={contentTextDialogSummary}
        timeRangeSummaryLabel={timeRangeSummaryLabel}
        isTimeRangeDialogOpen={isTimeRangeDialogOpen}
        timeRangeSelection={timeRangeSelection}
        formatCandidateOptions={formatCandidateOptions}
        displayNameOptions={displayNameOptions}
        isSessionScopeDialog={isSessionScopeDialog}
        isContentScopeDialog={isContentScopeDialog}
        isContentTextDialog={isContentTextDialog}
        useCollapsedSessionFormatSelector={useCollapsedSessionFormatSelector}
        shouldShowFormatSection={shouldShowFormatSection}
        shouldShowMediaSection={shouldShowMediaSection}
        shouldShowDisplayNameSection={shouldShowDisplayNameSection}
        textOptions={{
          format: options.format,
          exportImages: options.exportImages,
          exportVoices: options.exportVoices,
          exportVideos: options.exportVideos,
          exportEmojis: options.exportEmojis,
          exportVoiceAsText: options.exportVoiceAsText,
          displayNamePreference: options.displayNamePreference
        }}
        snsOptions={{
          format: snsExportFormat,
          exportImages: snsExportImages,
          exportLivePhotos: snsExportLivePhotos,
          exportVideos: snsExportVideos
        }}
        onClose={closeExportDialog}
        onCreateTask={() => void createTask()}
        onOpenTimeRangeDialog={openTimeRangeDialog}
        onCloseTimeRangeDialog={closeTimeRangeDialog}
        onConfirmTimeRange={(nextSelection) => {
          setTimeRangeSelection(nextSelection)
          setOptions(prev => ({
            ...prev,
            useAllTime: nextSelection.useAllTime,
            dateRange: cloneExportDateRange(nextSelection.dateRange)
          }))
          closeTimeRangeDialog()
        }}
        onTextFormatChange={(value) => setOptions(prev => ({ ...prev, format: value as TextExportFormat }))}
        onSnsFormatChange={setSnsExportFormat}
        onTextMediaToggle={(key, checked) => setOptions(prev => ({ ...prev, [key]: checked }))}
        onSnsMediaToggle={(key, checked) => {
          if (key === 'exportImages') setSnsExportImages(checked)
          else if (key === 'exportLivePhotos') setSnsExportLivePhotos(checked)
          else setSnsExportVideos(checked)
        }}
        onToggleVoiceAsText={() => setOptions(prev => ({ ...prev, exportVoiceAsText: !prev.exportVoiceAsText }))}
        onDisplayNamePreferenceChange={(value) => setOptions(prev => ({ ...prev, displayNamePreference: value }))}
      />
    </div>
  )
}

export default ExportPage
