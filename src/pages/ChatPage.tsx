import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, MessageSquare, AlertCircle, Loader2, RefreshCw, X, ChevronDown, ChevronLeft, Info, Calendar, Database, Hash, Image as ImageIcon, Link, CheckCircle, Copy, Download, BarChart3, Users, UserCheck, Crown, Aperture, Mic } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useChatStore } from '../stores/chatStore'
import { useBatchTranscribeStore } from '../stores/batchTranscribeStore'
import { useBatchImageDecryptStore } from '../stores/batchImageDecryptStore'
import { usePlatformStore } from '../stores/platformStore'
import type { ChatSession, Message } from '../types/models'
import { GROUP_MEMBERS_PANEL_CACHE_TTL_MS } from './chat/chatPageTypes'
import type { ChatPageProps, GroupMembersPanelCacheEntry, GroupMessageCountStatus, GroupPanelMember, LoadMessagesOptions, SessionDetail, SessionExportCacheMeta, SessionExportMetric, StandaloneLoadStage } from './chat/chatPageTypes'
import JumpToDatePopover from '../components/JumpToDatePopover'
import { ContactSnsTimelineDialog } from '../components/Sns/ContactSnsTimelineDialog'
import AppMessageBubble from '../components/chat/AppMessageBubble'
import { renderAppMessageRichPreview } from '../components/chat/renderAppMessageRichPreview'
import BatchDateActionModal from '../components/chat/BatchDateActionModal'
import MessageInfoModal from '../components/chat/MessageInfoModal'
import ChatContextMenu from '../components/chat/ChatContextMenu'
import GroupMembersPanel from '../components/chat/GroupMembersPanel'
import SessionDetailPanel from '../components/chat/SessionDetailPanel'
import MessageSelectionCheckbox from '../components/chat/MessageSelectionCheckbox'
import MessageImageContent from '../components/chat/MessageImageContent'
import MessageVideoContent from '../components/chat/MessageVideoContent'
import MessageVoiceContent from '../components/chat/MessageVoiceContent'
import { VoiceTranscribeDialog } from '../components/VoiceTranscribeDialog'
import { formatMessageBubbleTime, MessageFallbackContent } from '../components/chat/messageBubbleText'
import { ChatSessionItem as SessionItem } from '../components/chat/ChatSessionItem'
import { type ContactSnsTimelineTarget, getAvatarLetter, isSingleContactSession } from '../components/Sns/contactSnsTimeline'
import * as configService from '../services/config'
import { chat, electronApi, groupAnalytics, image, shell, video, windowControl } from '../services/ipc'
import {
  emitOpenSingleExport,
  onExportSessionStatus,
  onSingleExportDialogStatus,
  requestExportSessionStatus
} from '../services/exportBridge'
import './ChatPage.scss'
import { buildAccountScope } from '../utils/accountScope'
import { formatFileSize, formatYmdDateFromSeconds, formatYmdHmDateTime } from '../utils/formatters'
import { toSafeMediaUrl } from '../utils/mediaUrl'
import { createLogger } from '../utils/logger'
import { avatarLoadQueue } from '../utils/AvatarLoadQueue'
import { Avatar } from '../components/Avatar'
import { AvatarImage } from '../components/AvatarImage'
import {
  CHAT_SESSION_LIST_CACHE_TTL_MS,
  CHAT_SESSION_PREVIEW_CACHE_TTL_MS,
  readSessionListCache,
  readSessionPreviewCache,
  restoreSessionWindowCacheEntry,
  saveSessionWindowCacheEntry,
  type SessionPreviewCacheEntry,
  type SessionWindowCacheEntry,
  upsertSessionPreviewEntries,
  writeSessionListCache,
  writeSessionPreviewCache
} from '../utils/chatSessionCache'

// 系统消息类型常量
const SHOULD_LOG_CHAT_DEBUG = import.meta.env.DEV
const logger = createLogger('ChatPage')

const SYSTEM_MESSAGE_TYPES = [
  10000,        // 系统消息
  266287972401, // 拍一拍
]

interface BatchImageDecryptCandidate {
  imageMd5?: string
  imageDatName?: string
  createTime?: number
}

// 判断是否为系统消息
function isSystemMessage(localType: number): boolean {
  return SYSTEM_MESSAGE_TYPES.includes(localType)
}




