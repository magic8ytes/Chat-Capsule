import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from 'react'
import { RefreshCw, Search, X, Download, FolderOpen, FileJson, FileText, Image, Calendar, Info, Loader2, Shield, CheckCircle, AlertCircle } from 'lucide-react'
import './SnsPage.scss'
import { SnsPost } from '../types/sns'
import { SnsPostItem } from '../components/Sns/SnsPostItem'
import { SnsFilterPanel } from '../components/Sns/SnsFilterPanel'
import { ContactSnsTimelineDialog } from '../components/Sns/ContactSnsTimelineDialog'
import { SnsProtectionDialog } from '../components/Sns/SnsProtectionDialog'
import type { ContactSnsTimelineTarget } from '../components/Sns/contactSnsTimeline'
import JumpToDatePopover from '../components/JumpToDatePopover'
import { ExportDateRangeDialog } from '../components/Export/ExportDateRangeDialog'
import * as configService from '../services/config'
import { chat, electronApi, shell, sns, windowControl } from '../services/ipc'
import { usePlatformStore } from '../stores/platformStore'
import { createLogger } from '../utils/logger'
import { decodeHtmlEntities, formatDateOnly, isLikelyBrokenCachedSnsPost, normalizePostCountValue, toDateKey, toMonthKey } from './sns/snsPageSupport'
import { normalizeAccountId, readSidebarUserProfileCache, type SidebarUserProfile } from '../utils/sidebarUserProfileCache'
import {
    createExportDateRangeSelectionFromPreset,
    getExportDateRangeLabel,
    type ExportDateRangeSelection
} from '../utils/exportDateRange'

const SNS_PAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const SNS_PAGE_CACHE_POST_LIMIT = 200
const SNS_PAGE_CACHE_SCOPE_FALLBACK = '__default__'
const CONTACT_COUNT_SORT_DEBOUNCE_MS = 200
const CONTACT_COUNT_BATCH_SIZE = 10

type ContactPostCountStatus = 'idle' | 'loading' | 'ready'

interface Contact {
    username: string
    displayName: string
    avatarUrl?: string
    remark?: string
    nickname?: string
    type?: 'friend' | 'former_friend' | 'sns_only'
    lastSessionTimestamp?: number
    postCount?: number
    postCountStatus?: ContactPostCountStatus
}

interface ContactsCountProgress {
    resolved: number
    total: number
    running: boolean
}

interface SnsOverviewStats {
    totalPosts: number
    totalFriends: number
    myPosts: number | null
    earliestTime: number | null
    latestTime: number | null
}

type OverviewStatsStatus = 'loading' | 'ready' | 'error'

const normalizeNameForCompare = (value?: string | null): string => String(value || '').trim().toLowerCase()



