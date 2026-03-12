export interface SessionMessageCacheEntry {
  updatedAt: number
  messages: unknown[]
}

export class MessageCacheService {
  private cache: Record<string, SessionMessageCacheEntry> = {}
  private readonly sessionLimit = 150

  constructor(_cacheBasePath?: string) {
  }

  get(sessionId: string): SessionMessageCacheEntry | undefined {
    return this.cache[sessionId]
  }

  set(sessionId: string, messages: unknown[]): void {
    if (!sessionId) return
    const trimmed = messages.length > this.sessionLimit
      ? messages.slice(-this.sessionLimit)
      : messages.slice()
    this.cache[sessionId] = {
      updatedAt: Date.now(),
      messages: trimmed
    }
  }

  clear(): void {
    this.cache = {}
  }
}
