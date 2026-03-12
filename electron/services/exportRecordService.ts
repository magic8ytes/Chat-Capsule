import { app } from 'electron'
import { access, mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

export interface ExportRecord {
  exportTime: number
  format: string
  messageCount: number
  sourceLatestMessageTimestamp?: number
  outputPath?: string
}

type RecordStore = Record<string, ExportRecord[]>

class ExportRecordService {
  private filePath: string | null = null
  private loaded = false
  private store: RecordStore = {}

  private persistQueue: Promise<void> = Promise.resolve()

  private async resolveFilePath(): Promise<string> {
    if (this.filePath) return this.filePath
    const userDataPath = app.getPath('userData')
    await mkdir(userDataPath, { recursive: true })
    this.filePath = path.join(userDataPath, 'weflow-export-records.json')
    return this.filePath
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const filePath = await this.resolveFilePath()
    try {
      await access(filePath)
      const raw = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        this.store = parsed as RecordStore
      }
    } catch {
      this.store = {}
    }
  }

  private persist(): void {
    this.persistQueue = this.persistQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          const filePath = await this.resolveFilePath()
          await writeFile(filePath, JSON.stringify(this.store), 'utf-8')
        } catch {
          // ignore persist errors to avoid blocking export flow
        }
      })
  }

  async getLatestRecord(sessionId: string, format: string): Promise<ExportRecord | null> {
    await this.ensureLoaded()
    const records = this.store[sessionId]
    if (!records || records.length === 0) return null
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i]
      if (record && record.format === format) return record
    }
    return null
  }

  async saveRecord(
    sessionId: string,
    format: string,
    messageCount: number,
    extra?: {
      sourceLatestMessageTimestamp?: number
      outputPath?: string
    }
  ): Promise<void> {
    await this.ensureLoaded()
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return
    if (!this.store[normalizedSessionId]) {
      this.store[normalizedSessionId] = []
    }
    const list = this.store[normalizedSessionId]
    list.push({
      exportTime: Date.now(),
      format,
      messageCount,
      sourceLatestMessageTimestamp: extra?.sourceLatestMessageTimestamp,
      outputPath: extra?.outputPath
    })
    // keep the latest 30 records per session
    if (list.length > 30) {
      this.store[normalizedSessionId] = list.slice(-30)
    }
    this.persist()
  }
}

export const exportRecordService = new ExportRecordService()
