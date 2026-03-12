import type { VideoInfo } from '../services/videoService'
import { ipcMain } from 'electron'

interface VideoServiceLike {
  getVideoInfo: (videoMd5: string) => Promise<VideoInfo>
  parseVideoMd5: (content: string) => string | undefined
}

interface VideoIpcContext {
  videoService: VideoServiceLike
}

export function registerVideoIpcHandlers({ videoService }: VideoIpcContext): void {
  ipcMain.handle('video:getVideoInfo', async (_, videoMd5: string) => {
    try {
      const result = await videoService.getVideoInfo(videoMd5)
      return { success: true, ...result }
    } catch (error) {
      return { success: false, error: String(error), exists: false }
    }
  })

  ipcMain.handle('video:parseVideoMd5', async (_, content: string) => {
    try {
      const md5 = videoService.parseVideoMd5(content)
      return { success: true, md5 }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
