import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import type { ConfigService } from '../services/config'
import type { OpenSessionChatWindowOptions } from '../windows/types'
import { createElectronLogger } from '../utils/debug'

const logger = createElectronLogger('ipc:window')

interface WindowNavigationIpcContext {
  createVideoPlayerWindow: (videoPath: string, videoWidth?: number, videoHeight?: number) => void
  createChatHistoryWindow: (sessionId: string, messageId: number) => void
  createSessionChatWindow: (sessionId: string, options?: OpenSessionChatWindowOptions) => BrowserWindow | null
}

interface WindowAuxiliaryIpcContext {
  createAgreementWindow: () => void
  createImageViewerWindow: (imagePath: string, liveVideoPath?: string) => void
  createOnboardingWindow: () => void
  showMainWindow: () => void
  getConfigService: () => ConfigService | null
  getMainWindow: () => BrowserWindow | null
  getOnboardingWindow: () => BrowserWindow | null
}

export function registerWindowControlIpcHandlers(): void {
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.on('window:setTitleBarOverlay', (event, options: { symbolColor: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && typeof (win as any).setTitleBarOverlay === 'function') {
      try {
        win.setTitleBarOverlay({
          color: '#00000000',
          symbolColor: options.symbolColor,
          height: 40
        })
      } catch (error) {
        logger.warn('TitleBarOverlay not enabled for this window:', error)
      }
    }
  })
}

export function registerWindowNavigationIpcHandlers({
  createVideoPlayerWindow,
  createChatHistoryWindow,
  createSessionChatWindow
}: WindowNavigationIpcContext): void {
  ipcMain.handle('window:openVideoPlayerWindow', (_, videoPath: string, videoWidth?: number, videoHeight?: number) => {
    createVideoPlayerWindow(videoPath, videoWidth, videoHeight)
  })

  ipcMain.handle('window:openChatHistoryWindow', (_, sessionId: string, messageId: number) => {
    createChatHistoryWindow(sessionId, messageId)
    return true
  })

  ipcMain.handle('window:openSessionChatWindow', (_, sessionId: string, options?: OpenSessionChatWindowOptions) => {
    const win = createSessionChatWindow(sessionId, options)
    return Boolean(win)
  })

  ipcMain.handle('window:resizeToFitVideo', (event, videoWidth: number, videoHeight: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !videoWidth || !videoHeight) return

    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

    const titleBarHeight = 40
    const aspectRatio = videoWidth / videoHeight

    const maxWidth = Math.floor(screenWidth * 0.85)
    const maxHeight = Math.floor(screenHeight * 0.85)

    let winWidth: number
    let winHeight: number

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

    win.setSize(winWidth, winHeight)
    win.center()
  })
}

export function registerWindowAuxiliaryIpcHandlers({
  createAgreementWindow,
  createImageViewerWindow,
  createOnboardingWindow,
  showMainWindow,
  getConfigService,
  getMainWindow,
  getOnboardingWindow
}: WindowAuxiliaryIpcContext): void {
  ipcMain.handle('window:openAgreementWindow', async () => {
    createAgreementWindow()
    return true
  })

  ipcMain.handle('window:openImageViewerWindow', async (_, imagePath: string, liveVideoPath?: string) => {
    if (imagePath.startsWith('data:')) {
      const commaIdx = imagePath.indexOf(',')
      const meta = imagePath.slice(5, commaIdx)
      const ext = meta.split('/')[1]?.split(';')[0] || 'jpg'
      const tmpPath = join(app.getPath('temp'), `weflow_preview_${Date.now()}.${ext}`)
      await writeFile(tmpPath, Buffer.from(imagePath.slice(commaIdx + 1), 'base64'))
      createImageViewerWindow(tmpPath, liveVideoPath)
      return true
    }

    createImageViewerWindow(imagePath, liveVideoPath)
    return true
  })

  ipcMain.handle('window:completeOnboarding', async () => {
    try {
      getConfigService()?.set('onboardingDone', true)
    } catch (error) {
      logger.error('保存引导完成状态失败:', error)
    }

    const onboardingWindow = getOnboardingWindow()
    if (onboardingWindow && !onboardingWindow.isDestroyed()) {
      onboardingWindow.close()
    }
    showMainWindow()
    return true
  })

  ipcMain.handle('window:openOnboardingWindow', async () => {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide()
    }
    createOnboardingWindow()
    return true
  })
}
