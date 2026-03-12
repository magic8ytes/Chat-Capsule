import { join, dirname } from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { z } from 'zod'
import { ConfigService } from './config'
import { createElectronLogger } from '../utils/debug'

export interface ContactCacheEntry {
  displayName?: string
  avatarUrl?: string
  updatedAt: number
}

const logger = createElectronLogger('ContactCacheService')

const contactCacheEntrySchema = z.object({
  displayName: z.string().optional(),
  avatarUrl: z.string().optional(),
  updatedAt: z.number().finite().nonnegative()
}).strict()

const contactCacheStoreSchema = z.record(z.string(), contactCacheEntrySchema)

function normalizeContactCacheStore(payload: unknown): Record<string, ContactCacheEntry> {
  const result = contactCacheStoreSchema.safeParse(payload)
  if (!result.success) {
    return {}
  }

  const normalized: Record<string, ContactCacheEntry> = {}
  for (const [username, entry] of Object.entries(result.data)) {
    normalized[username] = {
      ...entry,
      avatarUrl: entry.avatarUrl?.includes('base64,ffd8') ? undefined : entry.avatarUrl
    }
  }
  return normalized
}

export class ContactCacheService {
  private readonly cacheFilePath: string
  private cache: Record<string, ContactCacheEntry> = {}
  private persistQueue: Promise<void> = Promise.resolve()

  constructor(cacheBasePath?: string) {
    const basePath = cacheBasePath && cacheBasePath.trim().length > 0
      ? cacheBasePath
      : ConfigService.getInstance().getCacheBasePath()
    this.cacheFilePath = join(basePath, 'contacts.json')
    this.ensureCacheDir()
    this.loadCache()
  }

  private ensureCacheDir() {
    const dir = dirname(this.cacheFilePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  private loadCache() {
    if (!existsSync(this.cacheFilePath)) return
    try {
      const raw = readFileSync(this.cacheFilePath, 'utf8')
      this.cache = normalizeContactCacheStore(JSON.parse(raw))
    } catch (error) {
      logger.error('载入缓存失败', error)
      this.cache = {}
    }
  }

  get(username: string): ContactCacheEntry | undefined {
    return this.cache[username]
  }

  getAllEntries(): Record<string, ContactCacheEntry> {
    return { ...this.cache }
  }

  setEntries(entries: Record<string, ContactCacheEntry>): void {
    if (Object.keys(entries).length === 0) return
    let changed = false
    for (const [username, entry] of Object.entries(entries)) {
      const existing = this.cache[username]
      if (!existing || entry.updatedAt >= existing.updatedAt) {
        this.cache[username] = entry
        changed = true
      }
    }
    if (changed) {
      this.persist()
    }
  }

  private enqueueFileTask(task: () => Promise<void>): void {
    this.persistQueue = this.persistQueue.catch(() => undefined).then(task)
  }

  private persist() {
    const snapshot = JSON.stringify(this.cache)
    const targetPath = this.cacheFilePath
    this.enqueueFileTask(async () => {
      try {
        await mkdir(dirname(targetPath), { recursive: true })
        await writeFile(targetPath, snapshot, 'utf8')
      } catch (error) {
        logger.error('保存缓存失败', error)
      }
    })
  }

  clear(): void {
    this.cache = {}
    const targetPath = this.cacheFilePath
    this.enqueueFileTask(async () => {
      try {
        await rm(targetPath, { force: true })
      } catch (error) {
        logger.error('清理缓存失败', error)
      }
    })
  }
}
