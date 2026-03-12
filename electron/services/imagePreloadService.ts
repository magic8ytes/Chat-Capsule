import { imageDecryptService } from './imageDecryptService'

type PreloadImagePayload = {
  sessionId?: string
  imageMd5?: string
  imageDatName?: string
}

type PreloadTask = PreloadImagePayload & {
  key: string
}

export class ImagePreloadService {
  private queue: PreloadTask[] = []
  private pending = new Set<string>()
  private active = 0
  private readonly maxConcurrent = 2

  enqueue(payloads: PreloadImagePayload[]): void {
    if (!Array.isArray(payloads) || payloads.length === 0) return
    for (const payload of payloads) {
      const cacheKey = payload.imageMd5 || payload.imageDatName
      if (!cacheKey) continue
      const key = `${payload.sessionId || 'unknown'}|${cacheKey}`
      if (this.pending.has(key)) continue
      this.pending.add(key)
      this.queue.push({ ...payload, key })
    }
    this.processQueue()
  }

  private processQueue(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift()
      if (!task) return
      this.active += 1
      void this.handleTask(task).finally(() => {
        this.active -= 1
        this.pending.delete(task.key)
        this.processQueue()
      })
    }
  }

  private async handleTask(task: PreloadTask): Promise<void> {
    const cacheKey = task.imageMd5 || task.imageDatName
    if (!cacheKey) return
    try {
      const cached = await imageDecryptService.resolveCachedImage({
        sessionId: task.sessionId,
        imageMd5: task.imageMd5,
        imageDatName: task.imageDatName
      })
      if (cached.success) return
      await imageDecryptService.decryptImage({
        sessionId: task.sessionId,
        imageMd5: task.imageMd5,
        imageDatName: task.imageDatName
      })
    } catch {
      // ignore preload failures
    }
  }
}

export const imagePreloadService = new ImagePreloadService()