export default function SnsPage() {
    const logger = createLogger('SnsPage')
    const capabilities = usePlatformStore(state => state.capabilities)
    const supportsSnsProtection = capabilities?.snsMutation === true
    const [posts, setPosts] = useState<SnsPost[]>([])
    const [loading, setLoading] = useState(false)
    const [hasMore, setHasMore] = useState(true)
    const loadingRef = useRef(false)
    const [overviewStats, setOverviewStats] = useState<SnsOverviewStats>({
        totalPosts: 0,
        totalFriends: 0,
        myPosts: null,
        earliestTime: null,
        latestTime: null
    })
    const [overviewStatsStatus, setOverviewStatsStatus] = useState<OverviewStatsStatus>('loading')

    // Filter states
    const [searchKeyword, setSearchKeyword] = useState('')
    const [jumpTargetDate, setJumpTargetDate] = useState<Date | undefined>(undefined)

    // Contacts state
    const [contacts, setContacts] = useState<Contact[]>([])
    const [contactSearch, setContactSearch] = useState('')
    const [contactsLoading, setContactsLoading] = useState(false)
    const [contactsCountProgress, setContactsCountProgress] = useState<ContactsCountProgress>({
        resolved: 0,
        total: 0,
        running: false
    })
    const [currentUserProfile, setCurrentUserProfile] = useState<SidebarUserProfile>(() => readSidebarUserProfileCache() || {
        wxid: '',
        displayName: ''
    })

    // UI states
    const [authorTimelineTarget, setAuthorTimelineTarget] = useState<ContactSnsTimelineTarget | null>(null)
    const [showJumpPopover, setShowJumpPopover] = useState(false)
    const [jumpPopoverDate, setJumpPopoverDate] = useState<Date>(jumpTargetDate || new Date())
    const [jumpDateCounts, setJumpDateCounts] = useState<Record<string, number>>({})
    const [jumpDateMessageDates, setJumpDateMessageDates] = useState<Set<string>>(new Set())
    const [hasLoadedJumpDateCounts, setHasLoadedJumpDateCounts] = useState(false)
    const [loadingJumpDateCounts, setLoadingJumpDateCounts] = useState(false)

    // 导出相关状态
    const [showExportDialog, setShowExportDialog] = useState(false)
    const [exportFormat, setExportFormat] = useState<'json' | 'html' | 'arkmejson'>('html')
    const [exportFolder, setExportFolder] = useState('')
    const [exportImages, setExportImages] = useState(false)
    const [exportLivePhotos, setExportLivePhotos] = useState(false)
    const [exportVideos, setExportVideos] = useState(false)
    const [exportDateRangeSelection, setExportDateRangeSelection] = useState<ExportDateRangeSelection>(
        () => createExportDateRangeSelectionFromPreset('all')
    )
    const [isExporting, setIsExporting] = useState(false)
    const [exportProgress, setExportProgress] = useState<{ current: number; total: number; status: string } | null>(null)
    const [exportResult, setExportResult] = useState<{ success: boolean; filePath?: string; postCount?: number; mediaCount?: number; error?: string } | null>(null)
    const [refreshSpin, setRefreshSpin] = useState(false)
    const [isExportDateRangeDialogOpen, setIsExportDateRangeDialogOpen] = useState(false)

    // 触发器相关状态
    const [showTriggerDialog, setShowTriggerDialog] = useState(false)
    const [triggerInstalled, setTriggerInstalled] = useState<boolean | null>(null)
    const [triggerLoading, setTriggerLoading] = useState(false)
    const [triggerMessage, setTriggerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    const postsContainerRef = useRef<HTMLDivElement>(null)
    const jumpCalendarWrapRef = useRef<HTMLDivElement | null>(null)
    const [hasNewer, setHasNewer] = useState(false)
    const [loadingNewer, setLoadingNewer] = useState(false)
    const postsRef = useRef<SnsPost[]>([])
    const contactsRef = useRef<Contact[]>([])
    const overviewStatsRef = useRef<SnsOverviewStats>(overviewStats)
    const overviewStatsStatusRef = useRef<OverviewStatsStatus>(overviewStatsStatus)
    const searchKeywordRef = useRef(searchKeyword)
    const jumpTargetDateRef = useRef<Date | undefined>(jumpTargetDate)
    const cacheScopeKeyRef = useRef('')
    const snsUserPostCountsCacheScopeKeyRef = useRef('')
    const scrollAdjustmentRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
    const contactsLoadTokenRef = useRef(0)
    const contactsCountHydrationTokenRef = useRef(0)
    const contactsCountBatchTimerRef = useRef<number | null>(null)
    const jumpDateCountsCacheRef = useRef<Map<string, Record<string, number>>>(new Map())
    const jumpDateRequestSeqRef = useRef(0)

    // Sync posts ref
    useEffect(() => {
        postsRef.current = posts
    }, [posts])
    useEffect(() => {
        contactsRef.current = contacts
    }, [contacts])
    useEffect(() => {
        overviewStatsRef.current = overviewStats
    }, [overviewStats])
    useEffect(() => {
        overviewStatsStatusRef.current = overviewStatsStatus
    }, [overviewStatsStatus])
    useEffect(() => {
        searchKeywordRef.current = searchKeyword
    }, [searchKeyword])
    useEffect(() => {
        jumpTargetDateRef.current = jumpTargetDate
    }, [jumpTargetDate])
    useEffect(() => {
        if (!showJumpPopover) {
            setJumpPopoverDate(jumpTargetDate || new Date())
        }
    }, [jumpTargetDate, showJumpPopover])
    useEffect(() => {
        if (!showJumpPopover) return
        const handleClickOutside = (event: MouseEvent) => {
            if (!jumpCalendarWrapRef.current) return
            if (jumpCalendarWrapRef.current.contains(event.target as Node)) return
            setShowJumpPopover(false)
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [showJumpPopover])
    // 在 DOM 更新后、浏览器绘制前同步调整滚动位置，防止向上加载时页面跳动
    useLayoutEffect(() => {
        const snapshot = scrollAdjustmentRef.current;
        if (snapshot && postsContainerRef.current) {
            const container = postsContainerRef.current;
            const addedHeight = container.scrollHeight - snapshot.scrollHeight;
            if (addedHeight > 0) {
                container.scrollTop = snapshot.scrollTop + addedHeight;
            }
            scrollAdjustmentRef.current = null;
        }
    }, [posts])

    const normalizePostCount = useCallback((value: unknown): number => {
        return normalizePostCountValue(value)
    }, [])

    const applyJumpDateCounts = useCallback((counts: Record<string, number>) => {
        setJumpDateCounts(counts)
        setJumpDateMessageDates(new Set(Object.keys(counts)))
        setHasLoadedJumpDateCounts(true)
    }, [])

    const loadJumpDateCounts = useCallback(async (monthDate: Date) => {
        const monthKey = toMonthKey(monthDate)
        const cached = jumpDateCountsCacheRef.current.get(monthKey)
        if (cached) {
            applyJumpDateCounts(cached)
            setLoadingJumpDateCounts(false)
            return
        }

        const requestSeq = ++jumpDateRequestSeqRef.current
        setLoadingJumpDateCounts(true)
        setHasLoadedJumpDateCounts(false)

        const year = monthDate.getFullYear()
        const month = monthDate.getMonth()
        const monthStart = new Date(year, month, 1, 0, 0, 0, 0)
        const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999)
        const startTime = Math.floor(monthStart.getTime() / 1000)
        const endTime = Math.floor(monthEnd.getTime() / 1000)
        const pageSize = 200
        let offset = 0
        const counts: Record<string, number> = {}

        try {
            while (true) {
                const result = await sns.getTimeline(pageSize, offset, [], '', startTime, endTime)
                if (!result?.success || !Array.isArray(result.timeline) || result.timeline.length === 0) {
                    break
                }
                result.timeline.forEach((post) => {
                    const key = toDateKey(Number(post.createTime || 0))
                    if (!key) return
                    counts[key] = (counts[key] || 0) + 1
                })
                if (result.timeline.length < pageSize) break
                offset += pageSize
            }

            if (requestSeq !== jumpDateRequestSeqRef.current) return
            jumpDateCountsCacheRef.current.set(monthKey, counts)
            applyJumpDateCounts(counts)
        } catch (error) {
            logger.error('加载朋友圈按日条数失败:', error)
            if (requestSeq !== jumpDateRequestSeqRef.current) return
            setJumpDateCounts({})
            setJumpDateMessageDates(new Set())
            setHasLoadedJumpDateCounts(true)
        } finally {
            if (requestSeq === jumpDateRequestSeqRef.current) {
                setLoadingJumpDateCounts(false)
            }
        }
    }, [applyJumpDateCounts, toDateKey, toMonthKey])

    const compareContactsForRanking = useCallback((a: Contact, b: Contact): number => {
        const aReady = a.postCountStatus === 'ready'
        const bReady = b.postCountStatus === 'ready'
        if (aReady && bReady) {
            const countDiff = normalizePostCount(b.postCount) - normalizePostCount(a.postCount)
            if (countDiff !== 0) return countDiff
        } else if (aReady !== bReady) {
            return aReady ? -1 : 1
        }

        const tsDiff = Number(b.lastSessionTimestamp || 0) - Number(a.lastSessionTimestamp || 0)
        if (tsDiff !== 0) return tsDiff
        return (a.displayName || a.username).localeCompare((b.displayName || b.username), 'zh-Hans-CN')
    }, [normalizePostCount])

    const sortContactsForRanking = useCallback((input: Contact[]): Contact[] => {
        return [...input].sort(compareContactsForRanking)
    }, [compareContactsForRanking])

    const resolvedCurrentUserContact = useMemo(() => {
        const normalizedWxid = normalizeAccountId(currentUserProfile.wxid)
        const normalizedAlias = normalizeAccountId(currentUserProfile.alias)
        const normalizedDisplayName = normalizeNameForCompare(currentUserProfile.displayName)

        if (normalizedWxid) {
            const exactByUsername = contacts.find((contact) => normalizeAccountId(contact.username) === normalizedWxid)
            if (exactByUsername) return exactByUsername
        }

        if (normalizedAlias) {
            const exactByAliasLikeName = contacts.find((contact) => {
                const candidates = [contact.displayName, contact.remark, contact.nickname].map(normalizeNameForCompare)
                return candidates.includes(normalizedAlias)
            })
            if (exactByAliasLikeName) return exactByAliasLikeName
        }

        if (!normalizedDisplayName) return null
        return contacts.find((contact) => {
            const candidates = [contact.displayName, contact.remark, contact.nickname].map(normalizeNameForCompare)
            return candidates.includes(normalizedDisplayName)
        }) || null
    }, [contacts, currentUserProfile.alias, currentUserProfile.displayName, currentUserProfile.wxid])

    const currentTimelineTargetContact = useMemo(() => {
        const normalizedTargetUsername = String(authorTimelineTarget?.username || '').trim()
        if (!normalizedTargetUsername) return null
        return contacts.find((contact) => contact.username === normalizedTargetUsername) || null
    }, [authorTimelineTarget, contacts])

    const myTimelineCount = useMemo(() => {
        if (resolvedCurrentUserContact?.postCountStatus === 'ready' && typeof resolvedCurrentUserContact.postCount === 'number') {
            return normalizePostCount(resolvedCurrentUserContact.postCount)
        }
        return null
    }, [normalizePostCount, resolvedCurrentUserContact])

    const myTimelineCountLoading = Boolean(
        resolvedCurrentUserContact
            ? resolvedCurrentUserContact.postCountStatus !== 'ready'
            : overviewStatsStatus === 'loading' || contactsLoading
    )

    const openCurrentUserTimeline = useCallback(() => {
        if (!resolvedCurrentUserContact) return
        setAuthorTimelineTarget({
            username: resolvedCurrentUserContact.username,
            displayName: resolvedCurrentUserContact.displayName || currentUserProfile.displayName || resolvedCurrentUserContact.username,
            avatarUrl: resolvedCurrentUserContact.avatarUrl || currentUserProfile.avatarUrl
        })
    }, [currentUserProfile.avatarUrl, currentUserProfile.displayName, resolvedCurrentUserContact])

    const isDefaultViewNow = useCallback(() => {
        return !searchKeywordRef.current.trim() && !jumpTargetDateRef.current
    }, [])

    const ensureSnsCacheScopeKey = useCallback(async () => {
        if (cacheScopeKeyRef.current) return cacheScopeKeyRef.current
        const wxid = (await configService.getMyWxid())?.trim() || SNS_PAGE_CACHE_SCOPE_FALLBACK
        const scopeKey = `sns_page:${wxid}`
        cacheScopeKeyRef.current = scopeKey
        return scopeKey
    }, [])

    const ensureSnsUserPostCountsCacheScopeKey = useCallback(async () => {
        if (snsUserPostCountsCacheScopeKeyRef.current) return snsUserPostCountsCacheScopeKeyRef.current
        const [wxidRaw, dbPathRaw] = await Promise.all([
            configService.getMyWxid(),
            configService.getDbPath()
        ])
        const wxid = String(wxidRaw || '').trim()
        const dbPath = String(dbPathRaw || '').trim()
        const scopeKey = (dbPath || wxid)
            ? `${dbPath}::${wxid}`
            : 'default'
        snsUserPostCountsCacheScopeKeyRef.current = scopeKey
        return scopeKey
    }, [])

    const persistSnsPageCache = useCallback(async (patch?: { posts?: SnsPost[]; overviewStats?: SnsOverviewStats }) => {
        if (!isDefaultViewNow()) return
        try {
            const scopeKey = await ensureSnsCacheScopeKey()
            if (!scopeKey) return
            const existingCache = await configService.getSnsPageCache(scopeKey)
            let postsToStore = patch?.posts ?? postsRef.current
            if (!patch?.posts && postsToStore.length === 0) {
                if (existingCache && Array.isArray(existingCache.posts) && existingCache.posts.length > 0) {
                    postsToStore = existingCache.posts as SnsPost[]
                }
            }
            const overviewToStore = patch?.overviewStats
                ?? (overviewStatsStatusRef.current === 'ready'
                    ? overviewStatsRef.current
                    : existingCache?.overviewStats ?? overviewStatsRef.current)
            await configService.setSnsPageCache(scopeKey, {
                overviewStats: overviewToStore,
                posts: postsToStore.slice(0, SNS_PAGE_CACHE_POST_LIMIT)
            })
        } catch (error) {
            logger.error('持久化朋友圈页面缓存失败:', error)
        }
    }, [ensureSnsCacheScopeKey, isDefaultViewNow])

    const hydrateSnsPageCache = useCallback(async () => {
        try {
            const scopeKey = await ensureSnsCacheScopeKey()
            const cached = await configService.getSnsPageCache(scopeKey)
            if (!cached) return
            if (Date.now() - cached.updatedAt > SNS_PAGE_CACHE_TTL_MS) return

            const cachedOverview = cached.overviewStats
            if (cachedOverview) {
                const cachedTotalPosts = Math.max(0, Number(cachedOverview.totalPosts || 0))
                const cachedTotalFriends = Math.max(0, Number(cachedOverview.totalFriends || 0))
                const hasCachedPosts = Array.isArray(cached.posts) && cached.posts.length > 0
                const hasOverviewData = cachedTotalPosts > 0 || cachedTotalFriends > 0
                setOverviewStats({
                    totalPosts: cachedTotalPosts,
                    totalFriends: cachedTotalFriends,
                    myPosts: typeof cachedOverview.myPosts === 'number' && Number.isFinite(cachedOverview.myPosts) && cachedOverview.myPosts >= 0
                        ? Math.floor(cachedOverview.myPosts)
                        : null,
                    earliestTime: cachedOverview.earliestTime ?? null,
                    latestTime: cachedOverview.latestTime ?? null
                })
                // 只有明确有统计值（或确实无帖子）时才把缓存视为 ready，避免历史异常 0 卡住显示。
                setOverviewStatsStatus(hasOverviewData || !hasCachedPosts ? 'ready' : 'loading')
            }

            if (Array.isArray(cached.posts) && cached.posts.length > 0) {
                const cachedPosts = cached.posts
                    .filter((raw): raw is SnsPost => {
                        if (!raw || typeof raw !== 'object') return false
                        const row = raw as Record<string, unknown>
                        return typeof row.id === 'string' && typeof row.createTime === 'number'
                    })
                    .filter((post) => !isLikelyBrokenCachedSnsPost(post))
                    .slice(0, SNS_PAGE_CACHE_POST_LIMIT)
                    .sort((a, b) => b.createTime - a.createTime)

                if (cachedPosts.length > 0) {
                    setPosts(cachedPosts)
                    setHasMore(true)
                    setHasNewer(false)
                }
            }
        } catch (error) {
            logger.error('恢复朋友圈页面缓存失败:', error)
        }
    }, [ensureSnsCacheScopeKey])

    const loadOverviewStats = useCallback(async () => {
        setOverviewStatsStatus('loading')
        try {
            const statsResult = await sns.getExportStats()
            if (!statsResult.success || !statsResult.data) {
                throw new Error(statsResult.error || '获取朋友圈统计失败')
            }

            const totalPosts = Math.max(0, Number(statsResult.data.totalPosts || 0))
            const totalFriends = Math.max(0, Number(statsResult.data.totalFriends || 0))
            const myPosts = (typeof statsResult.data.myPosts === 'number' && Number.isFinite(statsResult.data.myPosts) && statsResult.data.myPosts >= 0)
                ? Math.floor(statsResult.data.myPosts)
                : null
            let earliestTime: number | null = null
            let latestTime: number | null = null

            if (totalPosts > 0) {
                const [latestResult, earliestResult] = await Promise.all([
                    sns.getTimeline(1, 0),
                    sns.getTimeline(1, Math.max(totalPosts - 1, 0))
                ])
                const latestTs = Number(latestResult.timeline?.[0]?.createTime || 0)
                const earliestTs = Number(earliestResult.timeline?.[0]?.createTime || 0)

                if (latestResult.success && Number.isFinite(latestTs) && latestTs > 0) {
                    latestTime = Math.floor(latestTs)
                }
                if (earliestResult.success && Number.isFinite(earliestTs) && earliestTs > 0) {
                    earliestTime = Math.floor(earliestTs)
                }
            }

            const nextOverviewStats = {
                totalPosts,
                totalFriends,
                myPosts,
                earliestTime,
                latestTime
            }
            setOverviewStats(nextOverviewStats)
            setOverviewStatsStatus('ready')
            void persistSnsPageCache({ overviewStats: nextOverviewStats })
        } catch (error) {
            logger.error('加载朋友圈概览失败:', error)
            setOverviewStatsStatus('error')
        }
    }, [persistSnsPageCache])

    const renderOverviewRangeText = () => {
        if (overviewStatsStatus === 'error') {
            return (
                <button type="button" className="feed-stats-retry" onClick={() => { void loadOverviewStats() }}>
                    统计失败，点击重试
                </button>
            )
        }
        if (overviewStatsStatus === 'loading') {
            return '统计中...'
        }
        return `${formatDateOnly(overviewStats.earliestTime)} ~ ${formatDateOnly(overviewStats.latestTime)}`
    }

    const exportDateRangeLabel = useMemo(() => getExportDateRangeLabel(exportDateRangeSelection), [exportDateRangeSelection])

    const loadPosts = useCallback(async (options: { reset?: boolean, direction?: 'older' | 'newer' } = {}) => {
        const { reset = false, direction = 'older' } = options
        if (loadingRef.current) return

        loadingRef.current = true
        if (direction === 'newer') setLoadingNewer(true)
        else setLoading(true)

        try {
            const limit = 20
            let startTs: number | undefined = undefined
            let endTs: number | undefined = undefined

            if (reset) {
                // If jumping to date, set endTs to end of that day
                if (jumpTargetDate) {
                    endTs = Math.floor(jumpTargetDate.getTime() / 1000) + 86399
                }
            } else if (direction === 'newer') {
                const currentPosts = postsRef.current
                if (currentPosts.length > 0) {
                    const topTs = currentPosts[0].createTime

                    const result = await sns.getTimeline(
                        limit,
                        0,
                        undefined,
                        searchKeyword,
                        topTs + 1,
                        undefined
                    );

                    if (result.success && result.timeline && result.timeline.length > 0) {
                        if (postsContainerRef.current) {
                            scrollAdjustmentRef.current = {
                                scrollHeight: postsContainerRef.current.scrollHeight,
                                scrollTop: postsContainerRef.current.scrollTop
                            };
                        }

                        const existingIds = new Set(currentPosts.map((p: SnsPost) => p.id));
                        const uniqueNewer = result.timeline.filter((p: SnsPost) => !existingIds.has(p.id));

                        if (uniqueNewer.length > 0) {
                            const merged = [...uniqueNewer, ...currentPosts].sort((a, b) => b.createTime - a.createTime)
                            setPosts(merged);
                            void persistSnsPageCache({ posts: merged })
                        }
                        setHasNewer(result.timeline.length >= limit);
                    } else {
                        setHasNewer(false);
                    }
                }
                setLoadingNewer(false);
                loadingRef.current = false;
                return;
            } else {
                // Loading older
                const currentPosts = postsRef.current
                if (currentPosts.length > 0) {
                    endTs = currentPosts[currentPosts.length - 1].createTime - 1
                }
            }

            const result = await sns.getTimeline(
                limit,
                0,
                undefined,
                searchKeyword,
                startTs, // default undefined
                endTs
            )

            if (result.success && result.timeline) {
                if (reset) {
                    setPosts(result.timeline)
                    void persistSnsPageCache({ posts: result.timeline })
                    setHasMore(result.timeline.length >= limit)

                    // Check for newer items above topTs
                    const topTs = result.timeline[0]?.createTime || 0;
                    if (topTs > 0) {
                        const checkResult = await sns.getTimeline(1, 0, undefined, searchKeyword, topTs + 1, undefined);
                        setHasNewer(!!(checkResult.success && checkResult.timeline && checkResult.timeline.length > 0));
                    } else {
                        setHasNewer(false);
                    }

                    if (postsContainerRef.current) {
                        postsContainerRef.current.scrollTop = 0
                    }
                } else {
                    if (result.timeline.length > 0) {
                        const merged = [...postsRef.current, ...result.timeline!].sort((a, b) => b.createTime - a.createTime)
                        setPosts(merged)
                        void persistSnsPageCache({ posts: merged })
                    }
                    if (result.timeline.length < limit) {
                        setHasMore(false)
                    }
                }
            }
        } catch (error) {
            logger.error('加载朋友圈时间线失败:', error)
        } finally {
            setLoading(false)
            setLoadingNewer(false)
            loadingRef.current = false
        }
    }, [jumpTargetDate, persistSnsPageCache, searchKeyword])

    const stopContactsCountHydration = useCallback((resetProgress = false) => {
        contactsCountHydrationTokenRef.current += 1
        if (contactsCountBatchTimerRef.current) {
            window.clearTimeout(contactsCountBatchTimerRef.current)
            contactsCountBatchTimerRef.current = null
        }
        if (resetProgress) {
            setContactsCountProgress({
                resolved: 0,
                total: 0,
                running: false
            })
        } else {
            setContactsCountProgress((prev) => ({ ...prev, running: false }))
        }
    }, [])

    const hydrateContactPostCounts = useCallback(async (
        usernames: string[],
        options?: { force?: boolean; readyUsernames?: Set<string> }
    ) => {
        const force = options?.force === true
        const targets = usernames
            .map((username) => String(username || '').trim())
            .filter(Boolean)
        stopContactsCountHydration(true)
        if (targets.length === 0) return

        const readySet = options?.readyUsernames || new Set(
            contactsRef.current
                .filter((contact) => contact.postCountStatus === 'ready' && typeof contact.postCount === 'number')
                .map((contact) => contact.username)
        )
        const pendingTargets = force ? targets : targets.filter((username) => !readySet.has(username))
        const runToken = ++contactsCountHydrationTokenRef.current
        const totalTargets = targets.length
        const targetSet = new Set(pendingTargets)

        if (pendingTargets.length > 0) {
            setContacts((prev) => {
                let changed = false
                const next = prev.map((contact) => {
                    if (!targetSet.has(contact.username)) return contact
                    if (contact.postCountStatus === 'loading' && typeof contact.postCount !== 'number') return contact
                    changed = true
                    return {
                        ...contact,
                        postCount: force ? undefined : contact.postCount,
                        postCountStatus: 'loading' as ContactPostCountStatus
                    }
                })
                return changed ? sortContactsForRanking(next) : prev
            })
        }
        const preResolved = Math.max(0, totalTargets - pendingTargets.length)
        setContactsCountProgress({
            resolved: preResolved,
            total: totalTargets,
            running: pendingTargets.length > 0
        })
        if (pendingTargets.length === 0) return

        let normalizedCounts: Record<string, number> = {}
        try {
            const result = await sns.getUserPostCounts()
            if (runToken !== contactsCountHydrationTokenRef.current) return
            if (result.success && result.counts) {
                normalizedCounts = Object.fromEntries(
                    Object.entries(result.counts).map(([username, value]) => [username, normalizePostCount(value)])
                )
                void (async () => {
                    try {
                        const scopeKey = await ensureSnsUserPostCountsCacheScopeKey()
                        await configService.setExportSnsUserPostCountsCache(scopeKey, normalizedCounts)
                    } catch (cacheError) {
                        logger.error('持久化朋友圈用户条数缓存失败:', cacheError)
                    }
                })()
            }
        } catch (error) {
            logger.error('加载联系人朋友圈条数失败:', error)
        }

        let resolved = preResolved
        let cursor = 0
        const applyBatch = () => {
            if (runToken !== contactsCountHydrationTokenRef.current) return

            const batch = pendingTargets.slice(cursor, cursor + CONTACT_COUNT_BATCH_SIZE)
            if (batch.length === 0) {
                setContactsCountProgress({
                    resolved: totalTargets,
                    total: totalTargets,
                    running: false
                })
                contactsCountBatchTimerRef.current = null
                return
            }

            const batchSet = new Set(batch)
            setContacts((prev) => {
                let changed = false
                const next = prev.map((contact) => {
                    if (!batchSet.has(contact.username)) return contact
                    const nextCount = normalizePostCount(normalizedCounts[contact.username])
                    if (contact.postCountStatus === 'ready' && contact.postCount === nextCount) return contact
                    changed = true
                    return {
                        ...contact,
                        postCount: nextCount,
                        postCountStatus: 'ready' as ContactPostCountStatus
                    }
                })
                return changed ? sortContactsForRanking(next) : prev
            })

            resolved += batch.length
            cursor += batch.length
            setContactsCountProgress({
                resolved,
                total: totalTargets,
                running: resolved < totalTargets
            })

            if (cursor < totalTargets) {
                contactsCountBatchTimerRef.current = window.setTimeout(applyBatch, CONTACT_COUNT_SORT_DEBOUNCE_MS)
            } else {
                contactsCountBatchTimerRef.current = null
            }
        }

        applyBatch()
    }, [normalizePostCount, sortContactsForRanking, stopContactsCountHydration])

    // Load Contacts（先按最近会话显示联系人，再异步统计朋友圈条数并增量排序）
    const loadContacts = useCallback(async () => {
        const requestToken = ++contactsLoadTokenRef.current
        stopContactsCountHydration(true)
        setContactsLoading(true)
        try {
            const snsPostCountsScopeKey = await ensureSnsUserPostCountsCacheScopeKey()
            const [cachedPostCountsItem, cachedContactsItem, cachedAvatarItem] = await Promise.all([
                configService.getExportSnsUserPostCountsCache(snsPostCountsScopeKey),
                configService.getContactsListCache(snsPostCountsScopeKey),
                configService.getContactsAvatarCache(snsPostCountsScopeKey)
            ])
            const cachedPostCounts = cachedPostCountsItem?.counts || {}
            const cachedAvatarMap = cachedAvatarItem?.avatars || {}
            const cachedContacts = (cachedContactsItem?.contacts || [])
                .filter((contact) => contact.type === 'friend' || contact.type === 'former_friend')
                .map((contact) => {
                    const cachedCount = cachedPostCounts[contact.username]
                    const hasCachedCount = typeof cachedCount === 'number' && Number.isFinite(cachedCount)
                    return {
                        username: contact.username,
                        displayName: contact.displayName || contact.username,
                        avatarUrl: cachedAvatarMap[contact.username]?.avatarUrl,
                        remark: contact.remark,
                        nickname: contact.nickname,
                        type: (contact.type === 'former_friend' ? 'former_friend' : 'friend') as 'friend' | 'former_friend',
                        lastSessionTimestamp: 0,
                        postCount: hasCachedCount ? Math.max(0, Math.floor(cachedCount)) : undefined,
                        postCountStatus: hasCachedCount ? 'ready' as ContactPostCountStatus : 'idle' as ContactPostCountStatus
                    }
                })

            if (requestToken !== contactsLoadTokenRef.current) return
            if (cachedContacts.length > 0) {
                const cachedContactsSorted = sortContactsForRanking(cachedContacts)
                setContacts(cachedContactsSorted)
                setContactsLoading(false)
                const cachedReadyCount = cachedContactsSorted.filter(contact => contact.postCountStatus === 'ready').length
                setContactsCountProgress({
                    resolved: cachedReadyCount,
                    total: cachedContactsSorted.length,
                    running: cachedReadyCount < cachedContactsSorted.length
                })
            }

            const [contactsResult, sessionsResult] = await Promise.all([
                chat.getContacts(),
                chat.getSessions()
            ])
            const contactMap = new Map<string, Contact>()
            const sessionTimestampMap = new Map<string, number>()

            if (sessionsResult.success && Array.isArray(sessionsResult.sessions)) {
                for (const session of sessionsResult.sessions) {
                    const username = String(session?.username || '').trim()
                    if (!username) continue
                    const ts = Math.max(
                        Number(session?.sortTimestamp || 0),
                        Number(session?.lastTimestamp || 0)
                    )
                    const prevTs = Number(sessionTimestampMap.get(username) || 0)
                    if (ts > prevTs) {
                        sessionTimestampMap.set(username, ts)
                    }
                }
            }

            if (contactsResult.success && contactsResult.contacts) {
                for (const c of contactsResult.contacts) {
                    if (c.type === 'friend' || c.type === 'former_friend') {
                        const cachedCount = cachedPostCounts[c.username]
                        const hasCachedCount = typeof cachedCount === 'number' && Number.isFinite(cachedCount)
                        contactMap.set(c.username, {
                            username: c.username,
                            displayName: c.displayName,
                            avatarUrl: c.avatarUrl,
                            remark: c.remark,
                            nickname: c.nickname,
                            type: c.type === 'former_friend' ? 'former_friend' : 'friend',
                            lastSessionTimestamp: Number(sessionTimestampMap.get(c.username) || 0),
                            postCount: hasCachedCount ? Math.max(0, Math.floor(cachedCount)) : undefined,
                            postCountStatus: hasCachedCount ? 'ready' : 'idle'
                        })
                    }
                }
            }

            let contactsList = sortContactsForRanking(Array.from(contactMap.values()))
            if (requestToken !== contactsLoadTokenRef.current) return
            setContacts(contactsList)
            const readyUsernames = new Set(
                contactsList
                    .filter((contact) => contact.postCountStatus === 'ready' && typeof contact.postCount === 'number')
                    .map((contact) => contact.username)
            )
            void hydrateContactPostCounts(
                contactsList.map(contact => contact.username),
                { readyUsernames }
            )

            const allUsernames = contactsList.map(c => c.username)

            // 用 enrichSessionsContactInfo 统一补充头像和显示名
            if (allUsernames.length > 0) {
                const enriched = await chat.enrichSessionsContactInfo(allUsernames)
                if (enriched.success && enriched.contacts) {
                    contactsList = contactsList.map((contact) => {
                        const extra = enriched.contacts?.[contact.username]
                        if (!extra) return contact
                        return {
                            ...contact,
                            displayName: extra.displayName || contact.displayName,
                            avatarUrl: extra.avatarUrl || contact.avatarUrl
                        }
                    })
                    if (requestToken !== contactsLoadTokenRef.current) return
                    setContacts((prev) => {
                        const prevMap = new Map(prev.map((contact) => [contact.username, contact]))
                        const merged = contactsList.map((contact) => {
                            const previous = prevMap.get(contact.username)
                            return {
                                ...contact,
                                lastSessionTimestamp: previous?.lastSessionTimestamp ?? contact.lastSessionTimestamp,
                                postCount: previous?.postCount,
                                postCountStatus: previous?.postCountStatus ?? contact.postCountStatus
                            }
                        })
                        return sortContactsForRanking(merged)
                    })
                }
            }
        } catch (error) {
            if (requestToken !== contactsLoadTokenRef.current) return
            logger.error('加载朋友圈联系人失败:', error)
            stopContactsCountHydration(true)
        } finally {
            if (requestToken === contactsLoadTokenRef.current) {
                setContactsLoading(false)
            }
        }
    }, [ensureSnsUserPostCountsCacheScopeKey, hydrateContactPostCounts, sortContactsForRanking, stopContactsCountHydration])

    const closeAuthorTimeline = useCallback(() => {
        setAuthorTimelineTarget(null)
    }, [])

    const openAuthorTimeline = useCallback((post: SnsPost) => {
        setAuthorTimelineTarget({
            username: post.username,
            displayName: decodeHtmlEntities(post.nickname || '') || post.username,
            avatarUrl: post.avatarUrl
        })
    }, [decodeHtmlEntities])

    const openContactTimeline = useCallback((contact: Contact) => {
        setAuthorTimelineTarget({
            username: contact.username,
            displayName: contact.displayName || contact.username,
            avatarUrl: contact.avatarUrl
        })
    }, [])

    const handlePostDelete = useCallback((postId: string, username: string) => {
        setPosts(prev => {
            const next = prev.filter(p => p.id !== postId)
            void persistSnsPageCache({ posts: next })
            return next
        })
        void loadOverviewStats()
    }, [loadOverviewStats, persistSnsPageCache])

    // Initial Load & Listeners
    useEffect(() => {
        void hydrateSnsPageCache()
        loadContacts()
        loadOverviewStats()
    }, [hydrateSnsPageCache, loadContacts, loadOverviewStats])

    useEffect(() => {
        const syncCurrentUserProfile = async () => {
            const cachedProfile = readSidebarUserProfileCache()
            if (cachedProfile) {
                setCurrentUserProfile((prev) => ({
                    wxid: cachedProfile.wxid || prev.wxid,
                    displayName: cachedProfile.displayName || prev.displayName,
                    alias: cachedProfile.alias || prev.alias,
                    avatarUrl: cachedProfile.avatarUrl || prev.avatarUrl
                }))
            }

            try {
                const wxidRaw = await configService.getMyWxid()
                const resolvedWxid = normalizeAccountId(wxidRaw) || String(wxidRaw || '').trim()
                if (!resolvedWxid && !cachedProfile) return
                setCurrentUserProfile((prev) => ({
                    wxid: resolvedWxid || prev.wxid,
                    displayName: prev.displayName || cachedProfile?.displayName || resolvedWxid || '未识别用户',
                    alias: prev.alias || cachedProfile?.alias,
                    avatarUrl: prev.avatarUrl || cachedProfile?.avatarUrl
                }))
            } catch (error) {
                logger.error('同步当前侧边栏用户资料失败:', error)
            }
        }

        void syncCurrentUserProfile()
        const handleChange = () => { void syncCurrentUserProfile() }
        window.addEventListener('wxid-changed', handleChange as EventListener)
        return () => window.removeEventListener('wxid-changed', handleChange as EventListener)
    }, [])

    useEffect(() => {
        return () => {
            contactsCountHydrationTokenRef.current += 1
            if (contactsCountBatchTimerRef.current) {
                window.clearTimeout(contactsCountBatchTimerRef.current)
                contactsCountBatchTimerRef.current = null
            }
        }
    }, [])

    useEffect(() => {
        const handleChange = () => {
            cacheScopeKeyRef.current = ''
            snsUserPostCountsCacheScopeKeyRef.current = ''
            // wxid changed, reset everything
            stopContactsCountHydration(true)
            setContacts([])
            setPosts([]); setHasMore(true); setHasNewer(false);
            setSearchKeyword(''); setJumpTargetDate(undefined);
            void hydrateSnsPageCache()
            loadContacts();
            loadOverviewStats();
            loadPosts({ reset: true });
        }
        window.addEventListener('wxid-changed', handleChange as EventListener)
        return () => window.removeEventListener('wxid-changed', handleChange as EventListener)
    }, [hydrateSnsPageCache, loadContacts, loadOverviewStats, loadPosts, stopContactsCountHydration])

    useEffect(() => {
        const timer = setTimeout(() => {
            loadPosts({ reset: true })
        }, 500)
        return () => clearTimeout(timer)
    }, [searchKeyword, jumpTargetDate, loadPosts])

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, clientHeight, scrollHeight } = e.currentTarget
        if (scrollHeight - scrollTop - clientHeight < 400 && hasMore && !loading && !loadingNewer) {
            loadPosts({ direction: 'older' })
        }
        if (scrollTop < 10 && hasNewer && !loading && !loadingNewer) {
            loadPosts({ direction: 'newer' })
        }
    }

    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        const container = postsContainerRef.current
        if (!container) return
        if (e.deltaY < -20 && container.scrollTop <= 0 && hasNewer && !loading && !loadingNewer) {
            loadPosts({ direction: 'newer' })
        }
    }

    return (
        <div className="sns-page-layout">
            <div className="sns-main-viewport">
                <div className="sns-feed-container">
                    <div className="feed-header">
                        <div className="feed-header-main">
                            <h2>朋友圈</h2>
                            <div className={`feed-stats-line ${overviewStatsStatus}`}>
                                <span className="feed-overview-total">
                                    {overviewStatsStatus === 'loading'
                                        ? '共 统计中...'
                                        : `共 ${overviewStats.totalPosts.toLocaleString('zh-CN')} 条`}
                                </span>
                                <span className="feed-stats-divider" aria-hidden="true">｜</span>
                                <button
                                    type="button"
                                    className={`feed-my-timeline-entry ${resolvedCurrentUserContact ? 'ready' : ''} ${myTimelineCountLoading ? 'loading' : ''}`}
                                    onClick={openCurrentUserTimeline}
                                    disabled={!resolvedCurrentUserContact}
                                    title={resolvedCurrentUserContact
                                        ? `打开${resolvedCurrentUserContact.displayName || '我'}的朋友圈详情`
                                        : '未在右侧联系人列表中匹配到当前账号'}
                                >
                                    <span className="feed-my-timeline-label">我的朋友圈</span>
                                    <span className="feed-my-timeline-count">
                                        {myTimelineCount !== null
                                            ? `${myTimelineCount.toLocaleString('zh-CN')} 条`
                                            : myTimelineCountLoading
                                                ? <Loader2 size={14} className="spin" aria-hidden="true" />
                                                : '--'}
                                    </span>
                                </button>
                            </div>
                            <div className={`feed-stats-line feed-stats-range ${overviewStatsStatus}`}>
                                {renderOverviewRangeText()}
                            </div>
                        </div>
                        <div className="header-actions">
                            <div className="jump-calendar-anchor" ref={jumpCalendarWrapRef}>
                                <button
                                    type="button"
                                    className={`${jumpTargetDate ? 'jump-date-chip' : 'icon-btn'} ${showJumpPopover ? 'active' : ''}`}
                                    title={jumpTargetDate
                                        ? jumpTargetDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
                                        : '时间跳转'}
                                    onClick={() => {
                                        if (!showJumpPopover) {
                                            const nextDate = jumpTargetDate || new Date()
                                            setJumpPopoverDate(nextDate)
                                            void loadJumpDateCounts(nextDate)
                                        }
                                        setShowJumpPopover(prev => !prev)
                                    }}
                                >
                                    {jumpTargetDate ? (
                                        <>
                                            <span className="jump-date-chip-label">
                                                {`${jumpTargetDate.getFullYear()}-${String(jumpTargetDate.getMonth() + 1).padStart(2, '0')}-${String(jumpTargetDate.getDate()).padStart(2, '0')}`}
                                            </span>
                                            <span
                                                className="jump-date-chip-clear"
                                                role="button"
                                                tabIndex={0}
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    setJumpTargetDate(undefined)
                                                    setShowJumpPopover(false)
                                                }}
                                                onKeyDown={(event) => {
                                                    if (event.key !== 'Enter' && event.key !== ' ') return
                                                    event.preventDefault()
                                                    event.stopPropagation()
                                                    setJumpTargetDate(undefined)
                                                    setShowJumpPopover(false)
                                                }}
                                                aria-label="清除日期跳转"
                                            >
                                                <X size={14} />
                                            </span>
                                        </>
                                    ) : (
                                        <Calendar size={20} />
                                    )}
                                </button>
                                <JumpToDatePopover
                                    isOpen={showJumpPopover}
                                    currentDate={jumpPopoverDate}
                                    onClose={() => setShowJumpPopover(false)}
                                    onMonthChange={(date) => {
                                        setJumpPopoverDate(date)
                                        void loadJumpDateCounts(date)
                                    }}
                                    onSelect={(date) => {
                                        setJumpPopoverDate(date)
                                        setJumpTargetDate(date)
                                    }}
                                    messageDates={jumpDateMessageDates}
                                    hasLoadedMessageDates={hasLoadedJumpDateCounts}
                                    messageDateCounts={jumpDateCounts}
                                    loadingDateCounts={loadingJumpDateCounts}
                                />
                            </div>
                            {supportsSnsProtection && (
                                <button
                                    onClick={async () => {
                                        setTriggerMessage(null)
                                        setShowTriggerDialog(true)
                                        setTriggerInstalled(false)
                                        setTriggerMessage({ type: 'error', text: '当前运行模式为只读，已禁用朋友圈写入保护。' })
                                    }}
                                    className="icon-btn"
                                    title="朋友圈保护插件"
                                >
                                    <Shield size={20} />
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    setExportResult(null)
                                    setExportProgress(null)
                                    setExportDateRangeSelection(createExportDateRangeSelectionFromPreset('all'))
                                    setIsExportDateRangeDialogOpen(false)
                                    setShowExportDialog(true)
                                }}
                                className="icon-btn export-btn"
                                title="导出朋友圈"
                            >
                                <Download size={20} />
                            </button>
                            <button
                                onClick={() => {
                                    setRefreshSpin(true)
                                    loadPosts({ reset: true })
                                    loadOverviewStats()
                                    setTimeout(() => setRefreshSpin(false), 800)
                                }}
                                disabled={loading || loadingNewer}
                                className="icon-btn refresh-btn"
                                title="从头刷新"
                            >
                                <RefreshCw size={20} className={(loading || loadingNewer || refreshSpin) ? 'spinning' : ''} />
                            </button>
                        </div>
                    </div>

                    <div className="sns-posts-scroll" onScroll={handleScroll} onWheel={handleWheel} ref={postsContainerRef}>
                        {loadingNewer && (
                            <div className="status-indicator loading-newer">
                                <RefreshCw size={16} className="spinning" />
                                <span>正在检查更新的动态...</span>
                            </div>
                        )}

                        {!loadingNewer && hasNewer && (
                            <div className="status-indicator newer-hint" onClick={() => loadPosts({ direction: 'newer' })}>
                                有新动态，点击查看
                            </div>
                        )}

                        <div className="posts-list">
                            {posts.map(post => (
                                <SnsPostItem
                                    key={post.id}
                                    post={{ ...post, isProtected: triggerInstalled === true }}
                                    onPreview={(src, isVideo, liveVideoPath) => {
                                        if (isVideo) {
                                            void windowControl.openVideoPlayerWindow(src)
                                        } else {
                                            void windowControl.openImageViewerWindow(src, liveVideoPath || undefined)
                                        }
                                    }}
                                    onDelete={handlePostDelete}
                                    allowDelete={capabilities?.snsMutation === true}
                                    onOpenAuthorPosts={openAuthorTimeline}
                                />
                            ))}
                        </div>

                        {loading && posts.length === 0 && (
                            <div className="initial-loading">
                                <div className="loading-pulse">
                                    <div className="pulse-circle"></div>
                                    <span>正在加载朋友圈...</span>
                                </div>
                            </div>
                        )}

                        {loading && posts.length > 0 && (
                            <div className="status-indicator loading-more">
                                <RefreshCw size={16} className="spinning" />
                                <span>正在加载更多...</span>
                            </div>
                        )}

                        {!hasMore && posts.length > 0 && (
                            <div className="status-indicator no-more">或许过往已无可溯洄，但好在还有可以与你相遇的明天</div>
                        )}

                        {!loading && posts.length === 0 && (
                            <div className="no-results">
                                <div className="no-results-icon"><Search size={48} /></div>
                                <p>未找到相关动态</p>
                                {(searchKeyword || jumpTargetDate) && (
                                    <button onClick={() => {
                                        setSearchKeyword(''); setJumpTargetDate(undefined);
                                    }} className="reset-inline">
                                        重置筛选条件
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <SnsFilterPanel
                searchKeyword={searchKeyword}
                setSearchKeyword={setSearchKeyword}
                totalFriendsLabel={
                    overviewStatsStatus === 'loading'
                        ? '统计中'
                        : overviewStatsStatus === 'ready'
                            ? `${overviewStats.totalFriends} 位好友`
                            : undefined
                }
                contacts={contacts}
                contactSearch={contactSearch}
                setContactSearch={setContactSearch}
                loading={contactsLoading}
                contactsCountProgress={contactsCountProgress}
                onOpenContactTimeline={openContactTimeline}
            />

            {/* Dialogs and Overlays */}
            <ContactSnsTimelineDialog
                target={authorTimelineTarget}
                onClose={closeAuthorTimeline}
                initialTotalPosts={authorTimelineTarget?.username === resolvedCurrentUserContact?.username
                    ? myTimelineCount
                    : currentTimelineTargetContact?.postCountStatus === 'ready'
                        ? normalizePostCount(currentTimelineTargetContact.postCount)
                        : null}
                initialTotalPostsLoading={Boolean(authorTimelineTarget?.username === resolvedCurrentUserContact?.username
                    ? myTimelineCount === null && myTimelineCountLoading
                    : currentTimelineTargetContact?.postCountStatus === 'loading')}
                isProtected={triggerInstalled === true}
                onDeletePost={handlePostDelete}
            />

            {/* 朋友圈防删除插件对话框 */}
            {supportsSnsProtection && (
                <SnsProtectionDialog
                    open={showTriggerDialog}
                    triggerInstalled={triggerInstalled}
                    triggerLoading={triggerLoading}
                    triggerMessage={triggerMessage}
                    onClose={() => { setShowTriggerDialog(false); setTriggerMessage(null) }}
                    onEnable={() => {
                        setTriggerMessage(null)
                        setTriggerMessage({ type: 'error', text: '当前运行模式为只读，已禁用朋友圈写入保护。' })
                    }}
                    onDisable={() => {
                        setTriggerMessage(null)
                        setTriggerMessage({ type: 'error', text: '当前运行模式为只读，已禁用朋友圈写入保护。' })
                    }}
                />
            )}

            {/* 导出对话框 */}
            {showExportDialog && (
                <div className="modal-overlay" onClick={() => !isExporting && setShowExportDialog(false)}>
                    <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="export-dialog-header">
                            <h3>导出朋友圈</h3>
                            <button className="close-btn" onClick={() => !isExporting && setShowExportDialog(false)} disabled={isExporting}>
                                <X size={20} />
                            </button>
                        </div>

                        <div className="export-dialog-body">
                            {/* 筛选条件提示 */}
                            {searchKeyword && (
                                <div className="export-filter-info">
                                    <span className="filter-badge">筛选导出</span>
                                    {searchKeyword && <span className="filter-tag">关键词: "{searchKeyword}"</span>}
                                </div>
                            )}

                            {!exportResult ? (
                                <>
                                    {/* 格式选择 */}
                                    <div className="export-section">
                                        <label className="export-label">导出格式</label>
                                        <div className="export-format-options">
                                            <button
                                                className={`format-option ${exportFormat === 'html' ? 'active' : ''}`}
                                                onClick={() => setExportFormat('html')}
                                                disabled={isExporting}
                                            >
                                                <FileText size={20} />
                                                <span>HTML</span>
                                                <small>浏览器可直接查看</small>
                                            </button>
                                            <button
                                                className={`format-option ${exportFormat === 'json' ? 'active' : ''}`}
                                                onClick={() => setExportFormat('json')}
                                                disabled={isExporting}
                                            >
                                                <FileJson size={20} />
                                                <span>JSON</span>
                                                <small>结构化数据</small>
                                            </button>
                                            <button
                                                className={`format-option ${exportFormat === 'arkmejson' ? 'active' : ''}`}
                                                onClick={() => setExportFormat('arkmejson')}
                                                disabled={isExporting}
                                            >
                                                <FileJson size={20} />
                                                <span>ArkmeJSON</span>
                                                <small>结构化数据（含互动身份）</small>
                                            </button>
                                        </div>
                                    </div>

                                    {/* 输出路径 */}
                                    <div className="export-section">
                                        <label className="export-label">输出目录</label>
                                        <div className="export-path-row">
                                            <input
                                                type="text"
                                                value={exportFolder}
                                                readOnly
                                                placeholder="点击选择输出目录..."
                                                className="export-path-input"
                                            />
                                            <button
                                                className="export-browse-btn"
                                                onClick={async () => {
                                                    const result = await sns.selectExportDir()
                                                    if (!result.canceled && result.filePath) {
                                                        setExportFolder(result.filePath)
                                                    }
                                                }}
                                                disabled={isExporting}
                                            >
                                                <FolderOpen size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* 时间范围 */}
                                    <div className="export-section">
                                        <div className="export-section-header">
                                            <label className="export-label"><Calendar size={14} /> 时间范围</label>
                                            <button
                                                type="button"
                                                className="time-range-trigger sns-export-time-range-trigger"
                                                onClick={() => {
                                                    if (!isExporting) setIsExportDateRangeDialogOpen(true)
                                                }}
                                                disabled={isExporting}
                                            >
                                                <span>{exportDateRangeLabel}</span>
                                                <span className="time-range-arrow">&gt;</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* 媒体导出 */}
                                    <div className="export-section">
                                        <label className="export-label">
                                            <Image size={14} />
                                            媒体文件（可多选）
                                        </label>
                                        <div className="export-media-check-grid">
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={exportImages}
                                                    onChange={(e) => setExportImages(e.target.checked)}
                                                    disabled={isExporting}
                                                />
                                                图片
                                            </label>
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={exportLivePhotos}
                                                    onChange={(e) => setExportLivePhotos(e.target.checked)}
                                                    disabled={isExporting}
                                                />
                                                实况图
                                            </label>
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={exportVideos}
                                                    onChange={(e) => setExportVideos(e.target.checked)}
                                                    disabled={isExporting}
                                                />
                                                视频
                                            </label>
                                        </div>
                                        <p className="export-media-hint">全不勾选时仅导出文本信息，不导出媒体文件</p>
                                    </div>

                                    {/* 同步提示 */}
                                    <div className="export-sync-hint">
                                        <Info size={14} />
                                        <span>将同步主页面的关键词搜索</span>
                                    </div>

                                    {/* 进度条 */}
                                    {isExporting && exportProgress && (
                                        <div className="export-progress">
                                            <div className="export-progress-bar">
                                                <div
                                                    className="export-progress-fill"
                                                    style={{ width: exportProgress.total > 0 ? `${Math.round((exportProgress.current / exportProgress.total) * 100)}%` : '100%' }}
                                                />
                                            </div>
                                            <span className="export-progress-text">{exportProgress.status}</span>
                                        </div>
                                    )}

                                    {/* 操作按钮 */}
                                    <div className="export-actions">
                                        <button
                                            className="export-cancel-btn"
                                            onClick={() => setShowExportDialog(false)}
                                            disabled={isExporting}
                                        >
                                            取消
                                        </button>
                                        <button
                                            className="export-start-btn"
                                            disabled={!exportFolder || isExporting}
                                            onClick={async () => {
                                                setIsExporting(true)
                                                setExportProgress({ current: 0, total: 0, status: '准备导出...' })
                                                setExportResult(null)

                                                // 监听进度
                                                const removeProgress = sns.onExportProgress((progress) => {
                                                    setExportProgress(progress)
                                                })

                                                try {
                                                    const result = await sns.exportTimeline({
                                                        outputDir: exportFolder,
                                                        format: exportFormat,
                                                        keyword: searchKeyword || undefined,
                                                        exportImages,
                                                        exportLivePhotos,
                                                        exportVideos,
                                                        startTime: exportDateRangeSelection.useAllTime
                                                            ? undefined
                                                            : Math.floor(exportDateRangeSelection.dateRange.start.getTime() / 1000),
                                                        endTime: exportDateRangeSelection.useAllTime
                                                            ? undefined
                                                            : Math.floor(exportDateRangeSelection.dateRange.end.getTime() / 1000)
                                                    })
                                                    setExportResult(result)
                                                } catch (error) {
                                                    const message = error instanceof Error ? error.message : String(error)
                                                    setExportResult({ success: false, error: message })
                                                } finally {
                                                    setIsExporting(false)
                                                    removeProgress()
                                                }
                                            }}
                                        >
                                            {isExporting ? '导出中...' : '开始导出'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                /* 导出结果 */
                                <div className="export-result">
                                    {exportResult.success ? (
                                        <>
                                            <div className="export-result-icon success">
                                                <CheckCircle size={48} />
                                            </div>
                                            <h4>导出成功</h4>
                                            <p>共导出 {exportResult.postCount} 条动态{exportResult.mediaCount ? `，${exportResult.mediaCount} 个媒体文件` : ''}</p>
                                            <div className="export-result-actions">
                                                <button
                                                    className="export-open-btn"
                                                    onClick={() => {
                                                        if (exportFolder) {
                                                            void shell.openPath(exportFolder)
                                                        }
                                                    }}
                                                >
                                                    <FolderOpen size={16} />
                                                    打开目录
                                                </button>
                                                <button
                                                    className="export-done-btn"
                                                    onClick={() => setShowExportDialog(false)}
                                                >
                                                    完成
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="export-result-icon error">
                                                <AlertCircle size={48} />
                                            </div>
                                            <h4>导出失败</h4>
                                            <p className="error-text">{exportResult.error}</p>
                                            <button
                                                className="export-done-btn"
                                                onClick={() => setExportResult(null)}
                                            >
                                                重试
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <ExportDateRangeDialog
                open={isExportDateRangeDialogOpen}
                value={exportDateRangeSelection}
                onClose={() => setIsExportDateRangeDialogOpen(false)}
                onConfirm={(nextSelection) => {
                    setExportDateRangeSelection(nextSelection)
                    setIsExportDateRangeDialogOpen(false)
                }}
            />
        </div>
    )
}
