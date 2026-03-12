import { app, BrowserWindow, nativeTheme, screen } from 'electron'
import { existsSync } from 'fs'
import { applyWindowSecurity } from '../security/runtimeSecurity'
import { createElectronLogger } from '../utils/debug'
import type { OpenSessionChatWindowOptions } from './types'
import { resolveWindowRuntimePaths } from './windowPaths'

interface WindowManagerContext {
  getIsAppQuitting: () => boolean
}

const logger = createElectronLogger('windowManager')

function normalizeSessionChatWindowSource(source: unknown): 'chat' | 'export' {
  return String(source || '').trim().toLowerCase() === 'export' ? 'export' : 'chat'
}

function normalizeSessionChatWindowOptionString(value: unknown): string {
  return String(value || '').trim()
}

function resolveWindowIconPath(): string | undefined {
  const runtimePaths = resolveWindowRuntimePaths(__dirname, process.resourcesPath, process.platform)

  for (const candidate of runtimePaths.iconCandidates) {
    if (existsSync(candidate)) return candidate
  }

  if (existsSync(runtimePaths.bundledIconPath)) {
    return runtimePaths.bundledIconPath
  }

  return undefined
}

function loadRendererRoute(win: BrowserWindow, hashPath: string): void {
  const runtimePaths = resolveWindowRuntimePaths(__dirname, process.resourcesPath, process.platform)
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#${hashPath}`)
    return
  }

  win.loadFile(runtimePaths.rendererIndexPath, {
    hash: hashPath
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function createWindowFailureHtml(title: string, detail: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        box-sizing: border-box;
        background: #111827;
        color: #f9fafb;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .card {
        max-width: 620px;
        padding: 24px 28px;
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(17, 24, 39, 0.92);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 22px;
      }
      p {
        margin: 0 0 12px;
        line-height: 1.6;
        white-space: pre-wrap;
      }
      .hint {
        margin-bottom: 0;
        opacity: 0.8;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(detail)}</p>
      <p class="hint">应用已阻止继续显示空白页。请重开最新构建；若仍复现，日志里会记录具体 preload / load / render 故障。</p>
    </div>
  </body>
</html>`
}

function showWindowFailurePage(win: BrowserWindow, label: string, title: string, detail: string): void {
  if (win.isDestroyed()) return
  const fallbackUrl = `data:text/html;charset=utf-8,${encodeURIComponent(createWindowFailureHtml(title, detail))}`
  win.loadURL(fallbackUrl).catch((error: unknown) => {
    logger.error(`[${label}] failed to load fallback page`, {
      error: error instanceof Error ? error.message : String(error)
    })
  })
  if (!win.isVisible()) {
    win.show()
  }
}

function attachWindowDiagnostics(win: BrowserWindow, label: string): void {
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    logger.error(`[${label}] preload error`, { preloadPath, error: error?.message || String(error) })
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logger.error(`[${label}] did fail load`, { errorCode, errorDescription, validatedURL, isMainFrame })
    if (!isMainFrame || errorCode === -3) {
      return
    }
    showWindowFailurePage(
      win,
      label,
      'Chat Capsule 页面加载失败',
      `${errorDescription} (${errorCode})
${validatedURL || 'unknown url'}`
    )
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`[${label}] render process gone`, details)
    const reason = typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details)
    showWindowFailurePage(win, label, 'Chat Capsule 渲染进程异常退出', reason)
  })
  win.webContents.on('console-message', (event, levelOrMessage, messageArg, lineArg, sourceIdArg) => {
    const messageDetails = typeof levelOrMessage === 'object' && levelOrMessage !== null
      ? levelOrMessage as {
          level?: number
          message?: string
          lineNumber?: number
          sourceId?: string
        }
      : null

    const payload = messageDetails
      ? {
          level: Number(messageDetails.level || 0),
          message: String(messageDetails.message || ''),
          line: Number(messageDetails.lineNumber || 0),
          sourceId: String(messageDetails.sourceId || '')
        }
      : {
          level: Number(levelOrMessage || 0),
          message: String(messageArg || ''),
          line: Number(lineArg || 0),
          sourceId: String(sourceIdArg || '')
        }

    if (payload.level >= 2) {
      logger.error(`[${label}] renderer console`, payload)
    } else {
      logger.warn(`[${label}] renderer console`, payload)
    }
  })
}

function enableDevToolsShortcut(win: BrowserWindow): void {
  if (!process.env.VITE_DEV_SERVER_URL) return

  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools()
      } else {
        win.webContents.openDevTools()
      }
      event.preventDefault()
    }
  })
}

function loadSessionChatWindowContent(
  win: BrowserWindow,
  sessionId: string,
  source: 'chat' | 'export',
  options?: OpenSessionChatWindowOptions
): void {
  const queryParams = new URLSearchParams({
    sessionId,
    source
  })

  const initialDisplayName = normalizeSessionChatWindowOptionString(options?.initialDisplayName)
  const initialAvatarUrl = normalizeSessionChatWindowOptionString(options?.initialAvatarUrl)
  const initialContactType = normalizeSessionChatWindowOptionString(options?.initialContactType)
  if (initialDisplayName) queryParams.set('initialDisplayName', initialDisplayName)
  if (initialAvatarUrl) queryParams.set('initialAvatarUrl', initialAvatarUrl)
  if (initialContactType) queryParams.set('initialContactType', initialContactType)

  const query = queryParams.toString()
  loadRendererRoute(win, `/chat-window?${query}`)
}

export function createWindowManager({ getIsAppQuitting }: WindowManagerContext) {
  let mainWindow: BrowserWindow | null = null
  let agreementWindow: BrowserWindow | null = null
  let onboardingWindow: BrowserWindow | null = null
  let splashWindow: BrowserWindow | null = null
  let mainWindowReady = false
  let mainWindowReadyResolvers: Array<() => void> = []
  const sessionChatWindows = new Map<string, BrowserWindow>()
  const sessionChatWindowSources = new Map<string, 'chat' | 'export'>()

  const resolveMainWindowReady = () => {
    if (mainWindowReady) return
    mainWindowReady = true
    const resolvers = mainWindowReadyResolvers
    mainWindowReadyResolvers = []
    resolvers.forEach((resolve) => resolve())
  }

  const createMainWindow = (options: { autoShow?: boolean } = {}): BrowserWindow => {
    const { autoShow = true } = options
    const iconPath = resolveWindowIconPath()
    const runtimePaths = resolveWindowRuntimePaths(__dirname, process.resourcesPath, process.platform)

    mainWindowReady = false
    mainWindowReadyResolvers = []

    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1000,
      minHeight: 700,
      icon: iconPath,
      webPreferences: {
        preload: runtimePaths.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
                webSecurity: true
      },
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#1a1a1a',
        height: 40
      },
      show: false
    })

    applyWindowSecurity(win)
    attachWindowDiagnostics(win, 'main')
    enableDevToolsShortcut(win)

    win.once('ready-to-show', () => {
      resolveMainWindowReady()
      if (autoShow && !splashWindow) {
        win.show()
      }
    })

    if (process.env.VITE_DEV_SERVER_URL) {
      win.loadURL(process.env.VITE_DEV_SERVER_URL)
    } else {
      win.loadFile(runtimePaths.rendererIndexPath)
    }

    win.on('closed', () => {
      if (mainWindow !== win) return

      mainWindow = null
      mainWindowReady = false
      mainWindowReadyResolvers = []

      if (process.platform !== 'darwin' && !getIsAppQuitting()) {
        if (BrowserWindow.getAllWindows().length === 0) {
          app.quit()
        }
      }
    })

    mainWindow = win
    return win
  }

  const createAgreementWindow = (): BrowserWindow => {
    if (agreementWindow && !agreementWindow.isDestroyed()) {
      agreementWindow.focus()
      return agreementWindow
    }

    const iconPath = resolveWindowIconPath()
    const runtimePaths = resolveWindowRuntimePaths(__dirname, process.resourcesPath, process.platform)
    const isDark = nativeTheme.shouldUseDarkColors

    agreementWindow = new BrowserWindow({
      width: 700,
      height: 600,
      minWidth: 500,
      minHeight: 400,
      icon: iconPath,
      webPreferences: {
        preload: runtimePaths.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
                webSecurity: true
      },
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: isDark ? '#FFFFFF' : '#333333',
        height: 32
      },
      show: false,
      backgroundColor: isDark ? '#1A1A1A' : '#FFFFFF'
    })

    applyWindowSecurity(agreementWindow)
    attachWindowDiagnostics(agreementWindow, 'agreement')
    agreementWindow.once('ready-to-show', () => agreementWindow?.show())
    loadRendererRoute(agreementWindow, '/agreement-window')
    agreementWindow.on('closed', () => {
      agreementWindow = null
    })

    return agreementWindow
  }

  const createSplashWindow = (): BrowserWindow => {
    const iconPath = resolveWindowIconPath()
    const runtimePaths = resolveWindowRuntimePaths(__dirname, process.resourcesPath, process.platform)

    splashWindow = new BrowserWindow({
      width: 760,
      height: 460,
      resizable: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      center: true,
      skipTaskbar: false,
      icon: iconPath,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
                webSecurity: true
      },
      show: false
    })

    applyWindowSecurity(splashWindow)
    attachWindowDiagnostics(splashWindow, 'splash')

    if (process.env.VITE_DEV_SERVER_URL) {
      splashWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}splash.html`)
    } else {
      splashWindow.loadFile(runtimePaths.splashHtmlPath)
    }

    splashWindow.once('ready-to-show', () => splashWindow?.show())
    splashWindow.on('closed', () => {
      splashWindow = null
    })
    return splashWindow
  }

  const updateSplashProgress = (percent: number, text: string, indeterminate = false): void => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents
        .executeJavaScript(`updateProgress(${percent}, ${JSON.stringify(text)}, ${indeterminate})`)
        .catch(() => {})
    }
  }

  const closeSplash = (): void => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
      splashWindow = null
    }
  }

  const createOnboardingWindow = (): BrowserWindow => {
    if (onboardingWindow && !onboardingWindow.isDestroyed()) {
      onboardingWindow.focus()
      return onboardingWindow
    }

    const iconPath = resolveWindowIconPath()
    const runtimePaths = resolveWindowRuntimePaths(__dirname, process.resourcesPath, process.platform)

    onboardingWindow = new BrowserWindow({
      width: 960,
      height: 680,
      minWidth: 900,
      minHeight: 620,
      resizable: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      icon: iconPath,
      webPreferences: {
        preload: runtimePaths.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
                webSecurity: true
      },
      show: false
    })

    applyWindowSecurity(onboardingWindow)
    attachWindowDiagnostics(onboardingWindow, 'onboarding')
    onboardingWindow.once('ready-to-show', () => onboardingWindow?.show())
    loadRendererRoute(onboardingWindow, '/onboarding-window')
    onboardingWindow.on('closed', () => {
      onboardingWindow = null
    })

    return onboardingWindow
  }

  const createVideoPlayerWindow = (videoPath: string, videoWidth?: number, videoHeight?: number): BrowserWindow => {
    const iconPath = resolveWindowIconPath()
    const runtimePaths = resolveWindowRuntimePaths(__dirname, process.resourcesPath, process.platform)
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

    let winWidth = 854
    let winHeight = 520
    const titleBarHeight = 40

    if (videoWidth && videoHeight && videoWidth > 0 && videoHeight > 0) {
      const aspectRatio = videoWidth / videoHeight
      const maxWidth = Math.floor(screenWidth * 0.85)
      const maxHeight = Math.floor(screenHeight * 0.85)

      if (aspectRatio >= 1) {
        winWidth = Math.min(videoWidth, maxWidth)
        winHeight = Math.floor(winWidth / aspectRatio) + titleBarHeight

        if (winHeight > maxHeight) {
          winHeight = maxHeight
          winWidth = Math.floor((winHeight - titleBarHeight) * aspectRatio)
        }
      } else {
        const videoDisplayHeight = Math.min(videoHeight, maxHeight - titleBarHeight)
        winHeight = videoDisplayHeight + titleBarHeight
        winWidth = Math.floor(videoDisplayHeight * aspectRatio)

        if (winWidth < 300) {
          winWidth = 300
          winHeight = Math.floor(winWidth / aspectRatio) + titleBarHeight
        }
      }

      winWidth = Math.max(winWidth, 360)
      winHeight = Math.max(winHeight, 280)
    }

    const win = new BrowserWindow({
      width: winWidth,
      height: winHeight,
      minWidth: 360,
      minHeight: 280,
      icon: iconPath,
      webPreferences: {
        preload: runtimePaths.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
                webSecurity: true
      },
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#1a1a1a',
        symbolColor: '#ffffff',
        height: 40
      },
      show: false,
      backgroundColor: '#000000',
      autoHideMenuBar: true
    })

    applyWindowSecurity(win)
    attachWindowDiagnostics(win, 'main')
    enableDevToolsShortcut(win)
    win.once('ready-to-show', () => win.show())

    const videoParam = `videoPath=${encodeURIComponent(videoPath)}`
    loadRendererRoute(win, `/video-player-window?${videoParam}`)
    return win
  }

  const createImageViewerWindow = (imagePath: string, liveVideoPath?: string): BrowserWindow => {
    const iconPath = resolveWindowIconPath()
    const runtimePaths = resolveWindowRuntimePaths(__dirname, process.resourcesPath, process.platform)

    const win = new BrowserWindow({
      width: 900,
      height: 700,
      minWidth: 400,
      minHeight: 300,
      icon: iconPath,
      webPreferences: {
        preload: runtimePaths.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
                webSecurity: true
      },
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#ffffff',
        height: 40
      },
      show: false,
      backgroundColor: '#000000',
      autoHideMenuBar: true
    })

    applyWindowSecurity(win)
    attachWindowDiagnostics(win, 'main')
    enableDevToolsShortcut(win)
    win.once('ready-to-show', () => win.show())

    let imageParam = `imagePath=${encodeURIComponent(imagePath)}`
    if (liveVideoPath) imageParam += `&liveVideoPath=${encodeURIComponent(liveVideoPath)}`
    loadRendererRoute(win, `/image-viewer-window?${imageParam}`)
    return win
  }

  const createChatHistoryWindow = (sessionId: string, messageId: number): BrowserWindow => {
    const iconPath = resolveWindowIconPath()
    const runtimePaths = resolveWindowRuntimePaths(__dirname, process.resourcesPath, process.platform)
    const isDark = nativeTheme.shouldUseDarkColors

    const win = new BrowserWindow({
      width: 600,
      height: 800,
      minWidth: 400,
      minHeight: 500,
      icon: iconPath,
      webPreferences: {
        preload: runtimePaths.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
                webSecurity: true
      },
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: isDark ? '#ffffff' : '#1a1a1a',
        height: 32
      },
      show: false,
      backgroundColor: isDark ? '#1A1A1A' : '#F0F0F0',
      autoHideMenuBar: true
    })

    applyWindowSecurity(win)
    attachWindowDiagnostics(win, 'main')
    enableDevToolsShortcut(win)
    win.once('ready-to-show', () => win.show())
    loadRendererRoute(win, `/chat-history/${sessionId}/${messageId}`)
    return win
  }

  const createSessionChatWindow = (sessionId: string, options?: OpenSessionChatWindowOptions): BrowserWindow | null => {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return null

    const normalizedSource = normalizeSessionChatWindowSource(options?.source)
    const existing = sessionChatWindows.get(normalizedSessionId)
    if (existing && !existing.isDestroyed()) {
      const trackedSource = sessionChatWindowSources.get(normalizedSessionId) || 'chat'
      if (trackedSource !== normalizedSource) {
        loadSessionChatWindowContent(existing, normalizedSessionId, normalizedSource, options)
        sessionChatWindowSources.set(normalizedSessionId, normalizedSource)
      }
      if (existing.isMinimized()) {
        existing.restore()
      }
      existing.focus()
      return existing
    }

    const iconPath = resolveWindowIconPath()
    const runtimePaths = resolveWindowRuntimePaths(__dirname, process.resourcesPath, process.platform)
    const isDark = nativeTheme.shouldUseDarkColors

    const win = new BrowserWindow({
      width: 600,
      height: 820,
      minWidth: 420,
      minHeight: 560,
      icon: iconPath,
      webPreferences: {
        preload: runtimePaths.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
                webSecurity: true
      },
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: isDark ? '#ffffff' : '#1a1a1a',
        height: 40
      },
      show: false,
      backgroundColor: isDark ? '#1A1A1A' : '#F0F0F0',
      autoHideMenuBar: true
    })

    applyWindowSecurity(win)
    attachWindowDiagnostics(win, 'main')
    enableDevToolsShortcut(win)
    loadSessionChatWindowContent(win, normalizedSessionId, normalizedSource, options)

    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })

    win.on('closed', () => {
      const tracked = sessionChatWindows.get(normalizedSessionId)
      if (tracked === win) {
        sessionChatWindows.delete(normalizedSessionId)
        sessionChatWindowSources.delete(normalizedSessionId)
      }
    })

    sessionChatWindows.set(normalizedSessionId, win)
    sessionChatWindowSources.set(normalizedSessionId, normalizedSource)
    return win
  }

  const showMainWindow = (): void => {
    if (mainWindowReady) {
      mainWindow?.show()
      return
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.once('ready-to-show', () => mainWindow?.show())
    }
  }

  const waitForMainWindowReady = async (): Promise<void> => {
    if (mainWindowReady || !mainWindow || mainWindow.isDestroyed()) {
      return
    }

    await new Promise<void>((resolve) => {
      mainWindowReadyResolvers.push(resolve)
    })
  }

  return {
    createMainWindow,
    createAgreementWindow,
    createSplashWindow,
    updateSplashProgress,
    closeSplash,
    createOnboardingWindow,
    createVideoPlayerWindow,
    createImageViewerWindow,
    createChatHistoryWindow,
    createSessionChatWindow,
    showMainWindow,
    waitForMainWindowReady,
    isMainWindowReady: () => mainWindowReady,
    getMainWindow: () => mainWindow,
    getOnboardingWindow: () => onboardingWindow,
    getSplashWindow: () => splashWindow
  }
}