function ChatPage(props: ChatPageProps) {
  const {
    standaloneSessionWindow = false,
    initialSessionId = null,
    standaloneSource = null,
    standaloneInitialDisplayName = null,
    standaloneInitialAvatarUrl = null,
    standaloneInitialContactType = null
  } = props
  const normalizedInitialSessionId = useMemo(() => String(initialSessionId || '').trim(), [initialSessionId])
  const normalizedStandaloneSource = useMemo(() => String(standaloneSource || '').trim().toLowerCase(), [standaloneSource])
  const normalizedStandaloneInitialDisplayName = useMemo(() => String(standaloneInitialDisplayName || '').trim(), [standaloneInitialDisplayName])
  const normalizedStandaloneInitialAvatarUrl = useMemo(() => String(standaloneInitialAvatarUrl || '').trim(), [standaloneInitialAvatarUrl])
  const normalizedStandaloneInitialContactType = useMemo(() => String(standaloneInitialContactType || '').trim().toLowerCase(), [standaloneInitialContactType])
  const shouldHideStandaloneDetailButton = standaloneSessionWindow && normalizedStandaloneSource === 'export'
  const navigate = useNavigate()
  const capabilities = usePlatformStore((state) => state.capabilities)

  const {
    isConnected,
    isConnecting,
    connectionError,
    sessions,
    filteredSessions,
    currentSessionId,
    isLoadingSessions,
    localUnreadBaselines,
    messages,
    isLoadingMessages,
    isLoadingMore,
    hasMoreMessages,
    searchKeyword,
    setConnected,
    setConnecting,
    setConnectionError,
    setSessions,
    setFilteredSessions,
    clearLocalUnread,
    setCurrentSession,
    setLoadingSessions,
    setMessages,
    appendMessages,
    setLoadingMessages,
    setLoadingMore,
    setHasMoreMessages,
    hasMoreLater,
    setHasMoreLater,
    setSearchKeyword
  } = useChatStore()

  const messageListRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const getMessageKey = useCallback((msg: Message): string => {
    if (msg.localId && msg.localId > 0) return `l:${msg.localId}`
    return `t:${msg.createTime}:${msg.sortSeq || 0}:${msg.serverId || 0}`
  }, [])
  const initialRevealTimerRef = useRef<number | null>(null)
  const sessionListRef = useRef<HTMLDivElement>(null)
  const jumpCalendarWrapRef = useRef<HTMLDivElement>(null)
  const jumpPopoverPortalRef = useRef<HTMLDivElement>(null)
  const [currentOffset, setCurrentOffset] = useState(0)
  const [jumpStartTime, setJumpStartTime] = useState(0)
  const [jumpEndTime, setJumpEndTime] = useState(0)
  const [showJumpPopover, setShowJumpPopover] = useState(false)
  const [jumpPopoverDate, setJumpPopoverDate] = useState<Date>(new Date())
  const [jumpPopoverPosition, setJumpPopoverPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const isDateJumpRef = useRef(false)
  const [messageDates, setMessageDates] = useState<Set<string>>(new Set())
  const [hasLoadedMessageDates, setHasLoadedMessageDates] = useState(false)
  const [loadingDates, setLoadingDates] = useState(false)
  const messageDatesCache = useRef<Map<string, Set<string>>>(new Map())
  const [messageDateCounts, setMessageDateCounts] = useState<Record<string, number>>({})
  const [loadingDateCounts, setLoadingDateCounts] = useState(false)
  const messageDateCountsCache = useRef<Map<string, Record<string, number>>>(new Map())
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | undefined>(undefined)
  const [myWxid, setMyWxid] = useState<string | undefined>(undefined)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [isResizing, setIsResizing] = useState(false)
  const [showDetailPanel, setShowDetailPanel] = useState(false)
  const [showGroupMembersPanel, setShowGroupMembersPanel] = useState(false)
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [isLoadingDetailExtra, setIsLoadingDetailExtra] = useState(false)
  const [isRefreshingDetailStats, setIsRefreshingDetailStats] = useState(false)
  const [isLoadingRelationStats, setIsLoadingRelationStats] = useState(false)
  const [groupPanelMembers, setGroupPanelMembers] = useState<GroupPanelMember[]>([])
  const [isLoadingGroupMembers, setIsLoadingGroupMembers] = useState(false)
  const [groupMembersError, setGroupMembersError] = useState<string | null>(null)
  const [groupMembersLoadingHint, setGroupMembersLoadingHint] = useState('')
  const [isRefreshingGroupMembers, setIsRefreshingGroupMembers] = useState(false)
  const [groupMemberSearchKeyword, setGroupMemberSearchKeyword] = useState('')
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [highlightedMessageKeys, setHighlightedMessageKeys] = useState<string[]>([])
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(false)
  const [foldedView, setFoldedView] = useState(false) // 是否在"折叠的群聊"视图
  const [hasInitialMessages, setHasInitialMessages] = useState(false)
  const [isSessionSwitching, setIsSessionSwitching] = useState(false)
  const [noMessageTable, setNoMessageTable] = useState(false)
  const [fallbackDisplayName, setFallbackDisplayName] = useState<string | null>(normalizedStandaloneInitialDisplayName || null)
  const [fallbackAvatarUrl, setFallbackAvatarUrl] = useState<string | null>(normalizedStandaloneInitialAvatarUrl || null)
  const [standaloneLoadStage, setStandaloneLoadStage] = useState<StandaloneLoadStage>(
    standaloneSessionWindow && normalizedInitialSessionId ? 'connecting' : 'idle'
  )
  const [standaloneInitialLoadRequested, setStandaloneInitialLoadRequested] = useState(false)
  const [inProgressExportSessionIds, setInProgressExportSessionIds] = useState<Set<string>>(new Set())
  const [isPreparingExportDialog, setIsPreparingExportDialog] = useState(false)
  const [chatSnsTimelineTarget, setChatSnsTimelineTarget] = useState<ContactSnsTimelineTarget | null>(null)
  const [exportPrepareHint, setExportPrepareHint] = useState('')
  const [autoTranscribeVoice, setAutoTranscribeVoice] = useState(false)
  const [showVoiceTranscribeDialog, setShowVoiceTranscribeDialog] = useState(false)
  const pendingVoiceTranscribeRef = useRef<null | (() => void)>(null)

  // 消息右键菜单
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, message: Message } | null>(null)
  const [showMessageInfo, setShowMessageInfo] = useState<Message | null>(null)

  // 多选模式
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set())

  // 批量图片解密相关状态（进度/结果 由全局 store 管理）
  const { isBatchDecrypting, progress: batchDecryptProgress, startDecrypt, updateProgress: updateDecryptProgress, finishDecrypt, setShowToast: setShowBatchDecryptToast } = useBatchImageDecryptStore()
  const { isBatchTranscribing, progress: batchTranscribeProgress, startTranscribe, updateProgress: updateTranscribeProgress, finishTranscribe, setShowToast: setShowBatchTranscribeToast } = useBatchTranscribeStore()
  const [showBatchDecryptConfirm, setShowBatchDecryptConfirm] = useState(false)
  const [batchImageDateCounts, setBatchImageDateCounts] = useState<Record<string, number>>({})
  const [batchImageDates, setBatchImageDates] = useState<string[]>([])
  const [batchImageSelectedDates, setBatchImageSelectedDates] = useState<Set<string>>(new Set())
  const [batchDecryptConcurrency, setBatchDecryptConcurrency] = useState(6)
  const [showConcurrencyDropdown, setShowConcurrencyDropdown] = useState(false)

  // 联系人信息加载控制
  const isEnrichingRef = useRef(false)
  const enrichCancelledRef = useRef(false)
  const isScrollingRef = useRef(false)
  const sessionScrollTimeoutRef = useRef<number | null>(null)


  const highlightedMessageSet = useMemo(() => new Set(highlightedMessageKeys), [highlightedMessageKeys])
  const messageKeySetRef = useRef<Set<string>>(new Set())
  const lastMessageTimeRef = useRef(0)
  const sessionMapRef = useRef<Map<string, ChatSession>>(new Map())
  const sessionsRef = useRef<ChatSession[]>([])
  const currentSessionRef = useRef<string | null>(null)
  const pendingSessionLoadRef = useRef<string | null>(null)
  const sessionSwitchRequestSeqRef = useRef(0)
  const initialLoadRequestedSessionRef = useRef<string | null>(null)
  const prevSessionRef = useRef<string | null>(null)
  const isLoadingMessagesRef = useRef(false)
  const isLoadingMoreRef = useRef(false)
  const isConnectedRef = useRef(false)
  const isRefreshingRef = useRef(false)
  const searchKeywordRef = useRef('')
  const preloadImageKeysRef = useRef<Set<string>>(new Set())
  const lastPreloadSessionRef = useRef<string | null>(null)
  const detailRequestSeqRef = useRef(0)
  const groupMembersRequestSeqRef = useRef(0)
  const groupMembersPanelCacheRef = useRef<Map<string, GroupMembersPanelCacheEntry>>(new Map())
  const hasInitializedGroupMembersRef = useRef(false)
  const chatCacheScopeRef = useRef('default')
  const previewCacheRef = useRef<Record<string, SessionPreviewCacheEntry>>({})
  const sessionWindowCacheRef = useRef<Map<string, SessionWindowCacheEntry>>(new Map())
  const previewPersistTimerRef = useRef<number | null>(null)
  const sessionListPersistTimerRef = useRef<number | null>(null)
  const pendingExportRequestIdRef = useRef<string | null>(null)
  const exportPrepareLongWaitTimerRef = useRef<number | null>(null)
  const jumpDatesRequestSeqRef = useRef(0)
  const jumpDateCountsRequestSeqRef = useRef(0)

  const isGroupChatSession = useCallback((username: string) => {
    return username.includes('@chatroom')
  }, [])

  const clearExportPrepareState = useCallback(() => {
    pendingExportRequestIdRef.current = null
    setIsPreparingExportDialog(false)
    setExportPrepareHint('')
    if (exportPrepareLongWaitTimerRef.current) {
      window.clearTimeout(exportPrepareLongWaitTimerRef.current)
      exportPrepareLongWaitTimerRef.current = null
    }
  }, [])

  const resolveCurrentViewDate = useCallback(() => {
    if (jumpStartTime > 0) {
      return new Date(jumpStartTime * 1000)
    }
    const fallbackMessage = messages[messages.length - 1] || messages[0]
    const rawTimestamp = Number(fallbackMessage?.createTime || 0)
    if (Number.isFinite(rawTimestamp) && rawTimestamp > 0) {
      return new Date(rawTimestamp > 10000000000 ? rawTimestamp : rawTimestamp * 1000)
    }
    return new Date()
  }, [jumpStartTime, messages])

  const loadJumpCalendarData = useCallback(async (sessionId: string) => {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return

    const cachedDates = messageDatesCache.current.get(normalizedSessionId)
    if (cachedDates) {
      setMessageDates(new Set(cachedDates))
      setHasLoadedMessageDates(true)
      setLoadingDates(false)
    } else {
      setLoadingDates(true)
      setHasLoadedMessageDates(false)
      setMessageDates(new Set())
      const requestSeq = jumpDatesRequestSeqRef.current + 1
      jumpDatesRequestSeqRef.current = requestSeq
      try {
        const result = await chat.getMessageDates(normalizedSessionId)
        if (requestSeq !== jumpDatesRequestSeqRef.current || currentSessionRef.current !== normalizedSessionId) return
        if (result?.success && Array.isArray(result.dates)) {
          const dateSet = new Set<string>(result.dates)
          messageDatesCache.current.set(normalizedSessionId, dateSet)
          setMessageDates(new Set(dateSet))
          setHasLoadedMessageDates(true)
        }
      } catch (error) {
        logger.error('获取消息日期失败:', error)
      } finally {
        if (requestSeq === jumpDatesRequestSeqRef.current && currentSessionRef.current === normalizedSessionId) {
          setLoadingDates(false)
        }
      }
    }

    const cachedCounts = messageDateCountsCache.current.get(normalizedSessionId)
    if (cachedCounts) {
      setMessageDateCounts({ ...cachedCounts })
      setLoadingDateCounts(false)
      return
    }

    setLoadingDateCounts(true)
    setMessageDateCounts({})
    const requestSeq = jumpDateCountsRequestSeqRef.current + 1
    jumpDateCountsRequestSeqRef.current = requestSeq
    try {
      const result = await chat.getMessageDateCounts(normalizedSessionId)
      if (requestSeq !== jumpDateCountsRequestSeqRef.current || currentSessionRef.current !== normalizedSessionId) return
      if (result?.success && result.counts) {
        const normalizedCounts: Record<string, number> = {}
        Object.entries(result.counts).forEach(([date, value]) => {
          const count = Number(value)
          if (!date || !Number.isFinite(count) || count <= 0) return
          normalizedCounts[date] = count
        })
        messageDateCountsCache.current.set(normalizedSessionId, normalizedCounts)
        setMessageDateCounts(normalizedCounts)
      }
    } catch (error) {
      logger.error('获取每日消息数失败:', error)
    } finally {
      if (requestSeq === jumpDateCountsRequestSeqRef.current && currentSessionRef.current === normalizedSessionId) {
        setLoadingDateCounts(false)
      }
    }
  }, [])

  const updateJumpPopoverPosition = useCallback(() => {
    const anchor = jumpCalendarWrapRef.current
    if (!anchor) return

    const popoverWidth = 312
    const viewportGap = 8
    const anchorRect = anchor.getBoundingClientRect()

    let left = anchorRect.right - popoverWidth
    left = Math.max(viewportGap, Math.min(left, window.innerWidth - popoverWidth - viewportGap))

    const portalHeight = jumpPopoverPortalRef.current?.offsetHeight || 0
    const belowTop = anchorRect.bottom + 10
    let top = belowTop
    if (portalHeight > 0 && belowTop + portalHeight > window.innerHeight - viewportGap) {
      top = Math.max(viewportGap, anchorRect.top - portalHeight - 10)
    }

    setJumpPopoverPosition(prev => {
      if (prev.top === top && prev.left === left) return prev
      return { top, left }
    })
  }, [])

  const handleToggleJumpPopover = useCallback(() => {
    if (!currentSessionId) return
    if (showJumpPopover) {
      setShowJumpPopover(false)
      return
    }
    setJumpPopoverDate(resolveCurrentViewDate())
    updateJumpPopoverPosition()
    setShowJumpPopover(true)
    requestAnimationFrame(() => updateJumpPopoverPosition())
    void loadJumpCalendarData(currentSessionId)
  }, [currentSessionId, loadJumpCalendarData, resolveCurrentViewDate, showJumpPopover, updateJumpPopoverPosition])

  useEffect(() => {
    const unsubscribe = onExportSessionStatus((payload) => {
      const ids = Array.isArray(payload?.inProgressSessionIds)
        ? payload.inProgressSessionIds
          .filter((id): id is string => typeof id === 'string')
          .map(id => id.trim())
          .filter(Boolean)
        : []
      setInProgressExportSessionIds(new Set(ids))
    })

    requestExportSessionStatus()
    const timer = window.setTimeout(() => {
      requestExportSessionStatus()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const unsubscribe = onSingleExportDialogStatus((payload) => {
      const requestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : ''
      if (!requestId || requestId !== pendingExportRequestIdRef.current) return

      if (payload.status === 'initializing') {
        setExportPrepareHint('正在准备导出模块（首次会稍慢，通常 1-3 秒）')
        if (exportPrepareLongWaitTimerRef.current) {
          window.clearTimeout(exportPrepareLongWaitTimerRef.current)
        }
        exportPrepareLongWaitTimerRef.current = window.setTimeout(() => {
          if (pendingExportRequestIdRef.current !== requestId) return
          setExportPrepareHint('仍在准备导出模块，请稍候...')
        }, 8000)
        return
      }

      if (payload.status === 'opened') {
        clearExportPrepareState()
        return
      }

      if (payload.status === 'failed') {
        const message = (typeof payload.message === 'string' && payload.message.trim())
          ? payload.message.trim()
          : '导出模块初始化失败，请重试'
        clearExportPrepareState()
        window.alert(message)
      }
    })

    return () => {
      unsubscribe()
      if (exportPrepareLongWaitTimerRef.current) {
        window.clearTimeout(exportPrepareLongWaitTimerRef.current)
        exportPrepareLongWaitTimerRef.current = null
      }
    }
  }, [clearExportPrepareState])

  useEffect(() => {
    if (!isPreparingExportDialog || !currentSessionId) return
    if (!inProgressExportSessionIds.has(currentSessionId)) return
    clearExportPrepareState()
  }, [clearExportPrepareState, currentSessionId, inProgressExportSessionIds, isPreparingExportDialog])

  // 加载当前用户头像
  const loadMyAvatar = useCallback(async () => {
    try {
      const result = await chat.getMyAvatarUrl()
      if (result.success && result.avatarUrl) {
        setMyAvatarUrl(result.avatarUrl)
      }
    } catch (e) {
      logger.error('加载用户头像失败:', e)
    }
  }, [])

  const handleRequireVoiceModel = useCallback((retry: () => void) => {
    pendingVoiceTranscribeRef.current = retry
    setShowVoiceTranscribeDialog(true)
  }, [])

  const handleVoiceModelDownloaded = useCallback(() => {
    setShowVoiceTranscribeDialog(false)
    const retry = pendingVoiceTranscribeRef.current
    pendingVoiceTranscribeRef.current = null
    retry?.()
  }, [])

  useEffect(() => {
    configService.getAutoTranscribeVoice()
      .then((enabled) => setAutoTranscribeVoice(enabled))
      .catch(() => setAutoTranscribeVoice(false))
  }, [])

  const resolveChatCacheScope = useCallback(async (): Promise<string> => {
    try {
      const [dbPath, myWxid] = await Promise.all([
        configService.getDbPath(),
        configService.getMyWxid()
      ])
      const scope = buildAccountScope(dbPath, myWxid)
      chatCacheScopeRef.current = scope
      return scope
    } catch {
      chatCacheScopeRef.current = 'default'
      return 'default'
    }
  }, [])

  const loadPreviewCacheFromStorage = useCallback((scope: string): Record<string, SessionPreviewCacheEntry> => {
    return readSessionPreviewCache(scope)
  }, [])

  const persistPreviewCacheToStorage = useCallback((scope: string, entries: Record<string, SessionPreviewCacheEntry>) => {
    writeSessionPreviewCache(scope, entries)
  }, [])

  const persistSessionPreviewCache = useCallback((sessionId: string, previewMessages: Message[]) => {
    previewCacheRef.current = upsertSessionPreviewEntries(previewCacheRef.current, sessionId, previewMessages)
    if (previewPersistTimerRef.current !== null) {
      window.clearTimeout(previewPersistTimerRef.current)
    }
    previewPersistTimerRef.current = window.setTimeout(() => {
      persistPreviewCacheToStorage(chatCacheScopeRef.current, previewCacheRef.current)
      previewPersistTimerRef.current = null
    }, 220)
  }, [persistPreviewCacheToStorage])

  const hydrateSessionPreview = useCallback(async (sessionId: string) => {
    const id = String(sessionId || '').trim()
    if (!id) return

    const localEntry = previewCacheRef.current[id]
    if (
      localEntry &&
      Array.isArray(localEntry.messages) &&
      localEntry.messages.length > 0 &&
      Date.now() - localEntry.updatedAt <= CHAT_SESSION_PREVIEW_CACHE_TTL_MS
    ) {
      setMessages(localEntry.messages.slice())
      setHasInitialMessages(true)
      return
    }

    try {
      const result = await chat.getCachedMessages(id)
      if (!result.success || !Array.isArray(result.messages) || result.messages.length === 0) {
        return
      }
      if (currentSessionRef.current !== id && pendingSessionLoadRef.current !== id) return
      setMessages(result.messages)
      setHasInitialMessages(true)
      persistSessionPreviewCache(id, result.messages)
    } catch {
      // ignore preview cache errors
    }
  }, [persistSessionPreviewCache, setMessages])

  const saveSessionWindowCache = useCallback((sessionId: string, entry: Omit<SessionWindowCacheEntry, 'updatedAt'>) => {
    saveSessionWindowCacheEntry(sessionWindowCacheRef.current, sessionId, entry)
  }, [])

  const restoreSessionWindowCache = useCallback((sessionId: string): boolean => {
    const entry = restoreSessionWindowCacheEntry(sessionWindowCacheRef.current, sessionId)
    if (!entry) return false

    setMessages(entry.messages.slice())
    setCurrentOffset(entry.messages.length)
    setHasMoreMessages(entry.hasMoreMessages !== false)
    setHasMoreLater(entry.hasMoreLater === true)
    setJumpStartTime(entry.jumpStartTime || 0)
    setJumpEndTime(entry.jumpEndTime || 0)
    setNoMessageTable(false)
    setHasInitialMessages(true)
    return true
  }, [
    setMessages,
    setHasMoreMessages,
    setHasMoreLater,
    setCurrentOffset,
    setJumpStartTime,
    setJumpEndTime,
    setNoMessageTable,
    setHasInitialMessages
  ])

  const hydrateSessionListCache = useCallback((scope: string): boolean => {
    const payload = readSessionListCache(scope)
    previewCacheRef.current = loadPreviewCacheFromStorage(scope)
    if (!payload) {
      return false
    }
    if (Date.now() - payload.updatedAt > CHAT_SESSION_LIST_CACHE_TTL_MS) {
      return false
    }
    if (!Array.isArray(sessionsRef.current) || sessionsRef.current.length === 0) {
      setSessions(payload.sessions)
      sessionsRef.current = payload.sessions
      return payload.sessions.length > 0
    }
    return false
  }, [loadPreviewCacheFromStorage, setSessions])

  const persistSessionListCache = useCallback((scope: string, nextSessions: ChatSession[]) => {
    writeSessionListCache(scope, nextSessions)
  }, [])

  const applySessionDetailStats = useCallback((
    sessionId: string,
    metric: SessionExportMetric,
    cacheMeta?: SessionExportCacheMeta,
    relationLoadedOverride?: boolean
  ) => {
    setSessionDetail((prev) => {
      if (!prev || prev.wxid !== sessionId) return prev
      const relationLoaded = relationLoadedOverride ?? Boolean(prev.relationStatsLoaded)
      return {
        ...prev,
        messageCount: Number.isFinite(metric.totalMessages) ? metric.totalMessages : prev.messageCount,
        voiceMessages: Number.isFinite(metric.voiceMessages) ? metric.voiceMessages : prev.voiceMessages,
        imageMessages: Number.isFinite(metric.imageMessages) ? metric.imageMessages : prev.imageMessages,
        videoMessages: Number.isFinite(metric.videoMessages) ? metric.videoMessages : prev.videoMessages,
        emojiMessages: Number.isFinite(metric.emojiMessages) ? metric.emojiMessages : prev.emojiMessages,
        transferMessages: Number.isFinite(metric.transferMessages) ? metric.transferMessages : prev.transferMessages,
        redPacketMessages: Number.isFinite(metric.redPacketMessages) ? metric.redPacketMessages : prev.redPacketMessages,
        callMessages: Number.isFinite(metric.callMessages) ? metric.callMessages : prev.callMessages,
        groupMemberCount: Number.isFinite(metric.groupMemberCount) ? metric.groupMemberCount : prev.groupMemberCount,
        groupMyMessages: Number.isFinite(metric.groupMyMessages) ? metric.groupMyMessages : prev.groupMyMessages,
        groupActiveSpeakers: Number.isFinite(metric.groupActiveSpeakers) ? metric.groupActiveSpeakers : prev.groupActiveSpeakers,
        privateMutualGroups: relationLoaded && Number.isFinite(metric.privateMutualGroups)
          ? metric.privateMutualGroups
          : prev.privateMutualGroups,
        groupMutualFriends: relationLoaded && Number.isFinite(metric.groupMutualFriends)
          ? metric.groupMutualFriends
          : prev.groupMutualFriends,
        relationStatsLoaded: relationLoaded,
        statsUpdatedAt: cacheMeta?.updatedAt ?? prev.statsUpdatedAt,
        statsStale: typeof cacheMeta?.stale === 'boolean' ? cacheMeta.stale : prev.statsStale,
        firstMessageTime: Number.isFinite(metric.firstTimestamp) ? metric.firstTimestamp : prev.firstMessageTime,
        latestMessageTime: Number.isFinite(metric.lastTimestamp) ? metric.lastTimestamp : prev.latestMessageTime
      }
    })
  }, [])

  // 加载会话详情
  const loadSessionDetail = useCallback(async (sessionId: string) => {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return

    const requestSeq = ++detailRequestSeqRef.current
    const mappedSession = sessionMapRef.current.get(normalizedSessionId) || sessionsRef.current.find((s) => s.username === normalizedSessionId)
    const hintedCount = typeof mappedSession?.messageCountHint === 'number' && Number.isFinite(mappedSession.messageCountHint) && mappedSession.messageCountHint >= 0
      ? Math.floor(mappedSession.messageCountHint)
      : undefined

    setIsRefreshingDetailStats(false)
    setIsLoadingRelationStats(false)
    setSessionDetail((prev) => {
      const sameSession = prev?.wxid === normalizedSessionId
      return {
        wxid: normalizedSessionId,
        displayName: mappedSession?.displayName || prev?.displayName || normalizedSessionId,
        remark: sameSession ? prev?.remark : undefined,
        nickName: sameSession ? prev?.nickName : undefined,
        alias: sameSession ? prev?.alias : undefined,
        avatarUrl: mappedSession?.avatarUrl || (sameSession ? prev?.avatarUrl : undefined),
        messageCount: hintedCount ?? (sameSession ? prev.messageCount : Number.NaN),
        voiceMessages: sameSession ? prev?.voiceMessages : undefined,
        imageMessages: sameSession ? prev?.imageMessages : undefined,
        videoMessages: sameSession ? prev?.videoMessages : undefined,
        emojiMessages: sameSession ? prev?.emojiMessages : undefined,
        transferMessages: sameSession ? prev?.transferMessages : undefined,
        redPacketMessages: sameSession ? prev?.redPacketMessages : undefined,
        callMessages: sameSession ? prev?.callMessages : undefined,
        privateMutualGroups: sameSession ? prev?.privateMutualGroups : undefined,
        groupMemberCount: sameSession ? prev?.groupMemberCount : undefined,
        groupMyMessages: sameSession ? prev?.groupMyMessages : undefined,
        groupActiveSpeakers: sameSession ? prev?.groupActiveSpeakers : undefined,
        groupMutualFriends: sameSession ? prev?.groupMutualFriends : undefined,
        relationStatsLoaded: sameSession ? prev?.relationStatsLoaded : false,
        statsUpdatedAt: sameSession ? prev?.statsUpdatedAt : undefined,
        statsStale: sameSession ? prev?.statsStale : undefined,
        firstMessageTime: sameSession ? prev?.firstMessageTime : undefined,
        latestMessageTime: sameSession ? prev?.latestMessageTime : undefined,
        messageTables: sameSession && Array.isArray(prev?.messageTables) ? prev.messageTables : []
      }
    })
    setIsLoadingDetail(true)
    setIsLoadingDetailExtra(true)

    if (normalizedSessionId.includes('@chatroom')) {
      void (async () => {
        try {
          const hintResult = await chat.getGroupMyMessageCountHint(normalizedSessionId)
          if (requestSeq !== detailRequestSeqRef.current) return
          if (!hintResult.success || !Number.isFinite(hintResult.count)) return
          const hintedMyCount = Math.max(0, Math.floor(hintResult.count as number))
          setSessionDetail((prev) => {
            if (!prev || prev.wxid !== normalizedSessionId) return prev
            return {
              ...prev,
              groupMyMessages: hintedMyCount
            }
          })
        } catch {
          // ignore hint errors
        }
      })()
    }

    try {
      const result = await chat.getSessionDetailFast(normalizedSessionId)
      if (requestSeq !== detailRequestSeqRef.current) return
      if (result.success && result.detail) {
        setSessionDetail((prev) => ({
          wxid: normalizedSessionId,
          displayName: result.detail!.displayName || prev?.displayName || normalizedSessionId,
          remark: result.detail!.remark,
          nickName: result.detail!.nickName,
          alias: result.detail!.alias,
          avatarUrl: result.detail!.avatarUrl || prev?.avatarUrl,
          messageCount: Number.isFinite(result.detail!.messageCount) ? result.detail!.messageCount : prev?.messageCount ?? Number.NaN,
          voiceMessages: prev?.voiceMessages,
          imageMessages: prev?.imageMessages,
          videoMessages: prev?.videoMessages,
          emojiMessages: prev?.emojiMessages,
          transferMessages: prev?.transferMessages,
          redPacketMessages: prev?.redPacketMessages,
          callMessages: prev?.callMessages,
          privateMutualGroups: prev?.privateMutualGroups,
          groupMemberCount: prev?.groupMemberCount,
          groupMyMessages: prev?.groupMyMessages,
          groupActiveSpeakers: prev?.groupActiveSpeakers,
          groupMutualFriends: prev?.groupMutualFriends,
          relationStatsLoaded: prev?.relationStatsLoaded,
          statsUpdatedAt: prev?.statsUpdatedAt,
          statsStale: prev?.statsStale,
          firstMessageTime: prev?.firstMessageTime,
          latestMessageTime: prev?.latestMessageTime,
          messageTables: Array.isArray(prev?.messageTables) ? (prev?.messageTables || []) : []
        }))
      }
    } catch (e) {
      logger.error('加载会话详情失败:', e)
    } finally {
      if (requestSeq === detailRequestSeqRef.current) {
        setIsLoadingDetail(false)
      }
    }

    try {
      const [extraResultSettled, statsResultSettled] = await Promise.allSettled([
        chat.getSessionDetailExtra(normalizedSessionId),
        chat.getExportSessionStats(
          [normalizedSessionId],
          { includeRelations: false, forceRefresh: true, preferAccurateSpecialTypes: true }
        )
      ])

      if (requestSeq !== detailRequestSeqRef.current) return

      if (extraResultSettled.status === 'fulfilled' && extraResultSettled.value.success) {
        const detail = extraResultSettled.value.detail
        if (detail) {
          setSessionDetail((prev) => {
            if (!prev || prev.wxid !== normalizedSessionId) return prev
            return {
              ...prev,
              firstMessageTime: detail.firstMessageTime,
              latestMessageTime: detail.latestMessageTime,
              messageTables: Array.isArray(detail.messageTables) ? detail.messageTables : []
            }
          })
        }
      }

      let refreshIncludeRelations = false
      if (statsResultSettled.status === 'fulfilled' && statsResultSettled.value.success) {
        const metric = statsResultSettled.value.data?.[normalizedSessionId] as SessionExportMetric | undefined
        const cacheMeta = statsResultSettled.value.cache?.[normalizedSessionId] as SessionExportCacheMeta | undefined
        refreshIncludeRelations = Boolean(cacheMeta?.includeRelations)
        if (metric) {
          applySessionDetailStats(normalizedSessionId, metric, cacheMeta, refreshIncludeRelations)
        } else if (cacheMeta) {
          setSessionDetail((prev) => {
            if (!prev || prev.wxid !== normalizedSessionId) return prev
            return {
              ...prev,
              relationStatsLoaded: refreshIncludeRelations || prev.relationStatsLoaded,
              statsUpdatedAt: cacheMeta.updatedAt,
              statsStale: cacheMeta.stale
            }
          })
        }
      }
    } catch (e) {
      logger.error('加载会话详情补充统计失败:', e)
    } finally {
      if (requestSeq === detailRequestSeqRef.current) {
        setIsLoadingDetailExtra(false)
      }
    }
  }, [applySessionDetailStats])

  const loadRelationStats = useCallback(async () => {
    const normalizedSessionId = String(currentSessionId || '').trim()
    if (!normalizedSessionId || isLoadingRelationStats) return

    const requestSeq = detailRequestSeqRef.current
    setIsLoadingRelationStats(true)
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

      const needRefresh = relationResult.success &&
        Array.isArray(relationResult.needsRefresh) &&
        relationResult.needsRefresh.includes(normalizedSessionId)

      if (needRefresh) {
        setIsRefreshingDetailStats(true)
        void (async () => {
          try {
            const freshResult = await chat.getExportSessionStats(
              [normalizedSessionId],
              { includeRelations: true, forceRefresh: true, preferAccurateSpecialTypes: true }
            )
            if (requestSeq !== detailRequestSeqRef.current) return
            if (freshResult.success && freshResult.data) {
              const freshMetric = freshResult.data[normalizedSessionId] as SessionExportMetric | undefined
              const freshMeta = freshResult.cache?.[normalizedSessionId] as SessionExportCacheMeta | undefined
              if (freshMetric) {
                applySessionDetailStats(normalizedSessionId, freshMetric, freshMeta, true)
              }
            }
          } catch (error) {
            logger.error('刷新会话关系统计失败:', error)
          } finally {
            if (requestSeq === detailRequestSeqRef.current) {
              setIsRefreshingDetailStats(false)
            }
          }
        })()
      }
    } catch (error) {
      logger.error('加载会话关系统计失败:', error)
    } finally {
      if (requestSeq === detailRequestSeqRef.current) {
        setIsLoadingRelationStats(false)
      }
    }
  }, [applySessionDetailStats, currentSessionId, isLoadingRelationStats])

  const normalizeGroupPanelMembers = useCallback((
    payload: GroupPanelMember[],
    options?: { messageCountStatus?: GroupMessageCountStatus }
  ): GroupPanelMember[] => {
    const membersPayload = Array.isArray(payload) ? payload : []
    return membersPayload
      .map((member: GroupPanelMember): GroupPanelMember | null => {
        const username = String(member.username || '').trim()
        if (!username) return null
        const preferredName = String(
          member.groupNickname ||
          member.remark ||
          member.displayName ||
          member.nickname ||
          username
        )
        const rawStatus = member.messageCountStatus
        const normalizedStatus: GroupMessageCountStatus = options?.messageCountStatus
          ?? (rawStatus === 'loading' || rawStatus === 'failed' ? rawStatus : 'ready')

        return {
          username,
          displayName: preferredName,
          avatarUrl: member.avatarUrl,
          nickname: member.nickname,
          alias: member.alias,
          remark: member.remark,
          groupNickname: member.groupNickname,
          isOwner: Boolean(member.isOwner),
          isFriend: Boolean(member.isFriend),
          messageCount: Number.isFinite(member.messageCount) ? Math.max(0, Math.floor(member.messageCount)) : 0,
          messageCountStatus: normalizedStatus
        }
      })
      .filter((member: GroupPanelMember | null): member is GroupPanelMember => Boolean(member))
      .sort((a: GroupPanelMember, b: GroupPanelMember) => {
        const ownerDiff = Number(Boolean(b.isOwner)) - Number(Boolean(a.isOwner))
        if (ownerDiff !== 0) return ownerDiff

        const friendDiff = Number(b.isFriend) - Number(a.isFriend)
        if (friendDiff !== 0) return friendDiff

        const canSortByCount = a.messageCountStatus === 'ready' && b.messageCountStatus === 'ready'
        if (canSortByCount && a.messageCount !== b.messageCount) return b.messageCount - a.messageCount
        return a.displayName.localeCompare(b.displayName, 'zh-Hans-CN')
      })
  }, [])

  const normalizeWxidLikeIdentity = useCallback((value?: string): string => {
    const trimmed = String(value || '').trim()
    if (!trimmed) return ''
    const lowered = trimmed.toLowerCase()
    if (lowered.startsWith('wxid_')) {
      const matched = lowered.match(/^(wxid_[^_]+)/i)
      return matched ? matched[1].toLowerCase() : lowered
    }
    const suffixMatch = lowered.match(/^(.+)_([a-z0-9]{4})$/i)
    return suffixMatch ? suffixMatch[1].toLowerCase() : lowered
  }, [])

  const isSelfGroupMember = useCallback((memberUsername?: string): boolean => {
    const selfRaw = String(myWxid || '').trim().toLowerCase()
    const selfNormalized = normalizeWxidLikeIdentity(myWxid)
    if (!selfRaw && !selfNormalized) return false
    const memberRaw = String(memberUsername || '').trim().toLowerCase()
    const memberNormalized = normalizeWxidLikeIdentity(memberUsername)
    return Boolean(
      (selfRaw && memberRaw && selfRaw === memberRaw) ||
      (selfNormalized && memberNormalized && selfNormalized === memberNormalized)
    )
  }, [myWxid, normalizeWxidLikeIdentity])

  const resolveMyGroupMessageCountFromMembers = useCallback((members: GroupPanelMember[]): number | undefined => {
    if (!myWxid) return undefined

    for (const member of members) {
      if (!isSelfGroupMember(member.username)) continue
      if (Number.isFinite(member.messageCount)) {
        return Math.max(0, Math.floor(member.messageCount))
      }
      return 0
    }

    return undefined
  }, [isSelfGroupMember, myWxid])

  const syncGroupMyMessagesFromMembers = useCallback((chatroomId: string, members: GroupPanelMember[]) => {
    const myMessageCount = resolveMyGroupMessageCountFromMembers(members)
    if (!Number.isFinite(myMessageCount)) return

    setSessionDetail((prev) => {
      if (!prev || prev.wxid !== chatroomId || !prev.wxid.includes('@chatroom')) return prev
      return {
        ...prev,
        groupMyMessages: myMessageCount as number
      }
    })
  }, [resolveMyGroupMessageCountFromMembers])

  const updateGroupMembersPanelCache = useCallback((
    chatroomId: string,
    members: GroupPanelMember[],
    includeMessageCounts: boolean
  ) => {
    groupMembersPanelCacheRef.current.set(chatroomId, {
      updatedAt: Date.now(),
      members,
      includeMessageCounts
    })
    if (groupMembersPanelCacheRef.current.size > 80) {
      const oldestEntry = Array.from(groupMembersPanelCacheRef.current.entries())
        .sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]
      if (oldestEntry) {
        groupMembersPanelCacheRef.current.delete(oldestEntry[0])
      }
    }
  }, [])

  const setGroupMembersCountStatus = useCallback((
    status: GroupMessageCountStatus,
    options?: { onlyWhenNotReady?: boolean }
  ) => {
    setGroupPanelMembers((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return prev
      if (options?.onlyWhenNotReady && prev.some((member) => member.messageCountStatus === 'ready')) {
        return prev
      }
      const next = normalizeGroupPanelMembers(prev, { messageCountStatus: status })
      const changed = next.some((member, index) => member.messageCountStatus !== prev[index]?.messageCountStatus)
      return changed ? next : prev
    })
  }, [normalizeGroupPanelMembers])

  const syncGroupMembersMyCountFromDetail = useCallback((chatroomId: string, myMessageCount: number) => {
    if (!chatroomId || !chatroomId.includes('@chatroom')) return
    const normalizedCount = Number.isFinite(myMessageCount) ? Math.max(0, Math.floor(myMessageCount)) : 0

    const patchMembers = (members: GroupPanelMember[]): { changed: boolean; members: GroupPanelMember[] } => {
      if (!Array.isArray(members) || members.length === 0) {
        return { changed: false, members }
      }
      let changed = false
      const patched = members.map((member) => {
        if (!isSelfGroupMember(member.username)) return member
        if (member.messageCount === normalizedCount) return member
        changed = true
        return {
          ...member,
          messageCount: normalizedCount
        }
      })
      if (!changed) return { changed: false, members }
      return { changed: true, members: normalizeGroupPanelMembers(patched) }
    }

    const cached = groupMembersPanelCacheRef.current.get(chatroomId)
    if (cached && cached.members.length > 0) {
      const patchedCache = patchMembers(cached.members)
      if (patchedCache.changed) {
        updateGroupMembersPanelCache(chatroomId, patchedCache.members, true)
      }
    }

    setGroupPanelMembers((prev) => {
      const patched = patchMembers(prev)
      if (!patched.changed) return prev
      return patched.members
    })
  }, [
    isSelfGroupMember,
    normalizeGroupPanelMembers,
    updateGroupMembersPanelCache
  ])

  const getGroupMembersPanelDataWithTimeout = useCallback(async (
    chatroomId: string,
    options: { forceRefresh?: boolean; includeMessageCounts?: boolean },
    timeoutMs: number
  ) => {
    let timeoutTimer: number | null = null
    try {
      const timeoutPromise = new Promise<{ success: false; error: string }>((resolve) => {
        timeoutTimer = window.setTimeout(() => {
          resolve({ success: false, error: '加载群成员超时，请稍后重试' })
        }, timeoutMs)
      })
      return await Promise.race([
        groupAnalytics.getGroupMembersPanelData(chatroomId, options),
        timeoutPromise
      ])
    } finally {
      if (timeoutTimer) {
        window.clearTimeout(timeoutTimer)
      }
    }
  }, [])

  const loadGroupMembersPanel = useCallback(async (chatroomId: string) => {
    if (!chatroomId || !isGroupChatSession(chatroomId)) return

    const requestSeq = ++groupMembersRequestSeqRef.current
    const now = Date.now()
    const cached = groupMembersPanelCacheRef.current.get(chatroomId)
    const cacheFresh = Boolean(cached && now - cached.updatedAt < GROUP_MEMBERS_PANEL_CACHE_TTL_MS)
    const hasCachedMembers = Boolean(cached && cached.members.length > 0)
    const hasFreshMessageCounts = Boolean(cacheFresh && cached?.includeMessageCounts)
    let startedBackgroundRefresh = false

    const refreshMessageCountsInBackground = (forceRefresh: boolean) => {
      startedBackgroundRefresh = true
      setIsRefreshingGroupMembers(true)
      setGroupMembersCountStatus('loading', { onlyWhenNotReady: true })
      void (async () => {
        try {
          const countsResult = await getGroupMembersPanelDataWithTimeout(
            chatroomId,
            { forceRefresh, includeMessageCounts: true },
            25000
          )
          if (requestSeq !== groupMembersRequestSeqRef.current) return
          if (!countsResult.success || !Array.isArray(countsResult.data)) {
            setGroupMembersError('成员列表已加载，发言统计稍后再试')
            setGroupMembersCountStatus('failed', { onlyWhenNotReady: true })
            return
          }

          const membersWithCounts = normalizeGroupPanelMembers(
            countsResult.data as GroupPanelMember[],
            { messageCountStatus: 'ready' }
          )
          setGroupPanelMembers(membersWithCounts)
          syncGroupMyMessagesFromMembers(chatroomId, membersWithCounts)
          setGroupMembersError(null)
          updateGroupMembersPanelCache(chatroomId, membersWithCounts, true)
          hasInitializedGroupMembersRef.current = true
        } catch {
          if (requestSeq !== groupMembersRequestSeqRef.current) return
          setGroupMembersError('成员列表已加载，发言统计稍后再试')
          setGroupMembersCountStatus('failed', { onlyWhenNotReady: true })
        } finally {
          if (requestSeq === groupMembersRequestSeqRef.current) {
            setIsRefreshingGroupMembers(false)
          }
        }
      })()
    }

    if (cacheFresh && cached) {
      const cachedMembers = normalizeGroupPanelMembers(
        cached.members,
        { messageCountStatus: cached.includeMessageCounts ? 'ready' : 'loading' }
      )
      setGroupPanelMembers(cachedMembers)
      if (cached.includeMessageCounts) {
        syncGroupMyMessagesFromMembers(chatroomId, cachedMembers)
      }
      setGroupMembersError(null)
      setGroupMembersLoadingHint('')
      setIsLoadingGroupMembers(false)
      hasInitializedGroupMembersRef.current = true
      if (!hasFreshMessageCounts) {
        refreshMessageCountsInBackground(false)
      } else {
        setIsRefreshingGroupMembers(false)
      }
      return
    }

    setGroupMembersError(null)
    if (hasCachedMembers && cached) {
      const cachedMembers = normalizeGroupPanelMembers(
        cached.members,
        { messageCountStatus: cached.includeMessageCounts ? 'ready' : 'loading' }
      )
      setGroupPanelMembers(cachedMembers)
      if (cached.includeMessageCounts) {
        syncGroupMyMessagesFromMembers(chatroomId, cachedMembers)
      }
      setIsRefreshingGroupMembers(true)
      setGroupMembersLoadingHint('')
      setIsLoadingGroupMembers(false)
    } else {
      setGroupPanelMembers([])
      setIsRefreshingGroupMembers(false)
      setIsLoadingGroupMembers(true)
      setGroupMembersLoadingHint(
        hasInitializedGroupMembersRef.current
          ? '加载群成员中...'
          : '首次加载群成员，正在初始化索引（可能需要几秒）'
      )
    }

    try {
      const membersResult = await getGroupMembersPanelDataWithTimeout(
        chatroomId,
        { includeMessageCounts: false, forceRefresh: false },
        12000
      )
      if (requestSeq !== groupMembersRequestSeqRef.current) return

      if (!membersResult.success || !Array.isArray(membersResult.data)) {
        if (!hasCachedMembers) {
          setGroupPanelMembers([])
        }
        setGroupMembersError(membersResult.error || (hasCachedMembers ? '刷新群成员失败，已显示缓存数据' : '加载群成员失败'))
        return
      }

      const members = normalizeGroupPanelMembers(
        membersResult.data as GroupPanelMember[],
        { messageCountStatus: 'loading' }
      )
      setGroupPanelMembers(members)
      setGroupMembersError(null)
      updateGroupMembersPanelCache(chatroomId, members, false)
      hasInitializedGroupMembersRef.current = true
      refreshMessageCountsInBackground(false)
    } catch (e) {
      if (requestSeq !== groupMembersRequestSeqRef.current) return
      if (!hasCachedMembers) {
        setGroupPanelMembers([])
      }
      setGroupMembersError(hasCachedMembers ? '刷新群成员失败，已显示缓存数据' : String(e))
    } finally {
      if (requestSeq === groupMembersRequestSeqRef.current) {
        setIsLoadingGroupMembers(false)
        setGroupMembersLoadingHint('')
        if (!startedBackgroundRefresh) {
          setIsRefreshingGroupMembers(false)
        }
      }
    }
  }, [
    getGroupMembersPanelDataWithTimeout,
    isGroupChatSession,
    syncGroupMyMessagesFromMembers,
    normalizeGroupPanelMembers,
    updateGroupMembersPanelCache
  ])

  const toggleGroupMembersPanel = useCallback(() => {
    if (!currentSessionId || !isGroupChatSession(currentSessionId)) return
    if (showGroupMembersPanel) {
      setShowGroupMembersPanel(false)
      return
    }
    setShowDetailPanel(false)
    setShowGroupMembersPanel(true)
  }, [currentSessionId, showGroupMembersPanel, isGroupChatSession])

  // 切换详情面板
  const toggleDetailPanel = useCallback(() => {
    if (showDetailPanel) {
      setShowDetailPanel(false)
      return
    }
    setShowGroupMembersPanel(false)
    setShowDetailPanel(true)
    if (currentSessionId) {
      void loadSessionDetail(currentSessionId)
    }
  }, [showDetailPanel, currentSessionId, loadSessionDetail])

  useEffect(() => {
    if (!showGroupMembersPanel) return
    if (!currentSessionId || !isGroupChatSession(currentSessionId)) {
      setShowGroupMembersPanel(false)
      return
    }
    setGroupMemberSearchKeyword('')
    void loadGroupMembersPanel(currentSessionId)
  }, [showGroupMembersPanel, currentSessionId, loadGroupMembersPanel, isGroupChatSession])

  useEffect(() => {
    const chatroomId = String(sessionDetail?.wxid || '').trim()
    if (!chatroomId || !chatroomId.includes('@chatroom')) return
    if (!Number.isFinite(sessionDetail?.groupMyMessages)) return
    syncGroupMembersMyCountFromDetail(chatroomId, sessionDetail!.groupMyMessages as number)
  }, [sessionDetail?.groupMyMessages, sessionDetail?.wxid, syncGroupMembersMyCountFromDetail])

  // 复制字段值到剪贴板
  const handleCopyField = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1500)
    } catch {
      // fallback
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1500)
    }
  }, [])

  // 连接数据库
  const connect = useCallback(async () => {
    setConnecting(true)
    setConnectionError(null)
    try {
      const scopePromise = resolveChatCacheScope()
      const result = await chat.connect()
      if (result.success) {
        setConnected(true)
        const wxidPromise = configService.getMyWxid()
        await Promise.all([scopePromise, loadSessions(), loadMyAvatar()])
        // 获取 myWxid 用于匹配个人头像
        const wxid = await wxidPromise
        if (wxid) setMyWxid(wxid as string)
      } else {
        setConnectionError(result.error || '连接失败')
      }
    } catch (e) {
      setConnectionError(String(e))
    } finally {
      setConnecting(false)
    }
  }, [loadMyAvatar, resolveChatCacheScope])

  const handleAccountChanged = useCallback(async () => {
    senderAvatarCache.clear()
    senderAvatarLoading.clear()
    preloadImageKeysRef.current.clear()
    lastPreloadSessionRef.current = null
    pendingSessionLoadRef.current = null
    initialLoadRequestedSessionRef.current = null
    sessionSwitchRequestSeqRef.current += 1
    sessionWindowCacheRef.current.clear()
    setIsSessionSwitching(false)
    setSessionDetail(null)
    setIsRefreshingDetailStats(false)
    setIsLoadingRelationStats(false)
    setShowDetailPanel(false)
    setShowGroupMembersPanel(false)
    setGroupPanelMembers([])
    setGroupMembersError(null)
    setGroupMembersLoadingHint('')
    setIsRefreshingGroupMembers(false)
    setGroupMemberSearchKeyword('')
    groupMembersRequestSeqRef.current += 1
    groupMembersPanelCacheRef.current.clear()
    hasInitializedGroupMembersRef.current = false
    setIsLoadingGroupMembers(false)
    setCurrentSession(null)
    setSessions([])
    setFilteredSessions([])
    setMessages([])
    setSearchKeyword('')
    setConnectionError(null)
    setConnected(false)
    setConnecting(false)
    setHasMoreMessages(true)
    setHasMoreLater(false)
    const scope = await resolveChatCacheScope()
    hydrateSessionListCache(scope)
    await connect()
  }, [
    connect,
    resolveChatCacheScope,
    hydrateSessionListCache,
    setConnected,
    setConnecting,
    setConnectionError,
    setCurrentSession,
    setFilteredSessions,
    setHasMoreLater,
    setHasMoreMessages,
    setMessages,
    setSearchKeyword,
    setSessionDetail,
    setShowDetailPanel,
    setShowGroupMembersPanel,
    setSessions
  ])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const scope = await resolveChatCacheScope()
      if (cancelled) return
      hydrateSessionListCache(scope)
    })()

    return () => {
      cancelled = true
    }
  }, [resolveChatCacheScope, hydrateSessionListCache])

  // 同步 currentSessionId 到 ref
  useEffect(() => {
    currentSessionRef.current = currentSessionId
  }, [currentSessionId])

  const hydrateSessionStatuses = useCallback(async (sessionList: ChatSession[]) => {
    const usernames = sessionList.map((s) => s.username).filter(Boolean)
    if (usernames.length === 0) return

    try {
      const result = await chat.getSessionStatuses(usernames)
      if (!result.success || !result.map) return

      const statusMap = result.map
      const { sessions: latestSessions } = useChatStore.getState()
      if (!Array.isArray(latestSessions) || latestSessions.length === 0) return

      let hasChanges = false
      const updatedSessions = latestSessions.map((session) => {
        const status = statusMap[session.username]
        if (!status) return session

        const nextIsFolded = status.isFolded ?? session.isFolded
        const nextIsMuted = status.isMuted ?? session.isMuted
        if (nextIsFolded === session.isFolded && nextIsMuted === session.isMuted) {
          return session
        }

        hasChanges = true
        return {
          ...session,
          isFolded: nextIsFolded,
          isMuted: nextIsMuted
        }
      })

      if (hasChanges) {
        setSessions(updatedSessions)
      }
    } catch (e) {
      logger.warn('会话状态补齐失败:', e)
    }
  }, [setSessions])

  // 加载会话列表（优化：先返回基础数据，异步加载联系人信息）
  const loadSessions = async (options?: { silent?: boolean }) => {
    if (options?.silent) {
      setIsRefreshingSessions(true)
    } else {
      setLoadingSessions(true)
    }
    try {
      const scope = await resolveChatCacheScope()
      const result = await chat.getSessions()
      if (result.success && result.sessions) {
        // 确保 sessions 是数组
        const sessionsArray = Array.isArray(result.sessions) ? result.sessions : []
        const nextSessions = options?.silent ? mergeSessions(sessionsArray) : sessionsArray
        // 确保 nextSessions 也是数组
        if (Array.isArray(nextSessions)) {


          setSessions(nextSessions)
          sessionsRef.current = nextSessions
          persistSessionListCache(scope, nextSessions)
          void hydrateSessionStatuses(nextSessions)
          // 立即启动联系人信息加载，不再延迟 500ms
          void enrichSessionsContactInfo(nextSessions)
        } else {
          logger.error('mergeSessions returned non-array:', nextSessions)
          setSessions(sessionsArray)
          sessionsRef.current = sessionsArray
          persistSessionListCache(scope, sessionsArray)
          void hydrateSessionStatuses(sessionsArray)
          void enrichSessionsContactInfo(sessionsArray)
        }
      } else if (!result.success) {
        setConnectionError(result.error || '获取会话失败')
      }
    } catch (e) {
      logger.error('加载会话失败:', e)
      setConnectionError('加载会话失败')
    } finally {
      if (options?.silent) {
        setIsRefreshingSessions(false)
      } else {
        setLoadingSessions(false)
      }
    }
  }

  // 分批异步加载联系人信息（优化性能：防止重复加载，滚动时暂停，只在空闲时加载）
  const enrichSessionsContactInfo = async (sessions: ChatSession[]) => {
    if (sessions.length === 0) return

    // 防止重复加载
    if (isEnrichingRef.current) {

      return
    }

    isEnrichingRef.current = true
    enrichCancelledRef.current = false


    const totalStart = performance.now()

    // 移除初始 500ms 延迟，让后台加载与 UI 渲染并行

    // 检查是否被取消
    if (enrichCancelledRef.current) {
      isEnrichingRef.current = false
      return
    }

    try {
      // 找出需要加载联系人信息的会话（没有头像或者没有显示名称的）
      const needEnrich = sessions.filter(s => !s.avatarUrl || !s.displayName || s.displayName === s.username)
      if (needEnrich.length === 0) {

        isEnrichingRef.current = false
        return
      }



      // 批量补齐联系人，平衡吞吐和 UI 流畅性
      const batchSize = 8
      let loadedCount = 0

      for (let i = 0; i < needEnrich.length; i += batchSize) {
        // 如果正在滚动，暂停加载
        if (isScrollingRef.current) {

          // 等待滚动结束
          while (isScrollingRef.current && !enrichCancelledRef.current) {
            await new Promise(resolve => setTimeout(resolve, 120))
          }
          if (enrichCancelledRef.current) break
        }

        // 检查是否被取消
        if (enrichCancelledRef.current) break

        const batchStart = performance.now()
        const batch = needEnrich.slice(i, i + batchSize)
        const usernames = batch.map(s => s.username)

        // 使用 requestIdleCallback 延迟执行，避免阻塞UI
        await new Promise<void>((resolve) => {
          if ('requestIdleCallback' in window) {
            window.requestIdleCallback(() => {
              void loadContactInfoBatch(usernames).then(() => resolve())
            }, { timeout: 700 })
          } else {
            setTimeout(() => {
              void loadContactInfoBatch(usernames).then(() => resolve())
            }, 80)
          }
        })

        loadedCount += batch.length
        const batchTime = performance.now() - batchStart
        if (SHOULD_LOG_CHAT_DEBUG && batchTime > 200) {
          logger.debug(`[性能监控] 批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(needEnrich.length / batchSize)} 耗时: ${batchTime.toFixed(2)}ms (已加载: ${loadedCount}/${needEnrich.length})`)
        }

        // 批次间延迟，给UI更多时间（DLL调用可能阻塞，需要更长的延迟）
        if (i + batchSize < needEnrich.length && !enrichCancelledRef.current) {
          const delay = isScrollingRef.current ? 260 : 120
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }

      const totalTime = performance.now() - totalStart
      if (!enrichCancelledRef.current) {

      } else {

      }
    } catch (e) {
      logger.error('加载联系人信息失败:', e)
    } finally {
      isEnrichingRef.current = false
    }
  }

  // 联系人信息更新队列（防抖批量更新，避免频繁重渲染）
  const contactUpdateQueueRef = useRef<Map<string, { displayName?: string; avatarUrl?: string }>>(new Map())
  const contactUpdateTimerRef = useRef<number | null>(null)
  const lastUpdateTimeRef = useRef(0)

  // 批量更新联系人信息（防抖，减少重渲染次数，增加延迟避免阻塞滚动）
  const flushContactUpdates = useCallback(() => {
    if (contactUpdateTimerRef.current) {
      clearTimeout(contactUpdateTimerRef.current)
      contactUpdateTimerRef.current = null
    }

    // 使用短防抖，让头像和昵称更快补齐但依然避免频繁重渲染
    contactUpdateTimerRef.current = window.setTimeout(() => {
      const updates = contactUpdateQueueRef.current
      if (updates.size === 0) return

      const now = Date.now()
      // 如果距离上次更新太近（小于250ms），继续延迟
      if (now - lastUpdateTimeRef.current < 250) {
        contactUpdateTimerRef.current = window.setTimeout(() => {
          flushContactUpdates()
        }, 250 - (now - lastUpdateTimeRef.current))
        return
      }

      const { sessions: currentSessions } = useChatStore.getState()
      if (!Array.isArray(currentSessions)) return

      let hasChanges = false
      const updatedSessions = currentSessions.map(session => {
        const update = updates.get(session.username)
        if (update) {
          const newDisplayName = update.displayName || session.displayName || session.username
          const newAvatarUrl = update.avatarUrl || session.avatarUrl
          if (newDisplayName !== session.displayName || newAvatarUrl !== session.avatarUrl) {
            hasChanges = true
            return {
              ...session,
              displayName: newDisplayName,
              avatarUrl: newAvatarUrl
            }
          }
        }
        return session
      })

      if (hasChanges) {
        const updateStart = performance.now()
        setSessions(updatedSessions)
        lastUpdateTimeRef.current = Date.now()
        const updateTime = performance.now() - updateStart
        if (SHOULD_LOG_CHAT_DEBUG && updateTime > 50) {
          logger.debug(`[性能监控] setSessions更新耗时: ${updateTime.toFixed(2)}ms, 更新了 ${updates.size} 个联系人`)
        }
      }

      updates.clear()
      contactUpdateTimerRef.current = null
    }, 120)
  }, [setSessions])

  // 加载一批联系人信息并更新会话列表（优化：使用队列批量更新）
  const loadContactInfoBatch = async (usernames: string[]) => {
    const startTime = performance.now()
    try {
      // 在 DLL 调用前让出控制权（使用 setTimeout 0 代替 setImmediate）
      await new Promise(resolve => setTimeout(resolve, 0))

      const dllStart = performance.now()
      const result = await chat.enrichSessionsContactInfo(usernames) as {
        success: boolean
        contacts?: Record<string, { displayName?: string; avatarUrl?: string }>
        error?: string
      }
      const dllTime = performance.now() - dllStart

      // DLL 调用后再次让出控制权
      await new Promise(resolve => setTimeout(resolve, 0))

      const totalTime = performance.now() - startTime
      if (SHOULD_LOG_CHAT_DEBUG && (dllTime > 50 || totalTime > 100)) {
        logger.debug(`[性能监控] DLL调用耗时: ${dllTime.toFixed(2)}ms, 总耗时: ${totalTime.toFixed(2)}ms, usernames: ${usernames.length}`)
      }

      if (result.success && result.contacts) {
        // 将更新加入队列，用于侧边栏更新
        const contacts = result.contacts || {}
        for (const [username, contact] of Object.entries(contacts)) {
          contactUpdateQueueRef.current.set(username, contact)

          // 如果是自己的信息且当前个人头像为空，同步更新
          if (myWxid && username === myWxid && contact.avatarUrl && !myAvatarUrl) {

            setMyAvatarUrl(contact.avatarUrl)
          }

          // 【核心优化】同步更新全局发送者头像缓存，供 MessageBubble 使用
          senderAvatarCache.set(username, {
            avatarUrl: contact.avatarUrl,
            displayName: contact.displayName
          })
        }
        // 触发批量更新
        flushContactUpdates()
      }
    } catch (e) {
      logger.error('加载联系人信息批次失败:', e)
    }
  }

  // 刷新会话列表
  const handleRefresh = async () => {
    setJumpStartTime(0)
    setJumpEndTime(0)
    setHasMoreLater(false)
    await loadSessions({ silent: true })
  }

  // 刷新当前会话消息（增量更新新消息）
  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false)

  /**
   * 极速增量刷新：基于最后一条消息时间戳，获取后续新消息
   * (由用户建议：记住上一条消息时间，自动取之后的并渲染，然后后台兜底全量同步)
   */
  const handleIncrementalRefresh = async () => {
    if (!currentSessionId || isRefreshingRef.current) return
    isRefreshingRef.current = true
    setIsRefreshingMessages(true)

    // 找出当前已渲染消息中的最大时间戳（使用 getState 获取最新状态，避免闭包过时导致重复）
    const currentMessages = useChatStore.getState().messages || []
    const lastMsg = currentMessages[currentMessages.length - 1]
    const minTime = lastMsg?.createTime || 0

    // 1. 优先执行增量查询并渲染（第一步）
    try {
      const result = await chat.getNewMessages(currentSessionId, minTime) as {
        success: boolean;
        messages?: Message[];
        error?: string
      }

      if (result.success && result.messages && result.messages.length > 0) {
        // 过滤去重：必须对比实时的状态，防止在 handleRefreshMessages 运行期间导致的冲突
        const latestMessages = useChatStore.getState().messages || []
        const existingKeys = new Set(latestMessages.map(getMessageKey))
        const newOnes = result.messages.filter(m => !existingKeys.has(getMessageKey(m)))

        if (newOnes.length > 0) {
          appendMessages(newOnes, false)
          flashNewMessages(newOnes.map(getMessageKey))
          // 滚动到底部
          requestAnimationFrame(() => {
            if (messageListRef.current) {
              messageListRef.current.scrollTop = messageListRef.current.scrollHeight
            }
          })
        }
      }
    } catch (e) {
      logger.warn('[IncrementalRefresh] 失败，将依赖全量同步兜底:', e)
    } finally {
      isRefreshingRef.current = false
      setIsRefreshingMessages(false)
    }
  }

  const handleRefreshMessages = async () => {
    if (!currentSessionId || isRefreshingRef.current) return
    setJumpStartTime(0)
    setJumpEndTime(0)
    setHasMoreLater(false)
    setIsRefreshingMessages(true)
    isRefreshingRef.current = true
    try {
      // 获取最新消息并增量添加
      const result = await chat.getLatestMessages(currentSessionId, 50) as {
        success: boolean;
        messages?: Message[];
        error?: string
      }
      if (!result.success || !result.messages) {
        return
      }
      // 使用实时状态进行去重对比
      const latestMessages = useChatStore.getState().messages || []
      const existing = new Set(latestMessages.map(getMessageKey))
      const lastMsg = latestMessages[latestMessages.length - 1]
      const lastTime = lastMsg?.createTime ?? 0

      const newMessages = result.messages.filter((msg) => {
        const key = getMessageKey(msg)
        if (existing.has(key)) return false
        // 这里的 lastTime 仅作参考过滤，主要的去重靠 key
        if (lastTime > 0 && msg.createTime < lastTime - 3600) return false // 仅过滤 1 小时之前的冗余请求
        return true
      })
      if (newMessages.length > 0) {
        appendMessages(newMessages, false)
        flashNewMessages(newMessages.map(getMessageKey))
        // 滚动到底部
        requestAnimationFrame(() => {
          if (messageListRef.current) {
            messageListRef.current.scrollTop = messageListRef.current.scrollHeight
          }
        })
      }
    } catch (e) {
      logger.error('刷新消息失败:', e)
    } finally {
      isRefreshingRef.current = false
      setIsRefreshingMessages(false)
    }
  }
  // 消息批量大小控制（保持稳定，避免游标反复重建）
  const currentBatchSizeRef = useRef(50)

  const warmupGroupSenderProfiles = useCallback((usernames: string[], defer = false) => {
    if (!Array.isArray(usernames) || usernames.length === 0) return

    const runWarmup = () => {
      const batchPromise = loadContactInfoBatch(usernames)
      usernames.forEach(username => {
        if (!senderAvatarLoading.has(username)) {
          senderAvatarLoading.set(username, batchPromise.then(() => senderAvatarCache.get(username) || null))
        }
      })
      batchPromise.finally(() => {
        usernames.forEach(username => senderAvatarLoading.delete(username))
      })
    }

    if (defer) {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(() => {
          runWarmup()
        }, { timeout: 1200 })
      } else {
        globalThis.setTimeout(runWarmup, 120)
      }
      return
    }

    runWarmup()
  }, [loadContactInfoBatch])

  // 加载消息
  const loadMessages = async (
    sessionId: string,
    offset = 0,
    startTime = 0,
    endTime = 0,
    ascending = false,
    options: LoadMessagesOptions = {}
  ) => {
    const listEl = messageListRef.current
    const session = sessionMapRef.current.get(sessionId)
    const unreadCount = session?.unreadCount ?? 0

    let messageLimit = currentBatchSizeRef.current

    if (offset === 0) {
      const preferredLimit = Number.isFinite(options.forceInitialLimit)
        ? Math.max(10, Math.floor(options.forceInitialLimit as number))
        : (unreadCount > 99 ? 30 : 40)
      currentBatchSizeRef.current = preferredLimit
      messageLimit = preferredLimit
    } else {
      // 同一会话内保持固定批量，避免后端游标因 batch 改变而重建
      messageLimit = currentBatchSizeRef.current
    }


    if (offset === 0) {
      setLoadingMessages(true)
      // 切会话时保留旧内容作为过渡，避免大面积闪烁
      setHasInitialMessages(true)
    } else {
      setLoadingMore(true)
    }

    // 记录加载前的第一条消息元素
    const firstMsgEl = listEl?.querySelector('.message-wrapper') as HTMLElement | null

    try {
      const useLatestPath = offset === 0 && startTime === 0 && endTime === 0 && !ascending && options.preferLatestPath
      const result = (useLatestPath
        ? await chat.getLatestMessages(sessionId, messageLimit)
        : await chat.getMessages(sessionId, offset, messageLimit, startTime, endTime, ascending)
      ) as {
        success: boolean;
        messages?: Message[];
        hasMore?: boolean;
        error?: string
      }
      if (options.switchRequestSeq && options.switchRequestSeq !== sessionSwitchRequestSeqRef.current) {
        return
      }
      if (currentSessionRef.current !== sessionId) {
        return
      }
      if (result.success && result.messages) {
        if (offset === 0) {
          setMessages(result.messages)
          persistSessionPreviewCache(sessionId, result.messages)
          if (result.messages.length === 0) {
            setNoMessageTable(true)
            setHasMoreMessages(false)
          }

          // 群聊发送者信息补齐改为非阻塞执行，避免影响首屏切换
          const isGroup = sessionId.includes('@chatroom')
          if (isGroup && result.messages.length > 0) {
            const unknownSenders = [...new Set(result.messages
              .filter(m => m.isSend !== 1 && m.senderUsername && !senderAvatarCache.has(m.senderUsername))
              .map(m => m.senderUsername as string)
            )]
            if (unknownSenders.length > 0) {
              warmupGroupSenderProfiles(unknownSenders, options.deferGroupSenderWarmup === true)
            }
          }

          // 日期跳转时滚动到顶部，否则滚动到底部
          requestAnimationFrame(() => {
            if (messageListRef.current) {
              if (isDateJumpRef.current) {
                messageListRef.current.scrollTop = 0
                isDateJumpRef.current = false
              } else {
                messageListRef.current.scrollTop = messageListRef.current.scrollHeight
              }
            }
          })
        } else {
          appendMessages(result.messages, true)

          // 加载更多也同样处理发送者信息预取
          const isGroup = sessionId.includes('@chatroom')
          if (isGroup) {
            const unknownSenders = [...new Set(result.messages
              .filter(m => m.isSend !== 1 && m.senderUsername && !senderAvatarCache.has(m.senderUsername))
              .map(m => m.senderUsername as string)
            )]
            if (unknownSenders.length > 0) {
              warmupGroupSenderProfiles(unknownSenders, false)
            }
          }

          // 加载更多后保持位置：让之前的第一条消息保持在原来的视觉位置
          if (firstMsgEl && listEl) {
            requestAnimationFrame(() => {
              listEl.scrollTop = firstMsgEl.offsetTop - 80
            })
          }
        }
        // 日期跳转(ascending=true)：不往上加载更早的，往下加载更晚的
        if (ascending) {
          setHasMoreMessages(false)
          setHasMoreLater(result.hasMore ?? false)
        } else {
          setHasMoreMessages(result.hasMore ?? false)
          if (offset === 0) {
            if (endTime > 0) {
              setHasMoreLater(true)
            } else {
              setHasMoreLater(false)
            }
          }
        }
        setCurrentOffset(offset + result.messages.length)
      } else if (!result.success) {
        setNoMessageTable(true)
        setHasMoreMessages(false)
      }
    } catch (e) {
      logger.error('加载消息失败:', e)
      setConnectionError('加载消息失败')
      setHasMoreMessages(false)
      if (offset === 0 && currentSessionRef.current === sessionId) {
        setMessages([])
      }
    } finally {
      setLoadingMessages(false)
      setLoadingMore(false)
      if (offset === 0 && pendingSessionLoadRef.current === sessionId) {
        if (!options.switchRequestSeq || options.switchRequestSeq === sessionSwitchRequestSeqRef.current) {
          pendingSessionLoadRef.current = null
          initialLoadRequestedSessionRef.current = null
          setIsSessionSwitching(false)
        }
      }
    }
  }

  const handleJumpDateSelect = useCallback((date: Date) => {
    if (!currentSessionId) return
    const targetDate = new Date(date)
    const end = Math.floor(targetDate.setHours(23, 59, 59, 999) / 1000)
    // 日期跳转采用“锚点定位”而非“当天过滤”：
    // 先定位到当日附近，再允许上下滚动跨天浏览。
    isDateJumpRef.current = false
    setCurrentOffset(0)
    setJumpStartTime(0)
    setJumpEndTime(end)
    setShowJumpPopover(false)
    void loadMessages(currentSessionId, 0, 0, end, false)
  }, [currentSessionId, loadMessages])

  // 加载更晚的消息
  const loadLaterMessages = useCallback(async () => {
    if (!currentSessionId || isLoadingMore || isLoadingMessages || messages.length === 0) return

    setLoadingMore(true)
    try {
      const lastMsg = messages[messages.length - 1]
      // 从最后一条消息的时间开始往后找
      const result = await chat.getMessages(currentSessionId, 0, 50, lastMsg.createTime, 0, true) as {
        success: boolean;
        messages?: Message[];
        hasMore?: boolean;
        error?: string
      }

      if (result.success && result.messages) {
        // 过滤掉已经在列表中的重复消息
        const existingKeys = messageKeySetRef.current
        const newMsgs = result.messages.filter(m => !existingKeys.has(getMessageKey(m)))

        if (newMsgs.length > 0) {
          appendMessages(newMsgs, false)
        }
        setHasMoreLater(result.hasMore ?? false)
      }
    } catch (e) {
      logger.error('加载后续消息失败:', e)
    } finally {
      setLoadingMore(false)
    }
  }, [currentSessionId, isLoadingMore, isLoadingMessages, messages, getMessageKey, appendMessages, setHasMoreLater, setLoadingMore])

  const refreshSessionIncrementally = useCallback(async (sessionId: string, switchRequestSeq?: number) => {
    const currentMessages = useChatStore.getState().messages || []
    const lastMsg = currentMessages[currentMessages.length - 1]
    const minTime = lastMsg?.createTime || 0
    if (!sessionId || minTime <= 0) return

    try {
      const result = await chat.getNewMessages(sessionId, minTime, 120) as {
        success: boolean
        messages?: Message[]
        error?: string
      }
      if (switchRequestSeq && switchRequestSeq !== sessionSwitchRequestSeqRef.current) return
      if (currentSessionRef.current !== sessionId) return
      if (!result.success || !Array.isArray(result.messages) || result.messages.length === 0) return

      const latestMessages = useChatStore.getState().messages || []
      const existing = new Set(latestMessages.map(getMessageKey))
      const newMessages = result.messages.filter((msg) => !existing.has(getMessageKey(msg)))
      if (newMessages.length > 0) {
        appendMessages(newMessages, false)
      }
    } catch (error) {
      logger.warn('[SessionCache] 增量刷新失败:', error)
    }
  }, [appendMessages, getMessageKey])

  // 选择会话
  const selectSessionById = useCallback((sessionId: string, options: { force?: boolean } = {}) => {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId || (!options.force && normalizedSessionId === currentSessionId)) return
    const switchRequestSeq = sessionSwitchRequestSeqRef.current + 1
    sessionSwitchRequestSeqRef.current = switchRequestSeq

    const selectedSession = sessionMapRef.current.get(normalizedSessionId)
    clearLocalUnread(normalizedSessionId, selectedSession?.unreadCount ?? 0)
    setCurrentSession(normalizedSessionId, { preserveMessages: false })
    setNoMessageTable(false)

    const restoredFromWindowCache = restoreSessionWindowCache(normalizedSessionId)
    if (restoredFromWindowCache) {
      pendingSessionLoadRef.current = null
      initialLoadRequestedSessionRef.current = null
      setIsSessionSwitching(false)
      void refreshSessionIncrementally(normalizedSessionId, switchRequestSeq)
    } else {
      pendingSessionLoadRef.current = normalizedSessionId
      initialLoadRequestedSessionRef.current = normalizedSessionId
      setIsSessionSwitching(true)
      void hydrateSessionPreview(normalizedSessionId)
      setCurrentOffset(0)
      setJumpStartTime(0)
      setJumpEndTime(0)
      void loadMessages(normalizedSessionId, 0, 0, 0, false, {
        preferLatestPath: true,
        deferGroupSenderWarmup: true,
        forceInitialLimit: 30,
        switchRequestSeq
      })
    }
    // 切换会话后回到正常聊天窗口：收起详情侧栏，详情需手动再次展开
    setShowJumpPopover(false)
    setShowDetailPanel(false)
    setShowGroupMembersPanel(false)
    setGroupMemberSearchKeyword('')
    setGroupMembersError(null)
    setGroupMembersLoadingHint('')
    setIsRefreshingGroupMembers(false)
    groupMembersRequestSeqRef.current += 1
    setIsLoadingGroupMembers(false)
    setSessionDetail(null)
    setIsRefreshingDetailStats(false)
    setIsLoadingRelationStats(false)
  }, [
    currentSessionId,
    clearLocalUnread,
    setCurrentSession,
    restoreSessionWindowCache,
    refreshSessionIncrementally,
    hydrateSessionPreview,
    loadMessages
  ])

  // 选择会话
  const handleSelectSession = (session: ChatSession) => {
    // 点击折叠群入口，切换到折叠群视图
    if (session.username.toLowerCase().includes('placeholder_foldgroup')) {
      setFoldedView(true)
      return
    }
    selectSessionById(session.username)
  }

  // 搜索过滤
  const handleSearch = (keyword: string) => {
    setSearchKeyword(keyword)
  }

  // 关闭搜索框
  const handleCloseSearch = () => {
    setSearchKeyword('')
  }

  // 滚动加载更多 + 显示/隐藏回到底部按钮（优化：节流，避免频繁执行）
  const scrollTimeoutRef = useRef<number | null>(null)
  const handleScroll = useCallback(() => {
    if (!messageListRef.current) return

    // 节流：延迟执行，避免滚动时频繁计算
    if (scrollTimeoutRef.current) {
      cancelAnimationFrame(scrollTimeoutRef.current)
    }

    scrollTimeoutRef.current = requestAnimationFrame(() => {
      if (!messageListRef.current) return

      const { scrollTop, clientHeight, scrollHeight } = messageListRef.current

      // 显示回到底部按钮：距离底部超过 300px
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      setShowScrollToBottom(distanceFromBottom > 300)

      // 预加载：当滚动到顶部 30% 区域时开始加载
      if (!isLoadingMore && !isLoadingMessages && hasMoreMessages && currentSessionId) {
        const threshold = clientHeight * 0.3
        if (scrollTop < threshold) {
          loadMessages(currentSessionId, currentOffset, jumpStartTime, jumpEndTime)
        }
      }

      // 预加载更晚的消息
      if (!isLoadingMore && !isLoadingMessages && hasMoreLater && currentSessionId) {
        const threshold = clientHeight * 0.3
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight
        if (distanceFromBottom < threshold) {
          loadLaterMessages()
        }
      }
    })
  }, [isLoadingMore, isLoadingMessages, hasMoreMessages, hasMoreLater, currentSessionId, currentOffset, jumpStartTime, jumpEndTime, loadMessages, loadLaterMessages])


  const getDisplayedUnreadCount = useCallback((session: ChatSession): number => {
    const rawUnreadCount = Number.isFinite(session.unreadCount) && session.unreadCount > 0
      ? Math.floor(session.unreadCount)
      : 0

    if (rawUnreadCount <= 0) return 0
    if (currentSessionId && session.username === currentSessionId) return 0

    const baseline = localUnreadBaselines[session.username]
    if (!Number.isFinite(baseline)) return rawUnreadCount

    const normalizedBaseline = Math.min(
      baseline > 0 ? Math.floor(baseline) : 0,
      rawUnreadCount
    )

    return Math.max(rawUnreadCount - normalizedBaseline, 0)
  }, [currentSessionId, localUnreadBaselines])

  const isSameSession = useCallback((prev: ChatSession, next: ChatSession): boolean => {
    return (
      prev.username === next.username &&
      prev.type === next.type &&
      prev.unreadCount === next.unreadCount &&
      prev.summary === next.summary &&
      prev.sortTimestamp === next.sortTimestamp &&
      prev.lastTimestamp === next.lastTimestamp &&
      prev.lastMsgType === next.lastMsgType &&
      prev.displayName === next.displayName &&
      prev.avatarUrl === next.avatarUrl
    )
  }, [])

  const mergeSessions = useCallback((nextSessions: ChatSession[]) => {
    // 确保输入是数组
    if (!Array.isArray(nextSessions)) {
      logger.warn('mergeSessions: nextSessions is not an array:', nextSessions)
      return Array.isArray(sessionsRef.current) ? sessionsRef.current : []
    }
    if (!Array.isArray(sessionsRef.current) || sessionsRef.current.length === 0) {
      return nextSessions
    }
    const prevMap = new Map(sessionsRef.current.map((s) => [s.username, s]))
    return nextSessions.map((next) => {
      const prev = prevMap.get(next.username)
      if (!prev) return next
      return isSameSession(prev, next) ? prev : next
    })
  }, [isSameSession])

  const flashNewMessages = useCallback((keys: string[]) => {
    if (keys.length === 0) return
    setHighlightedMessageKeys((prev) => [...prev, ...keys])
    window.setTimeout(() => {
      setHighlightedMessageKeys((prev) => prev.filter((k) => !keys.includes(k)))
    }, 2500)
  }, [])

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTo({
        top: messageListRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }, [])

  // 拖动调节侧边栏宽度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)

    const startX = e.clientX
    const startWidth = sidebarWidth

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX
      const newWidth = Math.min(Math.max(startWidth + delta, 200), 400)
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [sidebarWidth])

  // 初始化连接
  useEffect(() => {
    if (!isConnected && !isConnecting) {
      connect()
    }

    // 组件卸载时清理
    return () => {
      avatarLoadQueue.clear()
      if (previewPersistTimerRef.current !== null) {
        window.clearTimeout(previewPersistTimerRef.current)
        previewPersistTimerRef.current = null
      }
      if (sessionListPersistTimerRef.current !== null) {
        window.clearTimeout(sessionListPersistTimerRef.current)
        sessionListPersistTimerRef.current = null
      }
      if (contactUpdateTimerRef.current) {
        clearTimeout(contactUpdateTimerRef.current)
      }
      if (sessionScrollTimeoutRef.current) {
        clearTimeout(sessionScrollTimeoutRef.current)
      }
      contactUpdateQueueRef.current.clear()
      enrichCancelledRef.current = true
      isEnrichingRef.current = false
    }
  }, [])

  useEffect(() => {
    const handleChange = () => {
      void handleAccountChanged()
    }
    window.addEventListener('wxid-changed', handleChange as EventListener)
    return () => window.removeEventListener('wxid-changed', handleChange as EventListener)
  }, [handleAccountChanged])

  useEffect(() => {
    const nextSet = new Set<string>()
    for (const msg of messages) {
      nextSet.add(getMessageKey(msg))
    }
    messageKeySetRef.current = nextSet
    const lastMsg = messages[messages.length - 1]
    lastMessageTimeRef.current = lastMsg?.createTime ?? 0
  }, [messages, getMessageKey])

  useEffect(() => {
    currentSessionRef.current = currentSessionId
  }, [currentSessionId])

  useEffect(() => {
    if (currentSessionId !== lastPreloadSessionRef.current) {
      preloadImageKeysRef.current.clear()
      lastPreloadSessionRef.current = currentSessionId
    }
  }, [currentSessionId])

  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return
    const preloadEdgeCount = 40
    const maxPreload = 30
    const head = messages.slice(0, preloadEdgeCount)
    const tail = messages.slice(-preloadEdgeCount)
    const candidates = [...head, ...tail]
    const queued = preloadImageKeysRef.current
    const seen = new Set<string>()
    const payloads: Array<{ sessionId?: string; imageMd5?: string; imageDatName?: string }> = []
    for (const msg of candidates) {
      if (payloads.length >= maxPreload) break
      if (msg.localType !== 3) continue
      const cacheKey = msg.imageMd5 || msg.imageDatName || `local:${msg.localId}`
      if (!msg.imageMd5 && !msg.imageDatName) continue
      if (imageDataUrlCache.has(cacheKey)) continue
      const taskKey = `${currentSessionId}|${cacheKey}`
      if (queued.has(taskKey) || seen.has(taskKey)) continue
      queued.add(taskKey)
      seen.add(taskKey)
      payloads.push({
        sessionId: currentSessionId,
        imageMd5: msg.imageMd5 || undefined,
        imageDatName: msg.imageDatName
      })
    }
    if (payloads.length > 0) {
      image.preload(payloads).catch(() => { })
    }
  }, [currentSessionId, messages])

  useEffect(() => {
    const nextMap = new Map<string, ChatSession>()
    if (Array.isArray(sessions)) {
      for (const session of sessions) {
        nextMap.set(session.username, session)
      }
    }
    sessionMapRef.current = nextMap
  }, [sessions])

  useEffect(() => {
    sessionsRef.current = Array.isArray(sessions) ? sessions : []
  }, [sessions])

  useEffect(() => {
    isLoadingMessagesRef.current = isLoadingMessages
    isLoadingMoreRef.current = isLoadingMore
  }, [isLoadingMessages, isLoadingMore])

  useEffect(() => {
    if (initialRevealTimerRef.current !== null) {
      window.clearTimeout(initialRevealTimerRef.current)
      initialRevealTimerRef.current = null
    }
    if (!isLoadingMessages) {
      if (messages.length === 0) {
        setHasInitialMessages(true)
      } else {
        initialRevealTimerRef.current = window.setTimeout(() => {
          setHasInitialMessages(true)
          initialRevealTimerRef.current = null
        }, 120)
      }
    }
  }, [isLoadingMessages, messages.length])

  useEffect(() => {
    if (currentSessionId !== prevSessionRef.current) {
      prevSessionRef.current = currentSessionId
      setNoMessageTable(false)
      if (initialRevealTimerRef.current !== null) {
        window.clearTimeout(initialRevealTimerRef.current)
        initialRevealTimerRef.current = null
      }
      if (messages.length === 0) {
        setHasInitialMessages(false)
      } else if (!isLoadingMessages) {
        setHasInitialMessages(true)
      }
    }
  }, [currentSessionId, messages.length, isLoadingMessages])

  useEffect(() => {
    if (currentSessionId && isConnected && messages.length === 0 && !isLoadingMessages && !isLoadingMore && !noMessageTable) {
      if (pendingSessionLoadRef.current === currentSessionId) return
      if (initialLoadRequestedSessionRef.current === currentSessionId) return
      initialLoadRequestedSessionRef.current = currentSessionId
      setHasInitialMessages(false)
      void loadMessages(currentSessionId, 0, 0, 0, false, {
        preferLatestPath: true,
        deferGroupSenderWarmup: true,
        forceInitialLimit: 30
      })
    }
  }, [currentSessionId, isConnected, messages.length, isLoadingMessages, isLoadingMore, noMessageTable])

  useEffect(() => {
    return () => {
      if (initialRevealTimerRef.current !== null) {
        window.clearTimeout(initialRevealTimerRef.current)
        initialRevealTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    isConnectedRef.current = isConnected
  }, [isConnected])

  useEffect(() => {
    searchKeywordRef.current = searchKeyword
  }, [searchKeyword])

  useEffect(() => {
    if (!showJumpPopover) return
    const handleGlobalPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (jumpCalendarWrapRef.current?.contains(target)) return
      if (jumpPopoverPortalRef.current?.contains(target)) return
      setShowJumpPopover(false)
    }
    document.addEventListener('mousedown', handleGlobalPointerDown)
    return () => {
      document.removeEventListener('mousedown', handleGlobalPointerDown)
    }
  }, [showJumpPopover])

  useEffect(() => {
    if (!showJumpPopover) return
    const syncPosition = () => {
      requestAnimationFrame(() => updateJumpPopoverPosition())
    }

    syncPosition()
    window.addEventListener('resize', syncPosition)
    window.addEventListener('scroll', syncPosition, true)
    return () => {
      window.removeEventListener('resize', syncPosition)
      window.removeEventListener('scroll', syncPosition, true)
    }
  }, [showJumpPopover, updateJumpPopoverPosition])

  useEffect(() => {
    setShowJumpPopover(false)
    setLoadingDates(false)
    setLoadingDateCounts(false)
    setHasLoadedMessageDates(false)
    setMessageDates(new Set())
    setMessageDateCounts({})
  }, [currentSessionId])

  useEffect(() => {
    if (!currentSessionId || !Array.isArray(messages) || messages.length === 0) return
    persistSessionPreviewCache(currentSessionId, messages)
    saveSessionWindowCache(currentSessionId, {
      messages,
      currentOffset,
      hasMoreMessages,
      hasMoreLater,
      jumpStartTime,
      jumpEndTime
    })
  }, [
    currentSessionId,
    messages,
    currentOffset,
    hasMoreMessages,
    hasMoreLater,
    jumpStartTime,
    jumpEndTime,
    persistSessionPreviewCache,
    saveSessionWindowCache
  ])

  useEffect(() => {
    if (!Array.isArray(sessions) || sessions.length === 0) return
    if (sessionListPersistTimerRef.current !== null) {
      window.clearTimeout(sessionListPersistTimerRef.current)
    }
    sessionListPersistTimerRef.current = window.setTimeout(() => {
      persistSessionListCache(chatCacheScopeRef.current, sessions)
      sessionListPersistTimerRef.current = null
    }, 260)
  }, [sessions, persistSessionListCache])

  // 普通视图：隐藏 isFolded 的群，保留 placeholder_foldgroup 入口
  useEffect(() => {
    if (!Array.isArray(sessions)) {
      setFilteredSessions([])
      return
    }
    const visible = sessions.filter(s => {
      if (s.isFolded && !s.username.toLowerCase().includes('placeholder_foldgroup')) return false
      return true
    })
    if (!searchKeyword.trim()) {
      setFilteredSessions(visible)
      return
    }
    const lower = searchKeyword.toLowerCase()
    setFilteredSessions(visible.filter(s =>
      s.displayName?.toLowerCase().includes(lower) ||
      s.username.toLowerCase().includes(lower) ||
      s.summary.toLowerCase().includes(lower)
    ))
  }, [sessions, searchKeyword, setFilteredSessions])

  // 折叠群列表（独立计算，供折叠 panel 使用）
  const foldedSessions = useMemo(() => {
    if (!Array.isArray(sessions)) return []
    const folded = sessions.filter(s => s.isFolded)
    if (!searchKeyword.trim() || !foldedView) return folded
    const lower = searchKeyword.toLowerCase()
    return folded.filter(s =>
      s.displayName?.toLowerCase().includes(lower) ||
      s.username.toLowerCase().includes(lower) ||
      s.summary.toLowerCase().includes(lower)
    )
  }, [sessions, searchKeyword, foldedView])

  const hasSessionRecords = Array.isArray(sessions) && sessions.length > 0
  const shouldShowSessionsSkeleton = isLoadingSessions && !hasSessionRecords
  const isSessionListSyncing = (isLoadingSessions || isRefreshingSessions) && hasSessionRecords


  // 格式化会话时间（相对时间）- 使用 useMemo 缓存，避免每次渲染都计算
  const formatSessionTime = useCallback((timestamp: number): string => {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return ''

    const now = Date.now()
    const msgTime = timestamp * 1000
    const diff = now - msgTime

    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)

    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    if (hours < 24) return `${hours}小时前`

    // 超过24小时显示日期
    const date = new Date(msgTime)
    const nowDate = new Date()

    if (date.getFullYear() === nowDate.getFullYear()) {
      return `${date.getMonth() + 1}/${date.getDate()}`
    }

    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
  }, [])

  // 获取当前会话信息（从通讯录跳转时可能不在 sessions 列表中，构造 fallback）
  const currentSession = (() => {
    const found = Array.isArray(sessions) ? sessions.find(s => s.username === currentSessionId) : undefined
    if (found) {
      if (
        standaloneSessionWindow &&
        normalizedInitialSessionId &&
        found.username === normalizedInitialSessionId
      ) {
        return {
          ...found,
          displayName: found.displayName || fallbackDisplayName || found.username,
          avatarUrl: found.avatarUrl || fallbackAvatarUrl || undefined
        }
      }
      return found
    }
    if (!currentSessionId) return found
    return {
      username: currentSessionId,
      type: 0,
      unreadCount: 0,
      summary: '',
      sortTimestamp: 0,
      lastTimestamp: 0,
      lastMsgType: 0,
      displayName: fallbackDisplayName || currentSessionId,
      avatarUrl: fallbackAvatarUrl || undefined,
    } as ChatSession
  })()
  const filteredGroupPanelMembers = useMemo(() => {
    const keyword = groupMemberSearchKeyword.trim().toLowerCase()
    if (!keyword) return groupPanelMembers
    return groupPanelMembers.filter((member) => {
      const fields = [
        member.username,
        member.displayName,
        member.groupNickname,
        member.remark,
        member.nickname,
        member.alias
      ]
      return fields.some(field => String(field || '').toLowerCase().includes(keyword))
    })
  }, [groupMemberSearchKeyword, groupPanelMembers])
  const isCurrentSessionExporting = Boolean(currentSessionId && inProgressExportSessionIds.has(currentSessionId))
  const isExportActionBusy = isCurrentSessionExporting || isPreparingExportDialog
  const isCurrentSessionGroup = Boolean(
    currentSession && (
      isGroupChatSession(currentSession.username) ||
      (
        standaloneSessionWindow &&
        currentSession.username === normalizedInitialSessionId &&
        normalizedStandaloneInitialContactType === 'group'
      )
    )
  )
  const isCurrentSessionPrivateSnsSupported = Boolean(
    currentSession &&
    isSingleContactSession(currentSession.username) &&
    !isCurrentSessionGroup
  )

  const openCurrentSessionSnsTimeline = useCallback(() => {
    if (!currentSession || !isCurrentSessionPrivateSnsSupported) return
    setChatSnsTimelineTarget({
      username: currentSession.username,
      displayName: currentSession.displayName || currentSession.username,
      avatarUrl: currentSession.avatarUrl
    })
  }, [currentSession, isCurrentSessionPrivateSnsSupported])

  useEffect(() => {
    if (!standaloneSessionWindow) return
    setStandaloneInitialLoadRequested(false)
    setStandaloneLoadStage(normalizedInitialSessionId ? 'connecting' : 'idle')
    setFallbackDisplayName(normalizedStandaloneInitialDisplayName || null)
    setFallbackAvatarUrl(normalizedStandaloneInitialAvatarUrl || null)
  }, [
    standaloneSessionWindow,
    normalizedInitialSessionId,
    normalizedStandaloneInitialDisplayName,
    normalizedStandaloneInitialAvatarUrl
  ])

  useEffect(() => {
    if (!standaloneSessionWindow) return
    if (!normalizedInitialSessionId) return

    if (normalizedStandaloneInitialDisplayName) {
      setFallbackDisplayName(normalizedStandaloneInitialDisplayName)
    }
    if (normalizedStandaloneInitialAvatarUrl) {
      setFallbackAvatarUrl(normalizedStandaloneInitialAvatarUrl)
    }

    if (!currentSessionId) {
      setCurrentSession(normalizedInitialSessionId, { preserveMessages: false })
    }
    if (!isConnected || isConnecting) {
      setStandaloneLoadStage('connecting')
    }
  }, [
    standaloneSessionWindow,
    normalizedInitialSessionId,
    normalizedStandaloneInitialDisplayName,
    normalizedStandaloneInitialAvatarUrl,
    currentSessionId,
    isConnected,
    isConnecting,
    setCurrentSession
  ])

  useEffect(() => {
    if (!standaloneSessionWindow) return
    if (!normalizedInitialSessionId) return
    if (!isConnected || isConnecting) return
    if (currentSessionId === normalizedInitialSessionId && standaloneInitialLoadRequested) return
    setStandaloneInitialLoadRequested(true)
    setStandaloneLoadStage('loading')
    selectSessionById(normalizedInitialSessionId, {
      force: currentSessionId === normalizedInitialSessionId
    })
  }, [
    standaloneSessionWindow,
    normalizedInitialSessionId,
    isConnected,
    isConnecting,
    currentSessionId,
    standaloneInitialLoadRequested,
    selectSessionById
  ])

  useEffect(() => {
    if (!standaloneSessionWindow || !normalizedInitialSessionId) return
    if (!isConnected || isConnecting) {
      setStandaloneLoadStage('connecting')
      return
    }
    if (!standaloneInitialLoadRequested) {
      setStandaloneLoadStage('loading')
      return
    }
    if (currentSessionId !== normalizedInitialSessionId) {
      setStandaloneLoadStage('loading')
      return
    }
    if (isLoadingMessages || isSessionSwitching) {
      setStandaloneLoadStage('loading')
      return
    }
    setStandaloneLoadStage('ready')
  }, [
    standaloneSessionWindow,
    normalizedInitialSessionId,
    isConnected,
    isConnecting,
    standaloneInitialLoadRequested,
    currentSessionId,
    isLoadingMessages,
    isSessionSwitching
  ])

  // 从通讯录跳转时，会话不在列表中，主动加载联系人显示名称
  useEffect(() => {
    if (!currentSessionId) return
    const found = Array.isArray(sessions) ? sessions.find(s => s.username === currentSessionId) : undefined
    if (found) {
      if (found.displayName) setFallbackDisplayName(found.displayName)
      if (found.avatarUrl) setFallbackAvatarUrl(found.avatarUrl)
      return
    }
    loadContactInfoBatch([currentSessionId]).then(() => {
      const cached = senderAvatarCache.get(currentSessionId)
      if (cached?.displayName) setFallbackDisplayName(cached.displayName)
      if (cached?.avatarUrl) setFallbackAvatarUrl(cached.avatarUrl)
    })
  }, [currentSessionId, sessions])

  // 渲染日期分隔
  const shouldShowDateDivider = (msg: Message, prevMsg?: Message): boolean => {
    if (!prevMsg) return true
    const date = new Date(msg.createTime * 1000).toDateString()
    const prevDate = new Date(prevMsg.createTime * 1000).toDateString()
    return date !== prevDate
  }

  const formatDateDivider = (timestamp: number): string => {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '未知时间'
    const date = new Date(timestamp * 1000)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()

    if (isToday) return '今天'

    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) return '昨天'

    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const handleBatchDecrypt = useCallback(async () => {
    if (!currentSessionId || isBatchDecrypting) return
    const session = sessions.find(s => s.username === currentSessionId)
    if (!session) {
      alert('未找到当前会话')
      return
    }

    const result = await chat.getImageMessageDateCounts(currentSessionId)
    if (!result.success || !result.counts) {
      alert(`获取图片日期统计失败: ${result.error || '未知错误'}`)
      return
    }

    const sortedDates = Object.entries(result.counts)
      .filter(([, count]) => Number(count) > 0)
      .map(([date]) => date)
      .sort((a, b) => b.localeCompare(a))

    if (sortedDates.length === 0) {
      alert('当前会话没有图片消息')
      return
    }

    setBatchImageDateCounts(result.counts)
    setBatchImageDates(sortedDates)
    setBatchImageSelectedDates(new Set(sortedDates))
    setShowBatchDecryptConfirm(true)
  }, [currentSessionId, isBatchDecrypting, sessions])

  const handleBatchTranscribe = useCallback(async () => {
    if (!currentSessionId || isBatchTranscribing) return
    const session = sessions.find(s => s.username === currentSessionId)
    if (!session) {
      alert('未找到当前会话')
      return
    }

    const result = await chat.getAllVoiceMessages(currentSessionId)
    if (!result.success || !result.messages) {
      alert(`获取语音消息失败: ${result.error || '未知错误'}`)
      return
    }

    const messages = result.messages
    if (messages.length === 0) {
      alert('当前会话没有语音消息')
      return
    }

    startTranscribe(messages.length, session.displayName || session.username || currentSessionId)
    let success = 0
    let fail = 0
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      updateTranscribeProgress(i + 1, messages.length)
      try {
        const transcriptResult = await chat.getVoiceTranscript(currentSessionId, String(msg.localId), msg.createTime)
        if (transcriptResult.success && transcriptResult.transcript) {
          success += 1
        } else {
          fail += 1
          if (transcriptResult.error && transcriptResult.error.includes('模型文件不存在')) {
            handleRequireVoiceModel(() => { void handleBatchTranscribe() })
            finishTranscribe(success, fail)
            return
          }
        }
      } catch {
        fail += 1
      }
    }
    finishTranscribe(success, fail)
  }, [currentSessionId, isBatchTranscribing, sessions, startTranscribe, updateTranscribeProgress, finishTranscribe, handleRequireVoiceModel])

  const handleExportCurrentSession = useCallback(() => {
    if (!currentSessionId) return
    if (inProgressExportSessionIds.has(currentSessionId) || isPreparingExportDialog) return

    const requestId = `chat-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const sessionName = currentSession?.displayName || currentSession?.username || currentSessionId
    pendingExportRequestIdRef.current = requestId
    setIsPreparingExportDialog(true)
    setExportPrepareHint('')
    if (exportPrepareLongWaitTimerRef.current) {
      window.clearTimeout(exportPrepareLongWaitTimerRef.current)
      exportPrepareLongWaitTimerRef.current = null
    }
    emitOpenSingleExport({
      sessionId: currentSessionId,
      sessionName,
      requestId
    })
  }, [currentSession, currentSessionId, inProgressExportSessionIds, isPreparingExportDialog])

  const handleGroupAnalytics = useCallback(() => {
    if (!currentSessionId || !isGroupChatSession(currentSessionId)) return
    navigate('/group-analytics', {
      state: {
        preselectGroupIds: [currentSessionId]
      }
    })
  }, [currentSessionId, navigate, isGroupChatSession])

  const confirmBatchDecrypt = useCallback(async () => {
    if (!currentSessionId) return

    const selectedDates = Array.from(batchImageSelectedDates)
    if (selectedDates.length === 0) {
      alert('请至少选择一个日期')
      return
    }

    const session = sessions.find(s => s.username === currentSessionId)
    if (!session) return

    const result = await chat.getImageMessagesByDates(currentSessionId, selectedDates)
    if (!result.success || !result.images) {
      alert(`获取所选日期图片失败: ${result.error || '未知错误'}`)
      return
    }

    const images = result.images
    if (images.length === 0) {
      alert('所选日期下没有图片消息')
      return
    }

    setShowBatchDecryptConfirm(false)
    setBatchImageDateCounts({})
    setBatchImageDates([])
    setBatchImageSelectedDates(new Set())

    startDecrypt(images.length, session.displayName || session.username)

    let successCount = 0
    let failCount = 0
    let completed = 0
    const concurrency = Math.max(1, Math.min(batchDecryptConcurrency, images.length))

    const decryptOne = async (img: BatchImageDecryptCandidate) => {
      try {
        const r = await image.decrypt({
          sessionId: session.username,
          imageMd5: img.imageMd5,
          imageDatName: img.imageDatName,
          force: true
        })
        if (r?.success) successCount++
        else failCount++
      } catch {
        failCount++
      }
      completed++
      updateDecryptProgress(completed, images.length)
    }

    let nextIndex = 0
    const workers = Array.from({ length: concurrency }, async () => {
      while (nextIndex < images.length) {
        const currentIndex = nextIndex
        nextIndex += 1
        await decryptOne(images[currentIndex])
      }
    })
    await Promise.all(workers)

    finishDecrypt(successCount, failCount)
  }, [batchImageSelectedDates, batchDecryptConcurrency, currentSessionId, finishDecrypt, sessions, startDecrypt, updateDecryptProgress])

  const batchImageCountByDate = useMemo(() => {
    return new Map<string, number>(Object.entries(batchImageDateCounts))
  }, [batchImageDateCounts])

  const batchImageSelectedCount = useMemo(() => {
    return Array.from(batchImageSelectedDates).reduce((sum, date) => sum + (batchImageDateCounts[date] || 0), 0)
  }, [batchImageDateCounts, batchImageSelectedDates])

  const toggleBatchImageDate = useCallback((date: string) => {
    setBatchImageSelectedDates(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }, [])
  const selectAllBatchImageDates = useCallback(() => setBatchImageSelectedDates(new Set(batchImageDates)), [batchImageDates])
  const clearAllBatchImageDates = useCallback(() => setBatchImageSelectedDates(new Set()), [])

  const lastSelectedIdRef = useRef<number | null>(null)

  const handleToggleSelection = useCallback((localId: number, isShiftKey: boolean = false) => {
    setSelectedMessages(prev => {
      const next = new Set(prev)

      // Range selection with Shift key
      if (isShiftKey && lastSelectedIdRef.current !== null && lastSelectedIdRef.current !== localId) {
        const currentMsgs = useChatStore.getState().messages || []
        const idx1 = currentMsgs.findIndex(m => m.localId === lastSelectedIdRef.current)
        const idx2 = currentMsgs.findIndex(m => m.localId === localId)

        if (idx1 !== -1 && idx2 !== -1) {
          const start = Math.min(idx1, idx2)
          const end = Math.max(idx1, idx2)
          for (let i = start; i <= end; i++) {
            next.add(currentMsgs[i].localId)
          }
        }
      } else {
        // Normal toggle
        if (next.has(localId)) {
          next.delete(localId)
          lastSelectedIdRef.current = null // Reset last selection on uncheck? Or keep? Usually keep last interaction.
        } else {
          next.add(localId)
          lastSelectedIdRef.current = localId
        }
      }
      return next
    })
  }, [])

  const formatBatchDateLabel = useCallback((dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number)
    return `${y}年${m}月${d}日`
  }, [])

  // 消息右键菜单处理
  const handleContextMenu = useCallback((e: React.MouseEvent, message: Message) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      message
    })
  }, [])

  // 关闭右键菜单
  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null)
    }
    window.addEventListener('click', handleClick)
    return () => {
      window.removeEventListener('click', handleClick)
    }
  }, [])

  return (
    <div className={`chat-page ${isResizing ? 'resizing' : ''} ${standaloneSessionWindow ? 'standalone session-only' : ''}`}>
      {/* 左侧会话列表 */}
      {!standaloneSessionWindow && (
      <div
        className="session-sidebar"
        ref={sidebarRef}
        style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}
      >
        <div className={`session-header session-header-viewport ${foldedView ? 'folded' : ''}`}>
          {/* 普通 header */}
          <div className="session-header-panel main-header">
            <div className="search-row">
              <div className="search-box expanded">
                <Search size={14} />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="搜索"
                  value={searchKeyword}
                  onChange={(e) => handleSearch(e.target.value)}
                />
                {searchKeyword && (
                  <button className="close-search" onClick={handleCloseSearch}>
                    <X size={12} />
                  </button>
                )}
              </div>
              <button className="icon-btn refresh-btn" onClick={handleRefresh} disabled={isLoadingSessions || isRefreshingSessions}>
                <RefreshCw size={16} className={(isLoadingSessions || isRefreshingSessions) ? 'spin' : ''} />
              </button>
              {isSessionListSyncing && (
                <div className="session-sync-indicator">
                  <Loader2 size={12} className="spin" />
                  <span>同步中</span>
                </div>
              )}
            </div>
          </div>
          {/* 折叠群 header */}
          <div className="session-header-panel folded-header">
            <div className="folded-view-header">
              <button className="icon-btn back-btn" onClick={() => setFoldedView(false)}>
                <ChevronLeft size={18} />
              </button>
              <span className="folded-view-title">
                <Users size={14} />
                折叠的群聊
              </span>
            </div>
          </div>
        </div>

        {connectionError && (
          <div className="connection-error">
            <AlertCircle size={16} />
            <span>{connectionError}</span>
            <button onClick={connect}>重试</button>
          </div>
        )}

        {/* ... (previous content) ... */}
        {shouldShowSessionsSkeleton ? (
          <div className="loading-sessions">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="skeleton-item">
                <div className="skeleton-avatar" />
                <div className="skeleton-content">
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`session-list-viewport ${foldedView ? 'folded' : ''}`}>
            {/* 普通会话列表 */}
            <div className="session-list-panel main-panel">
              {Array.isArray(filteredSessions) && filteredSessions.length > 0 ? (
                <div
                  className="session-list"
                  ref={sessionListRef}
                  onScroll={() => {
                    isScrollingRef.current = true
                    if (sessionScrollTimeoutRef.current) {
                      clearTimeout(sessionScrollTimeoutRef.current)
                    }
                    sessionScrollTimeoutRef.current = window.setTimeout(() => {
                      isScrollingRef.current = false
                      sessionScrollTimeoutRef.current = null
                    }, 200)
                  }}
                >
                  {filteredSessions.map(session => (
                    <SessionItem
                      key={session.username}
                      session={session}
                      isActive={currentSessionId === session.username}
                      unreadCount={getDisplayedUnreadCount(session)}
                      onSelect={handleSelectSession}
                      formatTime={formatSessionTime}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-sessions">
                  <MessageSquare />
                  <p>暂无会话</p>
                  <p className="hint">检查你的数据库配置</p>
                </div>
              )}
            </div>

            {/* 折叠群列表 */}
            <div className="session-list-panel folded-panel">
              {foldedSessions.length > 0 ? (
                <div className="session-list">
                  {foldedSessions.map(session => (
                    <SessionItem
                      key={session.username}
                      session={session}
                      isActive={currentSessionId === session.username}
                      unreadCount={getDisplayedUnreadCount(session)}
                      onSelect={handleSelectSession}
                      formatTime={formatSessionTime}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-sessions">
                  <Users size={32} />
                  <p>没有折叠的群聊</p>
                </div>
              )}
            </div>
          </div>
        )}


      </div>
      )}

      {/* 拖动调节条 */}
      {!standaloneSessionWindow && <div className="resize-handle" onMouseDown={handleResizeStart} />}

      {/* 右侧消息区域 */}
      <div className="message-area">
        {currentSession ? (
          <>
            <div className="message-header">
              <Avatar
                src={currentSession.avatarUrl}
                name={currentSession.displayName || currentSession.username}
                size={40}
                className={isCurrentSessionGroup ? 'group session-avatar' : 'session-avatar'}
              />
              <div className="header-info">
                <h3>{currentSession.displayName || currentSession.username}</h3>
                {isCurrentSessionGroup && (
                  <div className="header-subtitle">群聊</div>
                )}
              </div>
              <div className="header-actions">
                {!standaloneSessionWindow && isCurrentSessionGroup && (
                  <button
                    className="icon-btn group-analytics-btn"
                    onClick={handleGroupAnalytics}
                    title="群聊分析"
                  >
                    <BarChart3 size={18} />
                  </button>
                )}
                {isCurrentSessionGroup && (
                  <button
                    className={`icon-btn group-members-btn ${showGroupMembersPanel ? 'active' : ''}`}
                    onClick={toggleGroupMembersPanel}
                    title="群成员"
                  >
                    <Users size={18} />
                  </button>
                )}
                {!standaloneSessionWindow && (
                  <button
                    className={`icon-btn export-session-btn${isExportActionBusy ? ' exporting' : ''}`}
                    onClick={handleExportCurrentSession}
                    disabled={!currentSessionId || isExportActionBusy}
                    title={isCurrentSessionExporting ? '导出中' : isPreparingExportDialog ? '正在准备导出模块' : '导出当前会话'}
                  >
                    {isExportActionBusy ? (
                      <Loader2 size={18} className="spin" />
                    ) : (
                      <Download size={18} />
                    )}
                  </button>
                )}
                {!standaloneSessionWindow && isCurrentSessionPrivateSnsSupported && (
                  <button
                    className="icon-btn chat-sns-timeline-btn"
                    onClick={openCurrentSessionSnsTimeline}
                    disabled={!currentSessionId}
                    title="查看对方朋友圈"
                  >
                    <Aperture size={18} />
                  </button>
                )}
                {!standaloneSessionWindow && (
                  <button
                    className={`icon-btn batch-transcribe-btn${isBatchTranscribing ? ' transcribing' : ''}`}
                    onClick={() => {
                      if (isBatchTranscribing) {
                        setShowBatchTranscribeToast(true)
                      } else {
                        handleBatchTranscribe()
                      }
                    }}
                    disabled={!currentSessionId}
                    title={isBatchTranscribing
                      ? `批量转写中 (${batchTranscribeProgress.current}/${batchTranscribeProgress.total})，点击查看进度`
                      : '批量转写语音'}
                  >
                    {isBatchTranscribing ? (
                      <Loader2 size={18} className="spin" />
                    ) : (
                      <Mic size={18} />
                    )}
                  </button>
                )}
                {!standaloneSessionWindow && (
                  <button
                    className={`icon-btn batch-decrypt-btn${isBatchDecrypting ? ' transcribing' : ''}`}
                    onClick={() => {
                      if (isBatchDecrypting) {
                        setShowBatchDecryptToast(true)
                      } else {
                        handleBatchDecrypt()
                      }
                    }}
                    disabled={!currentSessionId}
                    title={isBatchDecrypting
                      ? `批量解密中 (${batchDecryptProgress.current}/${batchDecryptProgress.total})，点击查看进度`
                      : '批量解密图片'}
                  >
                    {isBatchDecrypting ? (
                      <Loader2 size={18} className="spin" />
                    ) : (
                      <ImageIcon size={18} />
                    )}
                  </button>
                )}
                <div className="jump-calendar-anchor" ref={jumpCalendarWrapRef}>
                  <button
                    className={`icon-btn jump-to-time-btn ${showJumpPopover ? 'active' : ''}`}
                    onClick={handleToggleJumpPopover}
                    title="跳转到指定时间"
                  >
                    <Calendar size={18} />
                  </button>
                </div>
                {showJumpPopover && createPortal(
                  <div
                    ref={jumpPopoverPortalRef}
                    style={{
                      position: 'fixed',
                      top: jumpPopoverPosition.top,
                      left: jumpPopoverPosition.left,
                      zIndex: 3600
                    }}
                  >
                    <JumpToDatePopover
                      isOpen={showJumpPopover}
                      currentDate={jumpPopoverDate}
                      onClose={() => setShowJumpPopover(false)}
                      onSelect={handleJumpDateSelect}
                      messageDates={messageDates}
                      hasLoadedMessageDates={hasLoadedMessageDates}
                      messageDateCounts={messageDateCounts}
                      loadingDates={loadingDates}
                      loadingDateCounts={loadingDateCounts}
                      style={{ position: 'static', top: 'auto', right: 'auto' }}
                    />
                  </div>,
                  document.body
                )}
                <button
                  className="icon-btn refresh-messages-btn"
                  onClick={handleRefreshMessages}
                  disabled={isRefreshingMessages || isLoadingMessages}
                  title="刷新消息"
                >
                  <RefreshCw size={18} className={isRefreshingMessages ? 'spin' : ''} />
                </button>
                {!shouldHideStandaloneDetailButton && (
                  <button
                    className={`icon-btn detail-btn ${showDetailPanel ? 'active' : ''}`}
                    onClick={toggleDetailPanel}
                    title="会话详情"
                  >
                    <Info size={18} />
                  </button>
                )}
              </div>
            </div>

            {isPreparingExportDialog && exportPrepareHint && (
              <div className="export-prepare-hint" role="status" aria-live="polite">
                <Loader2 size={14} className="spin" />
                <span>{exportPrepareHint}</span>
              </div>
            )}

            <ContactSnsTimelineDialog
              target={chatSnsTimelineTarget}
              onClose={() => setChatSnsTimelineTarget(null)}
            />

            <div className={`message-content-wrapper ${hasInitialMessages ? 'loaded' : 'loading'} ${isSessionSwitching ? 'switching' : ''}`}>
              {standaloneSessionWindow && standaloneLoadStage !== 'ready' && (
                <div className="standalone-phase-overlay" role="status" aria-live="polite">
                  <Loader2 size={22} className="spin" />
                  <span>{standaloneLoadStage === 'connecting' ? '正在建立连接...' : '正在加载最近消息...'}</span>
                  {connectionError && <small>{connectionError}</small>}
                </div>
              )}
              {isLoadingMessages && (!hasInitialMessages || isSessionSwitching) && (
                <div className="loading-messages loading-overlay">
                  <Loader2 size={24} />
                  <span>{isSessionSwitching ? '切换会话中...' : '加载消息中...'}</span>
                </div>
              )}
              <div
                className={`message-list ${hasInitialMessages ? 'loaded' : 'loading'}`}
                ref={messageListRef}
                onScroll={handleScroll}
              >
                {hasMoreMessages && (
                  <div className={`load-more-trigger ${isLoadingMore ? 'loading' : ''}`}>
                    {isLoadingMore ? (
                      <>
                        <Loader2 size={14} />
                        <span>加载更多...</span>
                      </>
                    ) : (
                      <span>向上滚动加载更多</span>
                    )}
                  </div>
                )}

                {!isLoadingMessages && messages.length === 0 && !hasMoreMessages && (
                  <div className="empty-chat-inline">
                    <MessageSquare size={32} />
                    <span>该联系人没有聊天记录</span>
                  </div>
                )}

                {(messages || []).map((msg, index) => {
                  const prevMsg = index > 0 ? messages[index - 1] : undefined
                  const showDateDivider = shouldShowDateDivider(msg, prevMsg)

                  // 显示时间:第一条消息,或者与上一条消息间隔超过5分钟
                  const showTime = !prevMsg || (msg.createTime - prevMsg.createTime > 300)
                  const isSent = msg.isSend === 1
                  const isSystem = isSystemMessage(msg.localType)

                  // 系统消息居中显示
                  const wrapperClass = isSystem ? 'system' : (isSent ? 'sent' : 'received')

                  const messageKey = getMessageKey(msg)
                  return (
                    <div key={messageKey} className={`message-wrapper ${wrapperClass} ${highlightedMessageSet.has(messageKey) ? 'new-message' : ''}`}>
                      {showDateDivider && (
                        <div className="date-divider">
                          <span>{formatDateDivider(msg.createTime)}</span>
                        </div>
                      )}
                      <MessageBubble
                        message={msg}
                        session={currentSession}
                        showTime={!showDateDivider && showTime}
                        myAvatarUrl={myAvatarUrl}
                        isGroupChat={isCurrentSessionGroup}
                        autoTranscribeVoice={autoTranscribeVoice}
                        onRequireVoiceModel={handleRequireVoiceModel}
                        onContextMenu={handleContextMenu}
                        isSelectionMode={isSelectionMode}
                        isSelected={selectedMessages.has(msg.localId)}
                        onToggleSelection={handleToggleSelection}
                      />
                    </div>
                  )
                })}

                {hasMoreLater && (
                  <div className={`load-more-trigger later ${isLoadingMore ? 'loading' : ''}`}>
                    {isLoadingMore ? (
                      <>
                        <Loader2 size={14} />
                        <span>正在加载后续消息...</span>
                      </>
                    ) : (
                      <span>向下滚动查看更新消息</span>
                    )}
                  </div>
                )}

                {/* 回到底部按钮 */}
                <div className={`scroll-to-bottom ${showScrollToBottom ? 'show' : ''}`} onClick={scrollToBottom}>
                  <ChevronDown size={16} />
                  <span>回到底部</span>
                </div>
              </div>

              {/* 群成员面板 */}
              <GroupMembersPanel
                open={showGroupMembersPanel && isCurrentSessionGroup}
                totalCount={groupPanelMembers.length}
                searchKeyword={groupMemberSearchKeyword}
                onSearchKeywordChange={setGroupMemberSearchKeyword}
                isRefreshing={isRefreshingGroupMembers}
                error={groupMembersError}
                allMembersCount={groupPanelMembers.length}
                filteredMembers={filteredGroupPanelMembers}
                isLoading={isLoadingGroupMembers}
                loadingHint={groupMembersLoadingHint}
                onClose={() => setShowGroupMembersPanel(false)}
              />

              {/* 会话详情面板 */}
              <SessionDetailPanel
                open={showDetailPanel}
                sessionDetail={sessionDetail}
                isLoadingDetail={isLoadingDetail}
                isLoadingDetailExtra={isLoadingDetailExtra}
                isRefreshingDetailStats={isRefreshingDetailStats}
                isLoadingRelationStats={isLoadingRelationStats}
                copiedField={copiedField}
                onCopyField={handleCopyField}
                onLoadRelationStats={() => { void loadRelationStats() }}
                onClose={() => setShowDetailPanel(false)}
                formatStatsDateTime={formatYmdHmDateTime}
                formatMessageDate={formatYmdDateFromSeconds}
              />
            </div>
          </>
        ) : (
          <div className="empty-chat">
            <MessageSquare />
            <p>{standaloneSessionWindow ? '会话加载中或暂无会话记录' : '选择一个会话开始查看聊天记录'}</p>
            {standaloneSessionWindow && connectionError && <p className="hint">{connectionError}</p>}
          </div>
        )}
      </div>

      <BatchDateActionModal
        open={showBatchDecryptConfirm}
        icon={<ImageIcon size={20} />}
        title="批量解密图片"
        description="选择要解密的日期（仅显示有图片的日期），然后开始解密。"
        dates={batchImageDates}
        countsByDate={batchImageCountByDate}
        countLabel={(count) => `${count} 张图片`}
        selectedDates={batchImageSelectedDates}
        onClose={() => setShowBatchDecryptConfirm(false)}
        onSelectAll={selectAllBatchImageDates}
        onClearAll={clearAllBatchImageDates}
        onToggleDate={toggleBatchImageDate}
        formatDateLabel={formatBatchDateLabel}
        summaryRows={(
          <>
            <div className="info-item">
              <span className="label">已选:</span>
              <span className="value">{batchImageSelectedDates.size} 天，共 {batchImageSelectedCount} 张图片</span>
            </div>
            <div className="info-item">
              <span className="label">并发数:</span>
              <div className="batch-concurrency-field">
                <button
                  type="button"
                  className={`batch-concurrency-trigger ${showConcurrencyDropdown ? 'open' : ''}`}
                  onClick={() => setShowConcurrencyDropdown(!showConcurrencyDropdown)}
                >
                  <span>{batchDecryptConcurrency === 1 ? '1（最慢，最稳）' : batchDecryptConcurrency === 6 ? '6（推荐）' : batchDecryptConcurrency === 20 ? '20（最快，可能卡顿）' : String(batchDecryptConcurrency)}</span>
                  <ChevronDown size={14} />
                </button>
                {showConcurrencyDropdown && (
                  <div className="batch-concurrency-dropdown">
                    {[
                      { value: 1, label: '1（最慢，最稳）' },
                      { value: 3, label: '3' },
                      { value: 6, label: '6（推荐）' },
                      { value: 10, label: '10' },
                      { value: 20, label: '20（最快，可能卡顿）' }
                    ].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`batch-concurrency-option ${batchDecryptConcurrency === opt.value ? 'active' : ''}`}
                        onClick={() => {
                          setBatchDecryptConcurrency(opt.value)
                          setShowConcurrencyDropdown(false)
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        warningText="批量解密可能需要较长时间，进行中会在右下角显示非阻塞进度浮层。"
        confirmText="开始解密"
        confirmIcon={<ImageIcon size={16} />}
        onConfirm={confirmBatchDecrypt}
      />

      {/* 消息右键菜单 */}
      <ChatContextMenu
        contextMenu={contextMenu}
        onClose={() => setContextMenu(null)}
        onViewInfo={(message) => {
          setShowMessageInfo(message)
          setContextMenu(null)
        }}
      />

      {/* 消息信息弹窗 */}
      <MessageInfoModal
        message={showMessageInfo}
        copiedField={copiedField}
        onClose={() => setShowMessageInfo(null)}
        onCopyField={handleCopyField}
      />

      {showVoiceTranscribeDialog && (
        <VoiceTranscribeDialog
          onClose={() => setShowVoiceTranscribeDialog(false)}
          onDownloadComplete={handleVoiceModelDownloaded}
        />
      )}


      {/* 底部多选操作栏 */}
      {isSelectionMode && (
        <div style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'var(--bg-secondary)', // Use system background
          color: 'var(--text-primary)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          borderRadius: '12px',
          padding: '12px 24px',
          display: 'flex',
          gap: '20px',
          zIndex: 1000,
          alignItems: 'center',
          border: '1px solid var(--border-color)', // Subtle border
          backdropFilter: 'blur(10px)'
        }}>
          <span style={{ fontSize: '14px', fontWeight: 500 }}>已选 {selectedMessages.size} 条</span>
          <div style={{ width: '1px', height: '16px', background: 'var(--border-color)' }}></div>
          <button
            className="btn-secondary"
            onClick={() => {
              setIsSelectionMode(false)
              setSelectedMessages(new Set())
            }}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'transparent',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            取消
          </button>
        </div>
      )}
    </div>
  )
}

// 全局语音播放管理器：同一时间只能播放一条语音
const globalVoiceManager = {
  currentAudio: null as HTMLAudioElement | null,
  currentStopCallback: null as (() => void) | null,
  play(audio: HTMLAudioElement, onStop: () => void) {
    // 停止当前正在播放的语音
    if (this.currentAudio && this.currentAudio !== audio) {
      this.currentAudio.pause()
      this.currentAudio.currentTime = 0
      this.currentStopCallback?.()
    }
    this.currentAudio = audio
    this.currentStopCallback = onStop
  },
  stop(audio: HTMLAudioElement) {
    if (this.currentAudio === audio) {
      this.currentAudio = null
      this.currentStopCallback = null
    }
  },
}

// 前端表情包缓存
const emojiDataUrlCache = new Map<string, string>()
const imageDataUrlCache = new Map<string, string>()
const voiceDataUrlCache = new Map<string, string>()
const voiceTranscriptCache = new Map<string, string>()
const senderAvatarCache = new Map<string, { avatarUrl?: string; displayName?: string }>()
const senderAvatarLoading = new Map<string, Promise<{ avatarUrl?: string; displayName?: string } | null>>()

const normalizeLocalAssetUrl = (value?: string): string | undefined => {
  return toSafeMediaUrl(value)
}

// 消息气泡组件
function MessageBubble({
  message,
  session,
  showTime,
  myAvatarUrl,
  isGroupChat,
  onContextMenu,
  isSelectionMode,
  isSelected,
  onToggleSelection,
  onRequireVoiceModel,
  autoTranscribeVoice
}: {
  message: Message;
  session: ChatSession;
  showTime?: boolean;
  myAvatarUrl?: string;
  isGroupChat?: boolean;
  onContextMenu?: (e: React.MouseEvent, message: Message) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (localId: number, isShiftKey?: boolean) => void;
  onRequireVoiceModel?: (retry: () => void) => void;
  autoTranscribeVoice?: boolean;
}) {
  const isSystem = isSystemMessage(message.localType)
  const isEmoji = message.localType === 47
  const isImage = message.localType === 3
  const isVideo = message.localType === 43
  const isVoice = message.localType === 34
  const isCard = message.localType === 42
  const isCall = message.localType === 50
  const isType49 = message.localType === 49
  const isSent = message.isSend === 1
  const [senderAvatarUrl, setSenderAvatarUrl] = useState<string | undefined>(undefined)
  const [senderName, setSenderName] = useState<string | undefined>(undefined)
  const [emojiError, setEmojiError] = useState(false)
  const [emojiLoading, setEmojiLoading] = useState(false)

  // State variables...
  const [imageError, setImageError] = useState(false)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageHasUpdate, setImageHasUpdate] = useState(false)
  const [imageIsThumb, setImageIsThumb] = useState(false)
  const [imageClicked, setImageClicked] = useState(false)
  const imageUpdateCheckedRef = useRef<string | null>(null)
  const imageClickTimerRef = useRef<number | null>(null)
  const imageContainerRef = useRef<HTMLDivElement>(null)
  const imageAutoDecryptTriggered = useRef(false)
  const imageAutoHdTriggered = useRef<string | null>(null)
  const [imageInView, setImageInView] = useState(false)
  const imageForceHdAttempted = useRef<string | null>(null)
  const imageForceHdPending = useRef(false)
  const [imageLiveVideoPath, setImageLiveVideoPath] = useState<string | undefined>(undefined)
  const [voiceError, setVoiceError] = useState(false)
  const [voiceLoading, setVoiceLoading] = useState(false)
  const [isVoicePlaying, setIsVoicePlaying] = useState(false)
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null)
  const [voiceCurrentTime, setVoiceCurrentTime] = useState(0)
  const [voiceDuration, setVoiceDuration] = useState(0)
  const [voiceWaveform, setVoiceWaveform] = useState<number[]>([])
  const voiceAutoDecryptTriggered = useRef(false)
  const voiceTranscriptKey = message.createTime
    ? `${session.username}_${message.createTime}`
    : `${session.username}_${message.localId}`
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(
    () => voiceTranscriptCache.get(voiceTranscriptKey) || null
  )
  const [voiceTranscribing, setVoiceTranscribing] = useState(false)
  const [voiceTranscribeError, setVoiceTranscribeError] = useState<string | null>(null)
  const voiceAutoTranscribeTriggered = useRef(false)

  // 转账消息双方名称
  const [transferPayerName, setTransferPayerName] = useState<string | undefined>(undefined)
  const [transferReceiverName, setTransferReceiverName] = useState<string | undefined>(undefined)

  // 视频相关状态
  const [videoLoading, setVideoLoading] = useState(false)
  const [videoInfo, setVideoInfo] = useState<{ videoUrl?: string; coverUrl?: string; thumbUrl?: string; exists: boolean } | null>(null)
  const videoContainerRef = useRef<HTMLElement>(null)
  const [isVideoVisible, setIsVideoVisible] = useState(false)
  const [videoMd5, setVideoMd5] = useState<string | null>(null)

  // 解析视频 MD5
  useEffect(() => {
    if (!isVideo) return





    // 优先使用数据库中的 videoMd5
    if (message.videoMd5) {

      setVideoMd5(message.videoMd5)
      return
    }

    // 尝试从多个可能的字段获取原始内容
    const contentToUse = message.content || (message as any).rawContent || message.parsedContent
    if (contentToUse) {

      video.parseVideoMd5(contentToUse).then((result: { success: boolean; md5?: string; error?: string }) => {

        if (result && result.success && result.md5) {

          setVideoMd5(result.md5)
        } else {
          if (SHOULD_LOG_CHAT_DEBUG) logger.error('[Video Debug] Failed to parse MD5:', result)
        }
      }).catch((err: unknown) => {
        if (SHOULD_LOG_CHAT_DEBUG) logger.error('[Video Debug] Parse error:', err)
      })
    }
  }, [isVideo, message.videoMd5, message.content, message.parsedContent])

  // 从缓存获取表情包 data URL
  const cacheKey = message.emojiMd5 || message.emojiCdnUrl || ''
  const [emojiLocalPath, setEmojiLocalPath] = useState<string | undefined>(
    () => normalizeLocalAssetUrl(emojiDataUrlCache.get(cacheKey) || message.emojiLocalPath)
  )
  const imageCacheKey = message.imageMd5 || message.imageDatName || `local:${message.localId}`
  const [imageLocalPath, setImageLocalPath] = useState<string | undefined>(
    () => imageDataUrlCache.get(imageCacheKey)
  )
  const voiceCacheKey = `voice:${message.localId}`
  const [voiceDataUrl, setVoiceDataUrl] = useState<string | undefined>(
    () => voiceDataUrlCache.get(voiceCacheKey)
  )

  const requestVoiceTranscript = useCallback(async () => {
    if (!isVoice || voiceTranscribing) return
    setVoiceTranscribing(true)
    setVoiceTranscribeError(null)
    try {
      const result = await chat.getVoiceTranscript(
        session.username,
        String(message.localId),
        message.createTime
      )
      if (result.success && result.transcript) {
        voiceTranscriptCache.set(voiceTranscriptKey, result.transcript)
        setVoiceTranscript(result.transcript)
      } else {
        const errorText = result.error || '转写失败'
        setVoiceTranscribeError(errorText)
        if (errorText.includes('模型文件不存在') && onRequireVoiceModel) {
          onRequireVoiceModel(() => { void requestVoiceTranscript() })
        }
      }
    } catch (error) {
      setVoiceTranscribeError(String(error))
    } finally {
      setVoiceTranscribing(false)
    }
  }, [isVoice, voiceTranscribing, session.username, message.localId, message.createTime, voiceTranscriptKey, onRequireVoiceModel])

  useEffect(() => {
    if (!isVoice || !autoTranscribeVoice) return
    if (voiceAutoTranscribeTriggered.current) return
    if (voiceTranscript) return
    voiceAutoTranscribeTriggered.current = true
    void requestVoiceTranscript()
  }, [isVoice, autoTranscribeVoice, voiceTranscript, requestVoiceTranscript])

    const detectImageMimeFromBase64 = useCallback((base64: string): string => {
    try {
      const head = window.atob(base64.slice(0, 48))
      const bytes = new Uint8Array(head.length)
      for (let i = 0; i < head.length; i++) {
        bytes[i] = head.charCodeAt(i)
      }
      if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
      if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png'
      if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg'
      if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return 'image/webp'
      }
    } catch { }
    return 'image/jpeg'
  }, [])


  // 下载表情包
  const downloadEmoji = () => {
    if (!message.emojiCdnUrl || emojiLoading) return

    // 先检查缓存
    const cached = emojiDataUrlCache.get(cacheKey)
    if (cached) {
      setEmojiLocalPath(normalizeLocalAssetUrl(cached))
      setEmojiError(false)
      return
    }

    setEmojiLoading(true)
    setEmojiError(false)
    chat.downloadEmoji(message.emojiCdnUrl, message.emojiMd5).then((result: { success: boolean; localPath?: string; error?: string }) => {
      if (result.success && result.localPath) {
        const normalizedPath = normalizeLocalAssetUrl(result.localPath)
        if (normalizedPath) {
          emojiDataUrlCache.set(cacheKey, normalizedPath)
          setEmojiLocalPath(normalizedPath)
        } else {
          setEmojiError(true)
        }
      } else {
        setEmojiError(true)
      }
    }).catch(() => {
      setEmojiError(true)
    }).finally(() => {
      setEmojiLoading(false)
    })
  }

  // 群聊中获取发送者信息 (如果自己发的没头像，也尝试拉取)
  useEffect(() => {
    if (message.senderUsername && (isGroupChat || (isSent && !myAvatarUrl))) {
      const sender = message.senderUsername
      const cached = senderAvatarCache.get(sender)
      if (cached) {
        setSenderAvatarUrl(cached.avatarUrl)
        setSenderName(cached.displayName)
        return
      }
      const pending = senderAvatarLoading.get(sender)
      if (pending) {
        pending.then((result: { avatarUrl?: string; displayName?: string } | null) => {
          if (result) {
            setSenderAvatarUrl(result.avatarUrl)
            setSenderName(result.displayName)
          }
        })
        return
      }
      const request = chat.getContactAvatar(sender)
      senderAvatarLoading.set(sender, request)
      request.then((result: { avatarUrl?: string; displayName?: string } | null) => {
        if (result) {
          senderAvatarCache.set(sender, result)
          setSenderAvatarUrl(result.avatarUrl)
          setSenderName(result.displayName)
        }
      }).catch(() => { }).finally(() => {
        senderAvatarLoading.delete(sender)
      })
    }
  }, [isGroupChat, isSent, message.senderUsername, myAvatarUrl])

  // 解析转账消息的付款方和收款方显示名称
  useEffect(() => {
    const payerWxid = (message as any).transferPayerUsername
    const receiverWxid = (message as any).transferReceiverUsername
    if (!payerWxid && !receiverWxid) return
    // 仅对转账消息类型处理
    if (message.localType !== 49 && message.localType !== 8589934592049) return

    chat.resolveTransferDisplayNames(
      session.username,
      payerWxid || '',
      receiverWxid || ''
    ).then((result: { payerName: string; receiverName: string }) => {
      if (result) {
        setTransferPayerName(result.payerName)
        setTransferReceiverName(result.receiverName)
      }
    }).catch(() => { })
  }, [(message as any).transferPayerUsername, (message as any).transferReceiverUsername, session.username])

  // 自动下载表情包
  useEffect(() => {
    if (emojiLocalPath) return
    // 后端已从本地缓存找到文件（转发表情包无 CDN URL 的情况）
    if (isEmoji && message.emojiLocalPath && !emojiLocalPath) {
      setEmojiLocalPath(normalizeLocalAssetUrl(message.emojiLocalPath))
      return
    }
    if (isEmoji && message.emojiCdnUrl && !emojiLoading && !emojiError) {
      downloadEmoji()
    }
  }, [isEmoji, message.emojiCdnUrl, message.emojiLocalPath, emojiLocalPath, emojiLoading, emojiError])

  const requestImageDecrypt = useCallback(async (forceUpdate = false, silent = false) => {
    if (!isImage) return
    if (imageLoading) return
    if (!silent) {
      setImageLoading(true)
      setImageError(false)
    }
    try {
      const applyImageResult = (result: { success: boolean; localPath?: string; liveVideoPath?: string; isThumb?: boolean; hasUpdate?: boolean }) => {
        if (!result.success || !result.localPath) return false
        imageDataUrlCache.set(imageCacheKey, result.localPath)
        setImageLocalPath(result.localPath)
        setImageHasUpdate(Boolean(result.hasUpdate))
        setImageIsThumb(Boolean(result.isThumb))
        if (result.liveVideoPath) setImageLiveVideoPath(result.liveVideoPath)
        return true
      }

      const decryptImage = (force: boolean) => image.decrypt({
        sessionId: session.username,
        imageMd5: message.imageMd5 || undefined,
        imageDatName: message.imageDatName,
        force
      })

      if (message.imageMd5 || message.imageDatName) {
        if (!forceUpdate) {
          const hdResult = await decryptImage(true)
          if (applyImageResult({ ...hdResult, hasUpdate: false })) {
            return hdResult
          }
        }

        const result = await decryptImage(forceUpdate)
        if (applyImageResult({ ...result, hasUpdate: false })) {
          return result
        }
      }

      const fallback = await chat.getImageData(session.username, String(message.localId))
      if (fallback.success && fallback.data) {
        const mime = detectImageMimeFromBase64(fallback.data)
        const dataUrl = `data:${mime};base64,${fallback.data}`
        imageDataUrlCache.set(imageCacheKey, dataUrl)
        setImageLocalPath(dataUrl)
        setImageHasUpdate(false)
        setImageIsThumb(false)
        return { success: true, localPath: dataUrl } as any
      }
      if (!silent) setImageError(true)
    } catch {
      if (!silent) setImageError(true)
    } finally {
      if (!silent) setImageLoading(false)
    }
    return { success: false } as any
  }, [isImage, imageLoading, message.imageMd5, message.imageDatName, message.localId, session.username, imageCacheKey, detectImageMimeFromBase64])

  const triggerForceHd = useCallback(() => {
    if (!message.imageMd5 && !message.imageDatName) return
    if (imageForceHdAttempted.current === imageCacheKey) return
    if (imageForceHdPending.current) return
    imageForceHdAttempted.current = imageCacheKey
    imageForceHdPending.current = true
    requestImageDecrypt(true, true).finally(() => {
      imageForceHdPending.current = false
    })
  }, [imageCacheKey, message.imageDatName, message.imageMd5, requestImageDecrypt])

  const handleImageClick = useCallback(() => {
    if (imageClickTimerRef.current) {
      window.clearTimeout(imageClickTimerRef.current)
    }
    setImageClicked(true)
    imageClickTimerRef.current = window.setTimeout(() => {
      setImageClicked(false)
    }, 800)
    logger.debug('[UI] image decrypt click (force HD)', {
      sessionId: session.username,
      imageMd5: message.imageMd5,
      imageDatName: message.imageDatName,
      localId: message.localId
    })
    void requestImageDecrypt(true)
  }, [message.imageDatName, message.imageMd5, message.localId, requestImageDecrypt, session.username])

  const handleOpenImageViewer = useCallback(async () => {
    let finalImagePath = imageLocalPath
    let finalLiveVideoPath = imageLiveVideoPath || undefined
    const canResolveImage = Boolean(message.imageMd5 || message.imageDatName)

    const applyResolvedImage = (result?: { success: boolean; localPath?: string; liveVideoPath?: string; isThumb?: boolean; hasUpdate?: boolean }) => {
      if (!result?.success || !result.localPath) return false
      finalImagePath = result.localPath
      finalLiveVideoPath = result.liveVideoPath || finalLiveVideoPath
      imageDataUrlCache.set(imageCacheKey, result.localPath)
      setImageLocalPath(result.localPath)
      if (result.liveVideoPath) setImageLiveVideoPath(result.liveVideoPath)
      if (typeof result.hasUpdate !== 'undefined') setImageHasUpdate(Boolean(result.hasUpdate))
      if (typeof result.isThumb !== 'undefined') setImageIsThumb(Boolean(result.isThumb))
      setImageError(false)
      return true
    }

    if (canResolveImage) {
      try {
        const original = await image.decrypt({
          sessionId: session.username,
          imageMd5: message.imageMd5 || undefined,
          imageDatName: message.imageDatName,
          force: true
        })
        applyResolvedImage({ ...original, hasUpdate: false })
      } catch { }

      try {
        const resolved = await image.resolveCache({
          sessionId: session.username,
          imageMd5: message.imageMd5 || undefined,
          imageDatName: message.imageDatName
        })
        applyResolvedImage(resolved)
      } catch { }
    }

    if (!finalImagePath && canResolveImage) {
      try {
        const fallback = await requestImageDecrypt(false, true)
        applyResolvedImage({ ...fallback, hasUpdate: false })
      } catch { }
    }

    if (!finalImagePath) return
    void windowControl.openImageViewerWindow(finalImagePath, finalLiveVideoPath)
  }, [
    imageLiveVideoPath,
    imageLocalPath,
    imageCacheKey,
    message.imageDatName,
    message.imageMd5,
    requestImageDecrypt,
    session.username
  ])

  useEffect(() => {
    return () => {
      if (imageClickTimerRef.current) {
        window.clearTimeout(imageClickTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isImage || imageLoading) return
    if (!message.imageMd5 && !message.imageDatName) return
    if (imageUpdateCheckedRef.current === imageCacheKey) return
    imageUpdateCheckedRef.current = imageCacheKey
    let cancelled = false
    image.resolveCache({
      sessionId: session.username,
      imageMd5: message.imageMd5 || undefined,
      imageDatName: message.imageDatName
    }).then((result: { success: boolean; localPath?: string; hasUpdate?: boolean; liveVideoPath?: string; isThumb?: boolean; error?: string }) => {
      if (cancelled) return
      if (result.success && result.localPath) {
        imageDataUrlCache.set(imageCacheKey, result.localPath)
        if (!imageLocalPath || imageLocalPath !== result.localPath) {
          setImageLocalPath(result.localPath)
          setImageError(false)
        }
        if (result.liveVideoPath) setImageLiveVideoPath(result.liveVideoPath)
        setImageHasUpdate(Boolean(result.hasUpdate))
        setImageIsThumb(Boolean(result.isThumb))
      }
    }).catch(() => { })
    return () => {
      cancelled = true
    }
  }, [isImage, imageLocalPath, imageLoading, message.imageMd5, message.imageDatName, imageCacheKey, session.username])

  useEffect(() => {
    if (!isImage) return
    const unsubscribe = image.onUpdateAvailable((payload: { cacheKey: string; imageMd5?: string; imageDatName?: string }) => {
      const matchesCacheKey =
        payload.cacheKey === message.imageMd5 ||
        payload.cacheKey === message.imageDatName ||
        (payload.imageMd5 && payload.imageMd5 === message.imageMd5) ||
        (payload.imageDatName && payload.imageDatName === message.imageDatName)
      if (matchesCacheKey) {
        setImageHasUpdate(true)
      }
    })
    return () => {
      unsubscribe?.()
    }
  }, [isImage, message.imageDatName, message.imageMd5])

  useEffect(() => {
    if (!isImage) return
    const unsubscribe = image.onCacheResolved((payload: { cacheKey: string; imageMd5?: string; imageDatName?: string; localPath: string; isThumb?: boolean }) => {
      const matchesCacheKey =
        payload.cacheKey === message.imageMd5 ||
        payload.cacheKey === message.imageDatName ||
        (payload.imageMd5 && payload.imageMd5 === message.imageMd5) ||
        (payload.imageDatName && payload.imageDatName === message.imageDatName)
      if (matchesCacheKey) {
        imageDataUrlCache.set(imageCacheKey, payload.localPath)
        setImageLocalPath(payload.localPath)
        setImageIsThumb(Boolean(payload.isThumb))
        setImageError(false)
      }
    })
    return () => {
      unsubscribe?.()
    }
  }, [isImage, imageCacheKey, message.imageDatName, message.imageMd5])

  // 图片进入视野前自动解密（懒加载）
  useEffect(() => {
    if (!isImage) return
    if (imageLocalPath) return // 已有图片，不需要解密
    if (!message.imageMd5 && !message.imageDatName) return

    const container = imageContainerRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        // rootMargin 设置为 200px，提前触发解密
        if (entry.isIntersecting && !imageAutoDecryptTriggered.current) {
          imageAutoDecryptTriggered.current = true
          void requestImageDecrypt()
        }
      },
      { rootMargin: '200px', threshold: 0 }
    )

    observer.observe(container)
    return () => observer.disconnect()
  }, [isImage, imageLocalPath, message.imageMd5, message.imageDatName, requestImageDecrypt])

  // 进入视野时自动尝试切换高清图
  useEffect(() => {
    if (!isImage) return
    const container = imageContainerRef.current
    if (!container) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        setImageInView(entry.isIntersecting)
      },
      { rootMargin: '120px', threshold: 0 }
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [isImage])

  useEffect(() => {
    if (!isImage || !imageHasUpdate || !imageInView) return
    if (imageAutoHdTriggered.current === imageCacheKey) return
    imageAutoHdTriggered.current = imageCacheKey
    triggerForceHd()
  }, [isImage, imageHasUpdate, imageInView, imageCacheKey, triggerForceHd])

  useEffect(() => {
    if (!isImage || !imageHasUpdate) return
    if (imageAutoHdTriggered.current === imageCacheKey) return
    imageAutoHdTriggered.current = imageCacheKey
    triggerForceHd()
  }, [isImage, imageHasUpdate, imageCacheKey, triggerForceHd])

  // 更激进：进入视野/打开预览时，无论 hasUpdate 与否都尝试强制高清
  useEffect(() => {
    if (!isImage || !imageInView) return
    triggerForceHd()
  }, [isImage, imageInView, triggerForceHd])


  useEffect(() => {
    if (!isVoice) return
    if (!voiceAudioRef.current) {
      voiceAudioRef.current = new Audio()
    }
    const audio = voiceAudioRef.current
    if (!audio) return
    const handlePlay = () => setIsVoicePlaying(true)
    const handlePause = () => setIsVoicePlaying(false)
    const handleEnded = () => {
      setIsVoicePlaying(false)
      setVoiceCurrentTime(0)
      globalVoiceManager.stop(audio)
    }
    const handleTimeUpdate = () => {
      setVoiceCurrentTime(audio.currentTime)
    }
    const handleLoadedMetadata = () => {
      setVoiceDuration(audio.duration)
    }
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    return () => {
      audio.pause()
      globalVoiceManager.stop(audio)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
    }
  }, [isVoice])

  // 生成波形数据
  useEffect(() => {
    if (!voiceDataUrl) {
      setVoiceWaveform([])
      return
    }

    const generateWaveform = async () => {
      try {
        // 从 data:audio/wav;base64,... 提取 base64
        const base64 = voiceDataUrl.split(',')[1]
        const binaryString = window.atob(base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }

        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer)
        const rawData = audioBuffer.getChannelData(0) // 获取单声道数据
        const samples = 35 // 波形柱子数量
        const blockSize = Math.floor(rawData.length / samples)
        const filteredData: number[] = []

        for (let i = 0; i < samples; i++) {
          let blockStart = blockSize * i
          let sum = 0
          for (let j = 0; j < blockSize; j++) {
            sum = sum + Math.abs(rawData[blockStart + j])
          }
          filteredData.push(sum / blockSize)
        }

        // 归一化
        const multiplier = Math.pow(Math.max(...filteredData), -1)
        const normalizedData = filteredData.map(n => n * multiplier)
        setVoiceWaveform(normalizedData)
        void audioCtx.close()
      } catch (e) {
        logger.error('Failed to generate waveform:', e)
        // 降级：生成随机但平滑的波形
        setVoiceWaveform(Array.from({ length: 35 }, () => 0.2 + Math.random() * 0.8))
      }
    }

    void generateWaveform()
  }, [voiceDataUrl])

  // 消息加载时自动检测语音缓存
  useEffect(() => {
    if (!isVoice || voiceDataUrl) return
    chat.resolveVoiceCache(session.username, String(message.localId))
      .then((result: { success: boolean; hasCache: boolean; data?: string; error?: string }) => {
        if (result.success && result.hasCache && result.data) {
          const url = `data:audio/wav;base64,${result.data}`
          voiceDataUrlCache.set(voiceCacheKey, url)
          setVoiceDataUrl(url)
        }
      })
  }, [isVoice, message.localId, session.username, voiceCacheKey, voiceDataUrl])

  // 视频懒加载
  const videoAutoLoadTriggered = useRef(false)
  const [videoClicked, setVideoClicked] = useState(false)

  useEffect(() => {
    if (!isVideo || !videoContainerRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVideoVisible(true)
            observer.disconnect()
          }
        })
      },
      {
        rootMargin: '200px 0px',
        threshold: 0
      }
    )

    observer.observe(videoContainerRef.current)

    return () => observer.disconnect()
  }, [isVideo])

  // 视频加载中状态引用，避免依赖问题
  const videoLoadingRef = useRef(false)

  // 加载视频信息（添加重试机制）
  const requestVideoInfo = useCallback(async () => {
    if (!videoMd5 || videoLoadingRef.current) return

    videoLoadingRef.current = true
    setVideoLoading(true)
    try {
      const result = await video.getVideoInfo(videoMd5)
      if (result && result.success && result.exists) {
        setVideoInfo({
          exists: result.exists,
          videoUrl: result.videoUrl,
          coverUrl: result.coverUrl,
          thumbUrl: result.thumbUrl
        })
      } else {
        setVideoInfo({ exists: false })
      }
    } catch (err) {
      setVideoInfo({ exists: false })
    } finally {
      videoLoadingRef.current = false
      setVideoLoading(false)
    }
  }, [videoMd5])

  // 视频进入视野时自动加载
  useEffect(() => {
    if (!isVideo || !isVideoVisible) return
    if (videoInfo?.exists) return // 已成功加载，不需要重试
    if (videoAutoLoadTriggered.current) return

    videoAutoLoadTriggered.current = true
    void requestVideoInfo()
  }, [isVideo, isVideoVisible, videoInfo, requestVideoInfo])


  // Selection mode handling removed from here to allow normal rendering
  // We will wrap the output instead

  // Regular rendering logic...
  if (isSystem) {
    return (
      <div
        className={`message-bubble system ${isSelectionMode ? 'selectable' : ''}`}
        onContextMenu={(e) => onContextMenu?.(e, message)}
        style={{ cursor: isSelectionMode ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        onClick={(e) => {
          if (isSelectionMode) {
            e.stopPropagation()
            onToggleSelection?.(message.localId, e.shiftKey)
          }
        }}
      >
        {isSelectionMode && (
          <MessageSelectionCheckbox checked={isSelected} />
        )}
        <div className="bubble-content">{message.parsedContent}</div>
      </div>
    )
  }

  // 检测是否为链接卡片消息
  const isLinkMessage = String(message.localType) === '21474836529' ||
    (message.rawContent && (message.rawContent.includes('<appmsg') || message.rawContent.includes('&lt;appmsg'))) ||
    (message.parsedContent && (message.parsedContent.includes('<appmsg') || message.parsedContent.includes('&lt;appmsg')))
  const bubbleClass = isSent ? 'sent' : 'received'

  // 头像逻辑：
  // - 自己发的：优先使用 myAvatarUrl，缺失则用 senderAvatarUrl (补救)
  // - 群聊中对方发的：使用发送者头像
  // - 私聊中对方发的：使用会话头像
  const avatarUrl = isSent
    ? (myAvatarUrl || senderAvatarUrl)
    : (isGroupChat ? senderAvatarUrl : session.avatarUrl)
  const avatarLetter = isSent
    ? '我'
    : getAvatarLetter(isGroupChat ? (senderName || message.senderUsername || '?') : (session.displayName || session.username))


  // 是否有引用消息
  const hasQuote = message.quotedContent && message.quotedContent.length > 0

  // 渲染消息内容
  const renderContent = () => {
    if (isImage) {
      return (
        <MessageImageContent
          imageLoading={imageLoading}
          imageError={imageError}
          imageClicked={imageClicked}
          imageLocalPath={imageLocalPath}
          imageIsThumb={imageIsThumb}
          imageHasUpdate={imageHasUpdate}
          imageLiveVideoPath={imageLiveVideoPath}
          containerRef={imageContainerRef}
          onRetryDecrypt={handleImageClick}
          onOpenImage={handleOpenImageViewer}
          onLoad={() => setImageError(false)}
          onError={() => setImageError(true)}
        />
      )
    }
    // 视频消息
    if (isVideo) {
      const handlePlayVideo = async () => {
        if (!videoInfo?.videoUrl) return
        try {
          await windowControl.openVideoPlayerWindow(videoInfo.videoUrl)
        } catch (error) {
          logger.error('打开视频播放窗口失败:', error)
        }
      }

      return (
        <MessageVideoContent
          isVideoVisible={isVideoVisible}
          videoLoading={videoLoading}
          videoClicked={videoClicked}
          videoInfo={videoInfo}
          containerRef={videoContainerRef}
          onRetryLoad={() => {
            setVideoClicked(true)
            setTimeout(() => setVideoClicked(false), 800)
            videoAutoLoadTriggered.current = false
            void requestVideoInfo()
          }}
          onPlay={handlePlayVideo}
        />
      )
    }
    if (isVoice) {
      const durationText = message.voiceDurationSeconds ? `${message.voiceDurationSeconds}"` : ''
      const handleToggle = async () => {
        if (voiceLoading) return
        const audio = voiceAudioRef.current || new Audio()
        if (!voiceAudioRef.current) {
          voiceAudioRef.current = audio
        }
        if (isVoicePlaying) {
          audio.pause()
          audio.currentTime = 0
          globalVoiceManager.stop(audio)
          return
        }
        if (!voiceDataUrl) {
          setVoiceLoading(true)
          setVoiceError(false)
          try {
            const result = await chat.getVoiceData(
              session.username,
              String(message.localId),
              message.createTime,
              message.serverId
            )
            if (result.success && result.data) {
              const url = `data:audio/wav;base64,${result.data}`
              voiceDataUrlCache.set(voiceCacheKey, url)
              setVoiceDataUrl(url)
            } else {
              setVoiceError(true)
              return
            }
          } catch {
            setVoiceError(true)
            return
          } finally {
            setVoiceLoading(false)
          }
        }
        const source = voiceDataUrlCache.get(voiceCacheKey) || voiceDataUrl
        if (!source) {
          setVoiceError(true)
          return
        }
        audio.src = source
        try {
          globalVoiceManager.play(audio, () => {
            audio.pause()
            audio.currentTime = 0
          })
          await audio.play()
        } catch {
          setVoiceError(true)
        }
      }

      const handleSeek = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!voiceDataUrl || !voiceAudioRef.current) return
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        const x = event.clientX - rect.left
        const percentage = x / rect.width
        const newTime = percentage * voiceDuration
        voiceAudioRef.current.currentTime = newTime
        setVoiceCurrentTime(newTime)
      }

      return (
        <div className="voice-message-stack">
          <MessageVoiceContent
            isVoicePlaying={isVoicePlaying}
            voiceLoading={voiceLoading}
            voiceError={voiceError}
            voiceDataUrl={voiceDataUrl}
            voiceWaveform={voiceWaveform}
            voiceCurrentTime={voiceCurrentTime}
            voiceDuration={voiceDuration}
            isSent={isSent}
            durationText={durationText}
            onToggle={handleToggle}
            onSeek={handleSeek}
          />
          <div className="voice-transcribe-row">
            <button
              className="voice-transcribe-btn"
              type="button"
              onClick={() => void requestVoiceTranscript()}
              disabled={voiceTranscribing}
              title={voiceTranscribing ? '转写中...' : (voiceTranscript ? '重新转写' : '语音转文字')}
            >
              {voiceTranscribing ? <Loader2 size={14} className="spin" /> : <Mic size={14} />}
            </button>
            <span className="voice-transcribe-status">
              {voiceTranscribing ? '转写中...' : (voiceTranscript ? '已转写' : '转文字')}
            </span>
            {voiceTranscribeError && <span className="voice-transcribe-error">{voiceTranscribeError}</span>}
          </div>
          {voiceTranscript && (
            <div className="voice-transcript">{voiceTranscript}</div>
          )}
        </div>
      )
    }
    // 名片消息
    if (isCard) {
      const cardName = message.cardNickname || message.cardUsername || '未知联系人'
      const cardAvatar = message.cardAvatarUrl
      return (
        <div className="card-message">
          <div className="card-icon">
            {cardAvatar ? (
              <AvatarImage src={cardAvatar} name={cardName} alt="" loading="eager" />
            ) : (
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            )}
          </div>
          <div className="card-info">
            <div className="card-name">{cardName}</div>
            {message.cardUsername && message.cardUsername !== message.cardNickname && (
              <div className="card-wxid">微信号: {message.cardUsername}</div>
            )}
            <div className="card-label">个人名片</div>
          </div>
        </div>
      )
    }

    // 通话消息
    if (isCall) {
      return (
        <div className="bubble-content">
          <div className="call-message">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <span>{message.parsedContent || '[通话]'}</span>
          </div>
        </div>
      )
    }

    // 位置消息
    if (message.localType === 48) {
      const raw = message.rawContent || ''
      const poiname = raw.match(/poiname="([^"]*)"/)?.[1] || message.locationPoiname || '位置'
      const label = raw.match(/label="([^"]*)"/)?.[1] || message.locationLabel || ''
      const lat = parseFloat(raw.match(/x="([^"]*)"/)?.[1] || String(message.locationLat || 0))
      const lng = parseFloat(raw.match(/y="([^"]*)"/)?.[1] || String(message.locationLng || 0))
      const hasCoordinate = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)
      const coordinateText = hasCoordinate ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : '坐标不可用'
      return (
        <div className="location-message" onClick={() => shell.openExternal(`https://uri.amap.com/marker?position=${lng},${lat}&name=${encodeURIComponent(poiname || label)}`)}>
          <div className="location-text">
            <div className="location-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <div className="location-info">
              {poiname && <div className="location-name">{poiname}</div>}
              {label && <div className="location-label">{label}</div>}
            </div>
          </div>
          <div className="location-map" aria-hidden="true">
            <div className="location-map-placeholder">
              <div className="location-map-grid" />
              <div className="location-map-pin">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <div className="location-map-coordinates">{coordinateText}</div>
            </div>
          </div>
        </div>
      )
    }

    const appMsgRichPreview = renderAppMessageRichPreview(message)

    if (appMsgRichPreview) {
      return appMsgRichPreview
    }


    const fallbackContent = (
      <MessageFallbackContent
        parsedContent={message.parsedContent}
        quotedContent={hasQuote ? (message.quotedContent || '') : undefined}
        quotedSender={message.quotedSender || undefined}
      />
    )

    const isAppMsg = message.rawContent?.includes('<appmsg') || (message.parsedContent && message.parsedContent.includes('<appmsg'))
    if (isAppMsg) {
      return (
        <AppMessageBubble
          message={message}
          sessionId={session.username}
          transferPayerName={transferPayerName}
          transferReceiverName={transferReceiverName}
          debugEnabled={SHOULD_LOG_CHAT_DEBUG}
          fallbackContent={fallbackContent}
        />
      )
    }

    // 表情包消息
    if (isEmoji) {
      // ... (keep existing emoji logic)
      // 没有 cdnUrl 或加载失败，显示占位符
      if ((!message.emojiCdnUrl && !message.emojiLocalPath) || emojiError) {
        return (
          <div className="emoji-unavailable">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 15s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
            <span>表情包未缓存</span>
          </div>
        )
      }

      // 显示加载中
      if (emojiLoading || !emojiLocalPath) {
        return (
          <div className="emoji-loading">
            <Loader2 size={20} className="spin" />
          </div>
        )
      }

      // 显示表情图片
      return (
        <img
          src={emojiLocalPath}
          alt="表情"
          className="emoji-image"
          onError={() => setEmojiError(true)}
        />
      )
    }

    // 解析引用消息（Links / App Messages）
    // localType: 21474836529 corresponds to AppMessage which often contains links

    return fallbackContent
  }

  return (
    <>
      {showTime && (
        <div className="time-divider">
          <span>{formatMessageBubbleTime(message.createTime)}</span>
        </div>
      )}
      <div
        className={`message-wrapper-with-selection ${isSelectionMode ? 'selectable' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          width: '100%',
          justifyContent: isSent ? 'flex-end' : 'flex-start',
          cursor: isSelectionMode ? 'pointer' : 'default'
        }}
        onClick={(e) => {
          if (isSelectionMode) {
            e.stopPropagation()
            onToggleSelection?.(message.localId, e.shiftKey)
          }
        }}
      >
        {isSelectionMode && !isSent && (
          <MessageSelectionCheckbox checked={isSelected} style={{ marginRight: '12px', marginTop: '10px' }} />
        )}

        <div className={`message-bubble ${bubbleClass} ${isEmoji && message.emojiCdnUrl && !emojiError ? 'emoji' : ''} ${isImage ? 'image' : ''} ${isVoice ? 'voice' : ''}`}
          onContextMenu={(e) => onContextMenu?.(e, message)}
        >
          <div className="bubble-avatar">
            <Avatar
              src={avatarUrl}
              name={!isSent ? (isGroupChat ? (senderName || message.senderUsername || '?') : (session.displayName || session.username)) : '我'}
              size={36}
              className="bubble-avatar"
            />
          </div>
          <div className="bubble-body">
            {/* 群聊中显示发送者名称 */}
            {isGroupChat && !isSent && (
              <div className="sender-name">
                {senderName || message.senderUsername || '群成员'}
              </div>
            )}
            {renderContent()}
          </div>
        </div>

        {isSelectionMode && isSent && (
          <MessageSelectionCheckbox checked={isSelected} style={{ marginLeft: '12px', marginTop: '10px' }} />
        )}
      </div>
    </>
  )
}

export default ChatPage
