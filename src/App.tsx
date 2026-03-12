import { Suspense, lazy, useEffect, useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import RouteGuard from './components/RouteGuard'

import { useAppStore } from './stores/appStore'
import { usePlatformStore } from './stores/platformStore'
import { themes, useThemeStore, type ThemeId, type ThemeMode } from './stores/themeStore'
import * as configService from './services/config'
import { app, auth, chat, electronApi, windowControl } from './services/ipc'
import { Loader2 } from 'lucide-react'
import { isRouteSupported } from '../shared/contracts/routes'
import { useShallow } from 'zustand/react/shallow'
import { createLogger } from './utils/logger'
import { readStringStorage, writeStringStorage } from './utils/localStorageCache'
import './App.scss'


const WelcomePage = lazy(() => import('./pages/WelcomePage'))
const HomePage = lazy(() => import('./pages/HomePage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))
const AnalyticsWelcomePage = lazy(() => import('./pages/AnalyticsWelcomePage'))
const AgreementPage = lazy(() => import('./pages/AgreementPage'))
const GroupAnalyticsPage = lazy(() => import('./pages/GroupAnalyticsPage'))
const ExportPage = lazy(() => import('./pages/ExportPage'))
const VideoWindow = lazy(() => import('./pages/VideoWindow'))
const ImageWindow = lazy(() => import('./pages/ImageWindow'))
const SnsPage = lazy(() => import('./pages/SnsPage'))
const ContactsPage = lazy(() => import('./pages/ContactsPage'))
const ChatHistoryPage = lazy(() => import('./pages/ChatHistoryPage'))
const MacSettingsPage = lazy(() => import('./pages/MacSettingsPage'))
const TitleBar = lazy(() => import('./components/TitleBar'))
const Sidebar = lazy(() => import('./components/Sidebar'))
const LockScreen = lazy(() => import('./components/LockScreen'))
const BatchImageDecryptGlobal = lazy(async () => {
  const module = await import('./components/BatchImageDecryptGlobal')
  return { default: module.BatchImageDecryptGlobal }
})
const BatchTranscribeGlobal = lazy(async () => {
  const module = await import('./components/BatchTranscribeGlobal')
  return { default: module.BatchTranscribeGlobal }
})
const AgreementModal = lazy(() => import('./components/AgreementModal'))

function RouteLoadingFallback({ embedded = false }: { embedded?: boolean }) {
  return (
    <div className={`route-loading-fallback${embedded ? ' embedded' : ''}`}>
      <div className="route-loading-indicator" role="status" aria-live="polite">
        <Loader2 size={18} className="route-loading-icon" />
        <span>页面加载中...</span>
      </div>
    </div>
  )
}

function App() {
  const logger = createLogger('App')
  const navigate = useNavigate()
  const location = useLocation()

  const {
    setDbConnected,
    isLocked,
    setLocked
  } = useAppStore(useShallow((state) => ({
    setDbConnected: state.setDbConnected,
    isLocked: state.isLocked,
    setLocked: state.setLocked
  })))

  const { currentTheme, themeMode, setTheme, setThemeMode } = useThemeStore(useShallow((state) => ({
    currentTheme: state.currentTheme,
    themeMode: state.themeMode,
    setTheme: state.setTheme,
    setThemeMode: state.setThemeMode
  })))
  const { capabilities, loadCapabilities } = usePlatformStore(useShallow((state) => ({
    capabilities: state.capabilities,
    loadCapabilities: state.loadCapabilities
  })))
  const isAgreementWindow = location.pathname === '/agreement-window'
  const isOnboardingWindow = location.pathname === '/onboarding-window'
  const isVideoPlayerWindow = location.pathname === '/video-player-window'
  const isImageViewerWindow = location.pathname === '/image-viewer-window'
  const isChatHistoryWindow = location.pathname.startsWith('/chat-history/')
  const isStandaloneChatWindow = location.pathname === '/chat-window'
  const supportsRoute = (path: string) => isRouteSupported(path, capabilities?.supportedRoutes)
  const [themeHydrated, setThemeHydrated] = useState(false)

  // 锁定状态
  // const [isLocked, setIsLocked] = useState(false) // Moved to store
  const [lockAvatar, setLockAvatar] = useState<string | undefined>(
    readStringStorage('app_lock_avatar') || undefined
  )
  const [lockUseHello, setLockUseHello] = useState(false)

  // 协议同意状态
  const [showAgreement, setShowAgreement] = useState(false)
  const [agreementChecked, setAgreementChecked] = useState(false)
  const [agreementLoading, setAgreementLoading] = useState(true)


  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    const appRoot = document.getElementById('app')

    if (isOnboardingWindow) {
      root.style.background = 'transparent'
      body.style.background = 'transparent'
      body.style.overflow = 'hidden'
      if (appRoot) {
        appRoot.style.background = 'transparent'
        appRoot.style.overflow = 'hidden'
      }
    } else {
      root.style.background = 'var(--bg-primary)'
      body.style.background = 'var(--bg-primary)'
      body.style.overflow = ''
      if (appRoot) {
        appRoot.style.background = ''
        appRoot.style.overflow = ''
      }
    }
  }, [isOnboardingWindow])

  // 应用主题
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const applyMode = (mode: ThemeMode, systemDark?: boolean) => {
      const effectiveMode = mode === 'system' ? (systemDark ?? mq.matches ? 'dark' : 'light') : mode
      document.documentElement.setAttribute('data-theme', currentTheme)
      document.documentElement.setAttribute('data-mode', effectiveMode)
      const symbolColor = effectiveMode === 'dark' ? '#ffffff' : '#1a1a1a'
      if (!isOnboardingWindow) {
        windowControl.setTitleBarOverlay({ symbolColor })
      }
    }

    applyMode(themeMode)

    // 监听系统主题变化
    const handler = (e: MediaQueryListEvent) => {
      if (useThemeStore.getState().themeMode === 'system') {
        applyMode('system', e.matches)
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [currentTheme, themeMode, isOnboardingWindow])

  useEffect(() => {
    if (capabilities?.platform) {
      document.documentElement.setAttribute('data-platform', capabilities.platform)
      return
    }
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('mac')) {
      document.documentElement.setAttribute('data-platform', 'macos')
    } else if (ua.includes('win')) {
      document.documentElement.setAttribute('data-platform', 'windows')
    } else {
      document.documentElement.setAttribute('data-platform', 'linux')
    }
  }, [capabilities?.platform])

  useEffect(() => {
    const isWelcomeRoute = location.pathname === '/'
    if (isAgreementWindow || isVideoPlayerWindow || isImageViewerWindow || isChatHistoryWindow || isStandaloneChatWindow || isWelcomeRoute) {
      return
    }
    void loadCapabilities()
  }, [isAgreementWindow, isVideoPlayerWindow, isImageViewerWindow, isChatHistoryWindow, isStandaloneChatWindow, location.pathname, loadCapabilities])

  // 读取已保存的主题设置
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const [savedThemeId, savedThemeMode] = await Promise.all([
          configService.getThemeId(),
          configService.getTheme()
        ])
        if (savedThemeId && themes.some((theme) => theme.id === savedThemeId)) {
          setTheme(savedThemeId as ThemeId)
        }
        if (savedThemeMode === 'light' || savedThemeMode === 'dark' || savedThemeMode === 'system') {
          setThemeMode(savedThemeMode)
        }
      } catch (e) {
        logger.error('读取主题配置失败:', e)
      } finally {
        setThemeHydrated(true)
      }
    }
    loadTheme()
  }, [setTheme, setThemeMode])

  // 保存主题设置
  useEffect(() => {
    if (!themeHydrated) return
    const saveTheme = async () => {
      try {
        await Promise.all([
          configService.setThemeId(currentTheme),
          configService.setTheme(themeMode)
        ])
      } catch (e) {
        logger.error('保存主题配置失败:', e)
      }
    }
    saveTheme()
  }, [currentTheme, themeMode, themeHydrated])

  // 检查是否已同意协议
  useEffect(() => {
    if (isAgreementWindow || isOnboardingWindow || isVideoPlayerWindow || isImageViewerWindow || isChatHistoryWindow || isStandaloneChatWindow) {
      setAgreementLoading(false)
      return
    }

    const checkAgreement = async () => {
      try {
        const agreed = await configService.getAgreementAccepted()
        if (!agreed) {
          setShowAgreement(true)
        }
      } catch (e) {
        logger.error('检查协议状态失败:', e)
      } finally {
        setAgreementLoading(false)
      }
    }
    checkAgreement()
  }, [isAgreementWindow, isOnboardingWindow, isVideoPlayerWindow, isImageViewerWindow, isChatHistoryWindow, isStandaloneChatWindow])

  const handleAgree = async () => {
    if (!agreementChecked) return
    await configService.setAgreementAccepted(true)
    setShowAgreement(false)
  }

  const handleDisagree = () => {
    windowControl.close()
  }

  // 启动时自动检查配置并连接数据库
  useEffect(() => {
    if (isAgreementWindow || isOnboardingWindow || isVideoPlayerWindow || isImageViewerWindow) return

    const autoConnect = async () => {
      try {
        const macProfileMode = capabilities?.mode === 'mac-profile' && capabilities?.profile?.profileLoaded

        if (macProfileMode) {
          const onboardingDone = await configService.getOnboardingDone()
          const wxid = capabilities?.profile?.wxid || await configService.getMyWxid()
          if (!wxid) return

          if (!onboardingDone) {
            await configService.setOnboardingDone(true)
          }

          const result = await chat.connect()
          if (result.success) {
            setDbConnected(true, capabilities?.profile?.accountRoot || capabilities?.profile?.dbStoragePath || undefined)
            if (window.location.hash === '#/' || window.location.hash === '') {
              navigate('/home')
            }
          }
          return
        }

        const [onboardingDone, dbPath, decryptKey, wxid] = await Promise.all([
          configService.getOnboardingDone(),
          configService.getDbPath(),
          configService.getDecryptKey(),
          configService.getMyWxid()
        ])
        const wxidConfig = wxid ? await configService.getWxidConfig(wxid) : null
        const effectiveDecryptKey = wxidConfig?.decryptKey || decryptKey

        if (wxidConfig?.decryptKey && wxidConfig.decryptKey !== decryptKey) {
          await configService.setDecryptKey(wxidConfig.decryptKey)
        }

        if (dbPath && effectiveDecryptKey && wxid) {
          if (!onboardingDone) {
            await configService.setOnboardingDone(true)
          }

          const result = await chat.connect()

          if (result.success) {
            setDbConnected(true, dbPath)
            if (window.location.hash === '#/' || window.location.hash === '') {
              navigate('/home')
            }
          } else {
            const errorMsg = result.error || ''
            if (errorMsg.includes('Visual C++') ||
              errorMsg.includes('DLL') ||
              errorMsg.includes('Worker') ||
              errorMsg.includes('126') ||
              errorMsg.includes('模块')) {
              logger.warn('检测到可能的运行时依赖问题:', errorMsg)
            }
          }
        }
      } catch (e) {
        logger.error('自动连接出错:', e)
      }
    }

    autoConnect()
  }, [capabilities, isAgreementWindow, isOnboardingWindow, isVideoPlayerWindow, isImageViewerWindow, navigate, setDbConnected])

  // 检查应用锁
  useEffect(() => {
    if (isAgreementWindow || isOnboardingWindow || isVideoPlayerWindow) return

    let disposed = false
    let avatarTimer: number | null = null

    const checkLock = async () => {
      try {
        const enabled = await auth.verifyEnabled()
        if (!enabled || disposed) return

        setLocked(true)

        const useHello = await configService.getAuthUseHello()
        if (!disposed) {
          setLockUseHello(useHello)
        }

        avatarTimer = window.setTimeout(async () => {
          try {
            const result = await chat.getMyAvatarUrl()
            if (!disposed && result && result.success && result.avatarUrl) {
              setLockAvatar(result.avatarUrl)
              writeStringStorage('app_lock_avatar', result.avatarUrl)
            }
          } catch (e) {
            logger.error('获取锁屏头像失败:', e)
          }
        }, 120)
      } catch (error) {
        logger.error('检查应用锁失败:', error)
      }
    }
    checkLock()

    return () => {
      disposed = true
      if (avatarTimer !== null) {
        window.clearTimeout(avatarTimer)
      }
    }
  }, [isAgreementWindow, isOnboardingWindow, isVideoPlayerWindow, setLocked])

  // 独立协议窗口
  if (isAgreementWindow) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <AgreementPage />
      </Suspense>
    )
  }

  if (isOnboardingWindow) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <WelcomePage standalone />
      </Suspense>
    )
  }

  // 独立视频播放窗口
  if (isVideoPlayerWindow) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <VideoWindow />
      </Suspense>
    )
  }

  // 独立图片查看窗口
  if (isImageViewerWindow) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <ImageWindow />
      </Suspense>
    )
  }

  // 独立聊天记录窗口
  if (isChatHistoryWindow) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <ChatHistoryPage />
      </Suspense>
    )
  }

  // 独立会话聊天窗口（仅显示聊天内容区域）
  if (isStandaloneChatWindow) {
    const params = new URLSearchParams(location.search)
    const sessionId = params.get('sessionId') || ''
    const standaloneSource = params.get('source')
    const standaloneInitialDisplayName = params.get('initialDisplayName')
    const standaloneInitialAvatarUrl = params.get('initialAvatarUrl')
    const standaloneInitialContactType = params.get('initialContactType')
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <ChatPage
          standaloneSessionWindow
          initialSessionId={sessionId}
          standaloneSource={standaloneSource}
          standaloneInitialDisplayName={standaloneInitialDisplayName}
          standaloneInitialAvatarUrl={standaloneInitialAvatarUrl}
          standaloneInitialContactType={standaloneInitialContactType}
        />
      </Suspense>
    )
  }


  // 主窗口 - 完整布局
  return (
    <div className="app-container">
      <div className="window-drag-region" aria-hidden="true" />
      {isLocked && (
        <Suspense fallback={null}>
          <LockScreen
            onUnlock={() => setLocked(false)}
            avatar={lockAvatar}
            useHello={lockUseHello}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <TitleBar />
      </Suspense>

      <div className="main-layout">
        <Suspense fallback={null}>
          <Sidebar />
        </Suspense>
        <main className="content">
          <RouteGuard>

      {/* 全局批量图片解密进度浮窗 */}
      <Suspense fallback={null}>
        <BatchImageDecryptGlobal />
      </Suspense>

      {/* 全局批量转写进度浮窗 */}
      <Suspense fallback={null}>
        <BatchTranscribeGlobal />
      </Suspense>

      {/* 用户协议弹窗 */}
      {showAgreement && !agreementLoading && (
        <Suspense fallback={null}>
          <AgreementModal
            agreementChecked={agreementChecked}
            onAgreementCheckedChange={setAgreementChecked}
            onAgree={handleAgree}
            onDisagree={handleDisagree}
          />
        </Suspense>
      )}

      <Suspense fallback={<RouteLoadingFallback embedded />}>
            <Routes>
              <Route path="/" element={<WelcomePage />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/chat" element={<ChatPage />} />

              {supportsRoute("/analytics") && <Route path="/analytics" element={<AnalyticsWelcomePage />} />}
              {supportsRoute("/analytics") && <Route path="/analytics/view" element={<AnalyticsPage />} />}
              {supportsRoute("/group-analytics") && <Route path="/group-analytics" element={<GroupAnalyticsPage />} />}

              <Route path="/settings" element={<MacSettingsPage />} />
              <Route path="/export" element={<ExportPage />} />
              {supportsRoute("/sns") && <Route path="/sns" element={<SnsPage />} />}
              {supportsRoute("/contacts") && <Route path="/contacts" element={<ContactsPage />} />}
              <Route path="/chat-history/:sessionId/:messageId" element={<ChatHistoryPage />} />
            </Routes>
          </Suspense>
          </RouteGuard>
        </main>
      </div>
    </div>
  )
}

export default App
