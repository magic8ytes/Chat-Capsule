import { ipcMain } from 'electron'

interface CacheOperationResult {
  success: boolean
  error?: string
}

interface AnalyticsServiceLike {
  clearCache: () => Promise<CacheOperationResult>
}

interface ImageDecryptServiceLike {
  clearCache: () => Promise<CacheOperationResult>
}

interface ChatServiceLike {
  clearCaches: (options?: {
    includeMessages?: boolean
    includeContacts?: boolean
    includeEmojis?: boolean
  }) => CacheOperationResult
}

interface CacheIpcContext {
  analyticsService: AnalyticsServiceLike
  imageDecryptService: ImageDecryptServiceLike
  chatService: ChatServiceLike
}

const mergeResults = (results: CacheOperationResult[]): CacheOperationResult => {
  const errors = results
    .filter((result) => !result.success)
    .map((result) => result.error)
    .filter(Boolean) as string[]

  if (errors.length > 0) {
    return { success: false, error: errors.join('; ') }
  }

  return { success: true }
}

export function registerCacheIpcHandlers({ analyticsService, imageDecryptService, chatService }: CacheIpcContext): void {
  ipcMain.handle('cache:clearAnalytics', async () => {
    return analyticsService.clearCache()
  })

  ipcMain.handle('cache:clearImages', async () => {
    const imageResult = await imageDecryptService.clearCache()
    const emojiResult = chatService.clearCaches({ includeMessages: false, includeContacts: false, includeEmojis: true })
    return mergeResults([imageResult, emojiResult])
  })

  ipcMain.handle('cache:clearAll', async () => {
    const [analyticsResult, imageResult] = await Promise.all([
      analyticsService.clearCache(),
      imageDecryptService.clearCache()
    ])
    const chatResult = chatService.clearCaches()
    return mergeResults([analyticsResult, imageResult, chatResult])
  })
}
