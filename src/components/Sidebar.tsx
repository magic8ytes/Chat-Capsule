import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Home, MessageSquare, BarChart3, Users, Settings, ChevronLeft, ChevronRight, Download, Aperture, UserCircle, Lock, LockOpen, ChevronUp, Trash2 } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { usePlatformStore } from '../stores/platformStore'
import * as configService from '../services/config'
import { auth, chat, electronApi } from '../services/ipc'
import { onExportSessionStatus, requestExportSessionStatus } from '../services/exportBridge'
import { isRouteSupported } from '../../shared/contracts/routes'
import { createLogger } from '../utils/logger'
import {
  clearSidebarUserProfileCache,
  normalizeAccountId,
  readSidebarUserProfileCache,
  type SidebarUserProfile,
  writeSidebarUserProfileCache
} from '../utils/sidebarUserProfileCache'
import { AvatarImage } from './AvatarImage'

import './Sidebar.scss'

const SidebarClearAccountDialog = lazy(() => import('./SidebarClearAccountDialog'))

type SidebarBackgroundTaskCleanup = () => void

const scheduleSidebarBackgroundTask = (task: () => void | Promise<void>): SidebarBackgroundTaskCleanup => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const idleId = window.requestIdleCallback(() => {
      void task()
    }, { timeout: 400 })
    return () => window.cancelIdleCallback(idleId)
  }

  const timer = window.setTimeout(() => {
    void task()
  }, 120)

  return () => window.clearTimeout(timer)
}

