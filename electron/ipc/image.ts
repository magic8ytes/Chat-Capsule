import { ipcMain } from 'electron'

interface ImagePayload {
  sessionId?: string
  imageMd5?: string
  imageDatName?: string
}

interface ImageDecryptPayload extends ImagePayload {
  force?: boolean
}

interface ImageDecryptServiceLike {
  decryptImage: (payload: ImageDecryptPayload) => Promise<unknown>
  resolveCachedImage: (payload: ImagePayload) => Promise<unknown>
}

interface ImagePreloadServiceLike {
  enqueue: (payloads: ImagePayload[]) => void
}

interface ImageIpcContext {
  imageDecryptService: ImageDecryptServiceLike
  imagePreloadService: ImagePreloadServiceLike
}

export function registerImageIpcHandlers({ imageDecryptService, imagePreloadService }: ImageIpcContext): void {
  ipcMain.handle('image:decrypt', async (_, payload: ImageDecryptPayload) => {
    return imageDecryptService.decryptImage(payload)
  })

  ipcMain.handle('image:resolveCache', async (_, payload: ImagePayload) => {
    return imageDecryptService.resolveCachedImage(payload)
  })

  ipcMain.handle('image:preload', async (_, payloads: ImagePayload[]) => {
    imagePreloadService.enqueue(payloads || [])
    return true
  })
}
