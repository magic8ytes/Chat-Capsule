import { app, BrowserWindow, session } from 'electron'
import { ConfigService } from './services/config'
import { wcdbService } from './services/wcdbService'
import { chatService } from './services/chatService'
import { imageDecryptService } from './services/imageDecryptService'
import { imagePreloadService } from './services/imagePreloadService'
import { analyticsService } from './services/analyticsService'
import { groupAnalyticsService } from './services/groupAnalyticsService'
import { exportService } from './services/exportService'
import { voiceTranscribeService } from './services/voiceTranscribeService'
import { videoService } from './services/videoService'
import { snsService, isVideoUrl } from './services/snsService'
import { contactExportService } from './services/contactExportService'
import { macProfileService } from './services/macProfileService'
import { createElectronLogger } from './utils/debug'
import { httpService } from './services/httpService'
import { registerCoreIpcHandlers } from './ipc/core'
import { registerWindowAuxiliaryIpcHandlers, registerWindowControlIpcHandlers, registerWindowNavigationIpcHandlers } from './ipc/window'
import { registerVideoIpcHandlers } from './ipc/video'
import { registerAuthIpcHandlers } from './ipc/auth'
import { registerCacheIpcHandlers } from './ipc/cache'
import { registerHttpIpcHandlers } from './ipc/http'
import { registerChatBaseIpcHandlers } from './ipc/chat'
import { registerChatDetailIpcHandlers } from './ipc/chat-detail'
import { registerExportIpcHandlers } from './ipc/export'
import { registerAnalyticsIpcHandlers } from './ipc/analytics'
import { registerWhisperIpcHandlers } from './ipc/whisper'
import { registerGroupAnalyticsIpcHandlers } from './ipc/groupAnalytics'
import { registerImageIpcHandlers } from './ipc/image'
import { registerSnsBaseIpcHandlers } from './ipc/sns'
import { registerChatMaintenanceIpcHandlers } from './ipc/chat-maintenance'
import {
  configureDefaultSessionSecurity,
  registerMediaProtocol,
  registerMediaProtocolPrivileges
} from './security/runtimeSecurity'
import { createWindowManager } from './windows/windowManager'

const logger = createElectronLogger('main')

registerMediaProtocolPrivileges()

let configService: ConfigService | null = null
let isAppQuitting = false

const windowManager = createWindowManager({
  getIsAppQuitting: () => isAppQuitting
})

const ensureConfigService = (): ConfigService => {
  const cfg = configService || new ConfigService()
  configService = cfg
  return cfg
}

function registerIpcHandlers(): void {
  registerCoreIpcHandlers({ getConfigService: () => configService })

  registerWindowControlIpcHandlers()
  registerWindowNavigationIpcHandlers({
    createVideoPlayerWindow: windowManager.createVideoPlayerWindow,
    createChatHistoryWindow: windowManager.createChatHistoryWindow,
    createSessionChatWindow: windowManager.createSessionChatWindow
  })
  registerWindowAuxiliaryIpcHandlers({
    createAgreementWindow: windowManager.createAgreementWindow,
    createImageViewerWindow: windowManager.createImageViewerWindow,
    createOnboardingWindow: windowManager.createOnboardingWindow,
    showMainWindow: windowManager.showMainWindow,
    getConfigService: () => configService,
    getMainWindow: windowManager.getMainWindow,
    getOnboardingWindow: windowManager.getOnboardingWindow
  })

  registerVideoIpcHandlers({ videoService })
  registerAuthIpcHandlers({
    getConfigService: () => configService,
    getMainWindow: windowManager.getMainWindow,
    wcdbService
  })
  registerCacheIpcHandlers({
    analyticsService,
    imageDecryptService,
    chatService
  })
  registerHttpIpcHandlers({ httpService })
  registerChatBaseIpcHandlers({ chatService })
  registerChatDetailIpcHandlers({ chatService })
  registerExportIpcHandlers({
    exportService,
    contactExportService
  })
  registerAnalyticsIpcHandlers({ analyticsService })
  registerWhisperIpcHandlers({ voiceTranscribeService })
  registerGroupAnalyticsIpcHandlers({ groupAnalyticsService })
  registerImageIpcHandlers({
    imageDecryptService,
    imagePreloadService
  })
  registerSnsBaseIpcHandlers({
    snsService,
    isVideoUrl
  })
  registerChatMaintenanceIpcHandlers({
    getConfigService: () => configService,
    wcdbService,
    chatService,
    analyticsService,
    imageDecryptService
  })
}

app.whenReady().then(async () => {
  windowManager.createSplashWindow()

  const splashWindow = windowManager.getSplashWindow()
  if (splashWindow) {
    await new Promise<void>((resolve) => {
      if (splashWindow.webContents.isLoading()) {
        splashWindow.webContents.once('did-finish-load', () => resolve())
      } else {
        resolve()
      }
    })
    splashWindow.webContents
      .executeJavaScript(`setVersion(${JSON.stringify(app.getVersion())})`)
      .catch(() => {})
  }

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  windowManager.updateSplashProgress(5, '正在加载配置...')
  configService = new ConfigService()
  configureDefaultSessionSecurity()
  await registerMediaProtocol({
    getConfigService: () => configService,
    getProfileSummary: () => macProfileService.getSummary()
  })

  if (process.platform === 'darwin') {
    try {
      macProfileService.syncCompatibilityConfig(configService)
    } catch (error) {
      logger.warn('[Chat Capsule] macOS profile 同步失败:', error)
    }
  }

  const readySplashWindow = windowManager.getSplashWindow()
  if (readySplashWindow && !readySplashWindow.isDestroyed()) {
    const themeId = configService.get('themeId') || 'cloud-dancer'
    const themeMode = configService.get('theme') || 'system'
    readySplashWindow.webContents
      .executeJavaScript(`applyTheme(${JSON.stringify(themeId)}, ${JSON.stringify(themeMode)})`)
      .catch(() => {})
  }
  await delay(200)

  windowManager.updateSplashProgress(10, '正在初始化...')
  await delay(200)

  windowManager.updateSplashProgress(18, '正在初始化...')
  wcdbService.setLogEnabled(configService.get('logEnabled') === true)
  await delay(200)

  windowManager.updateSplashProgress(25, '正在初始化...')
  registerIpcHandlers()
  await delay(200)

  const onboardingDone = configService.get('onboardingDone') === true

  windowManager.updateSplashProgress(30, '正在加载界面...')
  windowManager.createMainWindow({ autoShow: false })

  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: ['*://*.qpic.cn/*', '*://*.wx.qq.com/*']
    },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://wx.qq.com/'
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  windowManager.updateSplashProgress(30, '正在加载界面...', true)
  await windowManager.waitForMainWindowReady()

  windowManager.updateSplashProgress(100, '启动完成')
  await delay(250)
  windowManager.closeSplash()

  if (!onboardingDone) {
    windowManager.createOnboardingWindow()
  } else {
    windowManager.showMainWindow()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createMainWindow()
    }
  })
})

app.on('before-quit', async () => {
  isAppQuitting = true
  try { await httpService.stop() } catch {}
  try { wcdbService.shutdown() } catch {}
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