function Sidebar() {
  const logger = createLogger('Sidebar')
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [authEnabled, setAuthEnabled] = useState(false)
  const [activeExportTaskCount, setActiveExportTaskCount] = useState(0)
  const [userProfile, setUserProfile] = useState<SidebarUserProfile>({
    wxid: '',
    displayName: '未识别用户'
  })
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const [showClearAccountDialog, setShowClearAccountDialog] = useState(false)
  const [shouldClearCacheData, setShouldClearCacheData] = useState(false)
  const [shouldClearExportData, setShouldClearExportData] = useState(false)
  const [shouldClearProfileData, setShouldClearProfileData] = useState(false)
  const [isClearingAccountData, setIsClearingAccountData] = useState(false)
  const accountCardWrapRef = useRef<HTMLDivElement | null>(null)
  const setLocked = useAppStore(state => state.setLocked)
  const capabilities = usePlatformStore(state => state.capabilities)

  useEffect(() => {
    let disposed = false
    const cleanup = scheduleSidebarBackgroundTask(async () => {
      try {
        const enabled = await auth.verifyEnabled()
        if (!disposed) {
          setAuthEnabled(enabled)
        }
      } catch (error) {
        logger.error('读取锁定状态失败:', error)
      }
    })

    return () => {
      disposed = true
      cleanup()
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!isAccountMenuOpen) return
      const target = event.target as Node | null
      if (accountCardWrapRef.current && target && !accountCardWrapRef.current.contains(target)) {
        setIsAccountMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isAccountMenuOpen])

  useEffect(() => {
    const unsubscribe = onExportSessionStatus((payload) => {
      const countFromPayload = typeof payload?.activeTaskCount === 'number'
        ? payload.activeTaskCount
        : Array.isArray(payload?.inProgressSessionIds)
          ? payload.inProgressSessionIds.length
          : 0
      const normalized = Math.max(0, Math.floor(countFromPayload))
      setActiveExportTaskCount(normalized)
    })

    let followupTimer: number | null = null
    const cleanupInitialRequest = scheduleSidebarBackgroundTask(() => {
      requestExportSessionStatus()
      followupTimer = window.setTimeout(() => requestExportSessionStatus(), 120)
    })

    return () => {
      unsubscribe()
      cleanupInitialRequest()
      if (followupTimer !== null) {
        window.clearTimeout(followupTimer)
      }
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let backgroundTaskCleanups: SidebarBackgroundTaskCleanup[] = []

    const cleanupBackgroundTasks = () => {
      backgroundTaskCleanups.forEach((cleanup) => cleanup())
      backgroundTaskCleanups = []
    }

    const loadCurrentUser = async () => {
      cleanupBackgroundTasks()

      const patchUserProfile = (patch: Partial<SidebarUserProfile>, expectedWxid?: string) => {
        if (disposed) return

        setUserProfile(prev => {
          if (expectedWxid && prev.wxid && prev.wxid !== expectedWxid) {
            return prev
          }
          const next: SidebarUserProfile = {
            ...prev,
            ...patch
          }
          if (!next.displayName) {
            next.displayName = next.wxid || '未识别用户'
          }
          writeSidebarUserProfileCache(next)
          return next
        })
      }

      try {
        const wxid = await configService.getMyWxid()
        if (disposed) return

        const resolvedWxidRaw = String(wxid || '').trim()
        const cleanedWxid = normalizeAccountId(resolvedWxidRaw)
        const resolvedWxid = cleanedWxid || resolvedWxidRaw
        const wxidCandidates = new Set<string>([
          resolvedWxidRaw.toLowerCase(),
          resolvedWxid.trim().toLowerCase(),
          cleanedWxid.trim().toLowerCase()
        ].filter(Boolean))

        const normalizeName = (value?: string | null): string | undefined => {
          if (!value) return undefined
          const trimmed = value.trim()
          if (!trimmed) return undefined
          const lowered = trimmed.toLowerCase()
          if (lowered === 'self') return undefined
          if (lowered.startsWith('wxid_')) return undefined
          if (wxidCandidates.has(lowered)) return undefined
          return trimmed
        }

        const pickFirstValidName = (...candidates: Array<string | null | undefined>): string | undefined => {
          for (const candidate of candidates) {
            const normalized = normalizeName(candidate)
            if (normalized) return normalized
          }
          return undefined
        }

        const pickFirstValidAvatar = (...candidates: Array<string | null | undefined>): string | undefined => {
          for (const candidate of candidates) {
            const normalized = String(candidate || '').trim()
            if (!normalized) continue
            if (normalized === 'NULL' || normalized === 'null' || normalized === 'undefined') continue
            return normalized
          }
          return undefined
        }

        const fallbackDisplayName = resolvedWxid || '未识别用户'

        patchUserProfile({
          wxid: resolvedWxid,
          displayName: fallbackDisplayName
        })

        if (!resolvedWxidRaw && !resolvedWxid) return

        backgroundTaskCleanups.push(scheduleSidebarBackgroundTask(async () => {
          if (disposed) return

          try {
            let myContact: Awaited<ReturnType<typeof chat.getContact>> | null = null
            for (const candidate of Array.from(new Set([resolvedWxidRaw, resolvedWxid, cleanedWxid].filter(Boolean)))) {
              const contact = await chat.getContact(candidate)
              if (!contact) continue
              if (!myContact) myContact = contact
              if (contact.remark || contact.nickName || contact.alias) {
                myContact = contact
                break
              }
            }
            const fromContact = pickFirstValidName(
              myContact?.remark,
              myContact?.nickName,
              myContact?.alias
            )

            if (fromContact) {
              patchUserProfile({ displayName: fromContact }, resolvedWxid)
              if (myContact?.alias) {
                patchUserProfile({ alias: myContact.alias }, resolvedWxid)
              }
              return
            }

            const enrichTargets = Array.from(new Set([resolvedWxidRaw, resolvedWxid, cleanedWxid, 'self'].filter(Boolean)))
            const enrichedResult = await chat.enrichSessionsContactInfo(enrichTargets)
            const enrichedDisplayName = pickFirstValidName(
              enrichedResult.contacts?.[resolvedWxidRaw]?.displayName,
              enrichedResult.contacts?.[resolvedWxid]?.displayName,
              enrichedResult.contacts?.[cleanedWxid]?.displayName,
              enrichedResult.contacts?.self?.displayName,
              myContact?.alias
            )
            if (enrichedDisplayName) {
              patchUserProfile({ displayName: enrichedDisplayName }, resolvedWxid)
            }
            if (myContact?.alias) {
              patchUserProfile({ alias: myContact.alias }, resolvedWxid)
            }
          } catch (nameError) {
            logger.error('加载侧边栏用户昵称失败:', nameError)
          }
        }))

        backgroundTaskCleanups.push(scheduleSidebarBackgroundTask(async () => {
          if (disposed) return

          try {
            const avatarCandidates = Array.from(new Set([resolvedWxidRaw, resolvedWxid, cleanedWxid, 'self'].filter(Boolean)))

            const avatarResult = await chat.getMyAvatarUrl()
            const directAvatarUrl = avatarResult.success ? pickFirstValidAvatar(avatarResult.avatarUrl) : undefined
            if (directAvatarUrl) {
              patchUserProfile({ avatarUrl: directAvatarUrl }, resolvedWxid)
              return
            }

            for (const candidate of avatarCandidates) {
              const contactAvatar = await chat.getContactAvatar(candidate)
              const fallbackAvatarUrl = pickFirstValidAvatar(contactAvatar?.avatarUrl)
              if (fallbackAvatarUrl) {
                patchUserProfile({ avatarUrl: fallbackAvatarUrl }, resolvedWxid)
                return
              }
            }

            const enrichedAvatarResult = await chat.enrichSessionsContactInfo(avatarCandidates, {
              skipDisplayName: true,
              onlyMissingAvatar: true
            })
            const enrichedAvatarUrl = pickFirstValidAvatar(
              enrichedAvatarResult.contacts?.[resolvedWxidRaw]?.avatarUrl,
              enrichedAvatarResult.contacts?.[resolvedWxid]?.avatarUrl,
              enrichedAvatarResult.contacts?.[cleanedWxid]?.avatarUrl,
              enrichedAvatarResult.contacts?.self?.avatarUrl
            )
            if (enrichedAvatarUrl) {
              patchUserProfile({ avatarUrl: enrichedAvatarUrl }, resolvedWxid)
            }
          } catch (avatarError) {
            logger.error('加载侧边栏用户头像失败:', avatarError)
          }
        }))
      } catch (error) {
        logger.error('加载侧边栏用户信息失败:', error)
      }
    }

    const cachedProfile = readSidebarUserProfileCache()
    if (cachedProfile) {
      setUserProfile(prev => ({
        ...prev,
        ...cachedProfile
      }))
    }

    void loadCurrentUser()
    const onWxidChanged = () => { void loadCurrentUser() }
    window.addEventListener('wxid-changed', onWxidChanged as EventListener)
    return () => {
      disposed = true
      cleanupBackgroundTasks()
      window.removeEventListener('wxid-changed', onWxidChanged as EventListener)
    }
  }, [])


  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(`${path}/`)
  }
  const supportsRoute = (path: string) => isRouteSupported(path, capabilities?.supportedRoutes)
  const exportTaskBadge = activeExportTaskCount > 99 ? '99+' : `${activeExportTaskCount}`
  const canConfirmClear = shouldClearCacheData || shouldClearExportData || shouldClearProfileData

  const resetClearDialogState = () => {
    setShouldClearCacheData(false)
    setShouldClearExportData(false)
    setShouldClearProfileData(false)
    setShowClearAccountDialog(false)
  }

  const openClearAccountDialog = () => {
    setIsAccountMenuOpen(false)
    setShouldClearCacheData(false)
    setShouldClearExportData(false)
    setShouldClearProfileData(false)
    setShowClearAccountDialog(true)
  }

  const handleConfirmClearAccountData = async () => {
    if (!canConfirmClear || isClearingAccountData) return
    setIsClearingAccountData(true)
    try {
      const result = await chat.clearCurrentAccountData({
        clearCache: shouldClearCacheData,
        clearExports: shouldClearExportData,
        clearProfile: shouldClearProfileData
      })
      if (!result.success) {
        window.alert(result.error || '清理失败，请稍后重试。')
        return
      }
      clearSidebarUserProfileCache()
      setUserProfile({ wxid: '', displayName: '未识别用户' })
      window.dispatchEvent(new Event('wxid-changed'))

      const removedPaths = Array.isArray(result.removedPaths) ? result.removedPaths : []
      const selectedScopes = [
        shouldClearCacheData ? '缓存数据' : '',
        shouldClearExportData ? '导出数据' : '',
        shouldClearProfileData ? 'profile.json' : ''
      ].filter(Boolean)
      const detailLines: string[] = [
        `清理范围：${selectedScopes.join('、') || '未选择'}`,
        `已清理项目：${removedPaths.length} 项`
      ]
      if (removedPaths.length > 0) {
        detailLines.push('', '清理明细（最多显示 8 项）：')
        for (const [index, path] of removedPaths.slice(0, 8).entries()) {
          detailLines.push(`${index + 1}. ${path}`)
        }
        if (removedPaths.length > 8) {
          detailLines.push(`... 其余 ${removedPaths.length - 8} 项已省略`)
        }
      }
      if (result.warning) {
        detailLines.push('', `注意：${result.warning}`)
      }
      const followupHint = shouldClearCacheData || shouldClearProfileData
        ? '若需再次获取数据，请手动登录微信客户端并重新在 Chat Capsule 完成配置。'
        : '你可以继续使用当前登录状态，无需重新登录。'
      window.alert(`账号数据清理完成。\n\n${detailLines.join('\n')}\n\n为保障数据安全，Chat Capsule 已按选择清理该账号相关数据。${followupHint}`)
      resetClearDialogState()
      if (shouldClearCacheData || shouldClearProfileData) {
        window.location.reload()
      }
    } catch (error) {
      logger.error('清理账号数据失败:', error)
      window.alert('清理失败，请稍后重试。')
    } finally {
      setIsClearingAccountData(false)
    }
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <nav className="nav-menu">
        {/* 首页 */}
        <NavLink
          to="/home"
          className={`nav-item ${isActive('/home') ? 'active' : ''}`}
          title={collapsed ? '首页' : undefined}
        >
          <span className="nav-icon"><Home size={20} /></span>
          <span className="nav-label">首页</span>
        </NavLink>

        {/* 聊天 */}
        <NavLink
          to="/chat"
          className={`nav-item ${isActive('/chat') ? 'active' : ''}`}
          title={collapsed ? '聊天' : undefined}
        >
          <span className="nav-icon"><MessageSquare size={20} /></span>
          <span className="nav-label">聊天</span>
        </NavLink>

        {supportsRoute('/sns') && (
          <NavLink
            to="/sns"
            className={`nav-item ${isActive('/sns') ? 'active' : ''}`}
            title={collapsed ? '朋友圈' : undefined}
          >
            <span className="nav-icon"><Aperture size={20} /></span>
            <span className="nav-label">朋友圈</span>
          </NavLink>
        )}

        {supportsRoute('/contacts') && (
          <NavLink
            to="/contacts"
            className={`nav-item ${isActive('/contacts') ? 'active' : ''}`}
            title={collapsed ? '通讯录' : undefined}
          >
            <span className="nav-icon"><UserCircle size={20} /></span>
            <span className="nav-label">通讯录</span>
          </NavLink>
        )}

        {supportsRoute('/analytics') && (
          <NavLink
            to="/analytics"
            className={`nav-item ${isActive('/analytics') ? 'active' : ''}`}
            title={collapsed ? '私聊分析' : undefined}
          >
            <span className="nav-icon"><BarChart3 size={20} /></span>
            <span className="nav-label">私聊分析</span>
          </NavLink>
        )}

        {supportsRoute('/group-analytics') && (
          <NavLink
            to="/group-analytics"
            className={`nav-item ${isActive('/group-analytics') ? 'active' : ''}`}
            title={collapsed ? '群聊分析' : undefined}
          >
            <span className="nav-icon"><Users size={20} /></span>
            <span className="nav-label">群聊分析</span>
          </NavLink>
        )}

        {/* 导出 */}
        <NavLink
          to="/export"
          className={`nav-item ${isActive('/export') ? 'active' : ''}`}
          title={collapsed ? '导出' : undefined}
        >
          <span className="nav-icon nav-icon-with-badge">
            <Download size={20} />
            {collapsed && activeExportTaskCount > 0 && (
              <span className="nav-badge icon-badge">{exportTaskBadge}</span>
            )}
          </span>
          <span className="nav-label">导出</span>
          {!collapsed && activeExportTaskCount > 0 && (
            <span className="nav-badge">{exportTaskBadge}</span>
          )}
        </NavLink>


      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user-card-wrap" ref={accountCardWrapRef}>
          {isAccountMenuOpen && (
            <button
              className="sidebar-user-clear-trigger"
              onClick={openClearAccountDialog}
              type="button"
            >
              <span className="sidebar-user-clear-trigger-main">
                <span className="sidebar-user-clear-trigger-avatar">
                  <AvatarImage src={userProfile.avatarUrl} name={userProfile.displayName} alt="" loading="eager" />
                </span>
                <span className="sidebar-user-clear-trigger-label">清除此账号所有数据</span>
              </span>
              <Trash2 size={14} className="sidebar-user-clear-trigger-icon" />
            </button>
          )}
          <div
            className={`sidebar-user-card ${isAccountMenuOpen ? 'menu-open' : ''}`}
            title={collapsed ? `${userProfile.displayName}${(userProfile.alias || userProfile.wxid) ? `\n${userProfile.alias || userProfile.wxid}` : ''}` : undefined}
            onClick={() => setIsAccountMenuOpen(prev => !prev)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setIsAccountMenuOpen(prev => !prev)
              }
            }}
          >
            <div className="user-avatar">
              <AvatarImage src={userProfile.avatarUrl} name={userProfile.displayName} alt="" loading="eager" />
            </div>
            <div className="user-meta">
              <div className="user-name">{userProfile.displayName}</div>
              <div className="user-wxid">{userProfile.alias || userProfile.wxid || 'wxid 未识别'}</div>
            </div>
            {!collapsed && (
              <span className={`user-menu-caret ${isAccountMenuOpen ? 'open' : ''}`}>
                <ChevronUp size={14} />
              </span>
            )}
          </div>
        </div>

        <button
          className="nav-item"
          onClick={() => {
            if (authEnabled) {
              setLocked(true)
              return
            }
            navigate('/settings', { state: { initialTab: 'security' } })
          }}
          title={collapsed ? (authEnabled ? '锁定' : '未锁定') : undefined}
        >
          <span className="nav-icon">{authEnabled ? <Lock size={20} /> : <LockOpen size={20} />}</span>
          <span className="nav-label">{authEnabled ? '锁定' : '未锁定'}</span>
        </button>

        <NavLink
          to="/settings"
          className={`nav-item ${isActive('/settings') ? 'active' : ''}`}
          title={collapsed ? '设置' : undefined}
        >
          <span className="nav-icon">
            <Settings size={20} />
          </span>
          <span className="nav-label">设置</span>
        </NavLink>

        <button
          className="collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? '展开菜单' : '收起菜单'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {showClearAccountDialog && (
        <Suspense fallback={null}>
          <SidebarClearAccountDialog
            accountDisplayName={userProfile.displayName || '当前账号'}
            accountSecondaryText={userProfile.alias || userProfile.wxid || 'wxid 未识别'}
            accountAvatarUrl={userProfile.avatarUrl}
            canConfirmClear={canConfirmClear}
            isClearingAccountData={isClearingAccountData}
            shouldClearCacheData={shouldClearCacheData}
            shouldClearExportData={shouldClearExportData}
            shouldClearProfileData={shouldClearProfileData}
            onClose={resetClearDialogState}
            onConfirm={handleConfirmClearAccountData}
            onClearCacheDataChange={setShouldClearCacheData}
            onClearExportDataChange={setShouldClearExportData}
            onClearProfileDataChange={setShouldClearProfileData}
          />
        </Suspense>
      )}
    </aside>
  )
}

export default Sidebar
