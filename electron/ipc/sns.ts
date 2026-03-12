import { ipcMain } from 'electron'
import { normalizeSnsProxyPayload } from '../../shared/contracts/sns.ts'

interface DownloadEmojiParams {
  url: string
  encryptUrl?: string
  aesKey?: string
}

interface SnsExportOptions {
  outputDir: string
  format: 'json' | 'html' | 'arkmejson'
  usernames?: string[]
  keyword?: string
  exportMedia?: boolean
  exportImages?: boolean
  exportLivePhotos?: boolean
  exportVideos?: boolean
  startTime?: number
  endTime?: number
  taskId?: string
}

interface SnsServiceLike {
  getTimeline: (limit: number, offset: number, usernames?: string[], keyword?: string, startTime?: number, endTime?: number) => Promise<unknown>
  getSnsUsernames: () => Promise<unknown>
  getUserPostCounts: () => Promise<unknown>
  getExportStats: () => Promise<unknown>
  getExportStatsFast: () => Promise<unknown>
  getUserPostStats: (username: string) => Promise<unknown>
  proxyImage: (url: string, key?: string | number) => Promise<unknown>
  downloadImage: (url: string, key?: string | number) => Promise<{ success: boolean; data?: Buffer; contentType?: string; error?: string }>
  exportTimeline: (options: SnsExportOptions, onProgress: (progress: unknown) => void) => Promise<unknown>
  downloadSnsEmoji: (url: string, encryptUrl?: string, aesKey?: string) => Promise<unknown>
}

interface SnsIpcContext {
  snsService: SnsServiceLike
  isVideoUrl: (url: string) => boolean
}

export function registerSnsBaseIpcHandlers({ snsService, isVideoUrl }: SnsIpcContext): void {
  ipcMain.handle('sns:getTimeline', async (_, limit: number, offset: number, usernames?: string[], keyword?: string, startTime?: number, endTime?: number) => {
    return snsService.getTimeline(limit, offset, usernames, keyword, startTime, endTime)
  })

  ipcMain.handle('sns:getSnsUsernames', async () => {
    return snsService.getSnsUsernames()
  })

  ipcMain.handle('sns:getUserPostCounts', async () => {
    return snsService.getUserPostCounts()
  })

  ipcMain.handle('sns:getExportStats', async () => {
    return snsService.getExportStats()
  })

  ipcMain.handle('sns:getExportStatsFast', async () => {
    return snsService.getExportStatsFast()
  })

  ipcMain.handle('sns:getUserPostStats', async (_, username: string) => {
    return snsService.getUserPostStats(username)
  })

  ipcMain.handle('sns:proxyImage', async (_, payload: unknown) => {
    const normalized = normalizeSnsProxyPayload(typeof payload === 'string' ? { url: payload } : payload)
    if (!normalized) {
      throw new Error('SNS 媒体请求不合法')
    }
    return snsService.proxyImage(normalized.url, normalized.key)
  })

  ipcMain.handle('sns:downloadEmoji', async (_, params: DownloadEmojiParams) => {
    return snsService.downloadSnsEmoji(params.url, params.encryptUrl, params.aesKey)
  })

  ipcMain.handle('sns:downloadImage', async (_, payload: unknown) => {
    try {
      const normalized = normalizeSnsProxyPayload(payload)
      if (!normalized) {
        return { success: false, error: 'SNS 媒体请求不合法' }
      }

      const { url, key } = normalized
      const result = await snsService.downloadImage(url, key)

      if (!result.success || !result.data) {
        return { success: false, error: result.error || '下载图片失败' }
      }

      const { dialog } = await import('electron')
      const ext = (result.contentType || '').split('/')[1] || 'jpg'
      const defaultPath = `SNS_${Date.now()}.${ext}`

      const filters = isVideoUrl(url)
        ? [{ name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv'] }]
        : [{ name: 'Images', extensions: [ext, 'jpg', 'jpeg', 'png', 'webp', 'gif'] }]

      const { filePath, canceled } = await dialog.showSaveDialog({
        defaultPath,
        filters
      })

      if (canceled || !filePath) {
        return { success: false, error: '用户已取消' }
      }

      const fs = await import('fs/promises')
      await fs.writeFile(filePath, result.data)

      return { success: true, filePath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('sns:exportTimeline', async (event, options: SnsExportOptions) => {
    const exportOptions = { ...(options || {}) }
    delete exportOptions.taskId

    return snsService.exportTimeline(
      exportOptions,
      (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('sns:exportProgress', progress)
        }
      }
    )
  })

  ipcMain.handle('sns:selectExportDir', async () => {
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '选择导出目录'
    })
    if (result.canceled || !result.filePaths?.[0]) {
      return { canceled: true }
    }
    return { canceled: false, filePath: result.filePaths[0] }
  })
}
