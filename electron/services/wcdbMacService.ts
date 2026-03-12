import crypto from 'crypto'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { existsSync, statSync } from 'fs'
import * as fzstd from 'fzstd'
import { basename, join, relative } from 'path'
import { macProfileService, type ResolvedMacProfile } from './macProfileService'
import { sqlcipherMacService } from './sqlcipherMacService'
import { extractXmlTagValue } from '../utils/xml'
import { assertReadonlySql } from '../../shared/contracts/sql'

type AnyRow = Record<string, any>

type CursorMode = 'full' | 'lite'

type CursorSource = {
  dbPath: string
  tableName: string
  offset: number
  buffer: AnyRow[]
  exhausted: boolean
  selectClause: string
  orderColumn: string
  tieBreakerColumn: string
}

type CursorState = {
  batchSize: number
  ascending: boolean
  beginTimestamp: number
  endTimestamp: number
  mode: CursorMode
  sources: CursorSource[]
}

type SnsTimelinePost = {
  id: string
  tid?: string
  username: string
  nickname: string
  createTime: number
  contentDesc: string
  type?: number
  media: Array<Record<string, any>>
  likes: string[]
  comments: Array<Record<string, any>>
  rawXml?: string
  linkTitle?: string
  linkUrl?: string
}

function cleanWxid(value: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (trimmed.toLowerCase().startsWith('wxid_')) {
    const match = trimmed.match(/^(wxid_[^_]+)/i)
    return match?.[1] || trimmed
  }
  const suffixMatch = trimmed.match(/^(.+)_([a-zA-Z0-9]{4})$/)
  return suffixMatch ? suffixMatch[1] : trimmed
}

function quoteIdentifier(name: string): string {
  return `"${String(name || '').replace(/"/g, '""')}"`
}

function parseExtraBuffer(raw: Buffer | string | null | undefined): { isMuted: boolean } {
  if (!raw) return { isMuted: false }
  const buf = Buffer.isBuffer(raw)
    ? raw
    : /^[0-9a-f]+$/i.test(String(raw))
      ? Buffer.from(String(raw), 'hex')
      : Buffer.from(String(raw), 'utf8')

  let offset = 0
  let isMuted = false
  while (offset < buf.length) {
    let key = 0
    let shift = 0
    while (offset < buf.length) {
      const byte = buf[offset++]
      key |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) break
      shift += 7
    }
    const fieldNum = key >>> 3
    const wireType = key & 0x07
    if (wireType === 0) {
      let value = 0
      let valueShift = 0
      while (offset < buf.length) {
        const byte = buf[offset++]
        value |= (byte & 0x7f) << valueShift
        if ((byte & 0x80) === 0) break
        valueShift += 7
      }
      if (fieldNum === 12 && value !== 0) isMuted = true
    } else if (wireType === 2) {
      let len = 0
      let lenShift = 0
      while (offset < buf.length) {
        const byte = buf[offset++]
        len |= (byte & 0x7f) << lenShift
        if ((byte & 0x80) === 0) break
        lenShift += 7
      }
      offset += len
    } else if (wireType === 5) {
      offset += 4
    } else if (wireType === 1) {
      offset += 8
    } else {
      break
    }
  }
  return { isMuted }
}

function bufferToDataUrl(raw: Buffer): string | undefined {
  if (!raw || raw.length === 0) return undefined
  const header = raw.subarray(0, 12)
  let mime = 'image/jpeg'
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    mime = 'image/png'
  } else if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') {
    mime = 'image/webp'
  } else if (header.subarray(0, 3).toString('ascii') === 'GIF') {
    mime = 'image/gif'
  }
  return `data:${mime};base64,${raw.toString('base64')}`
}

export class WcdbMacService {
  private connected = false
  private cursorId = 1
  private cursors = new Map<number, CursorState>()
  private monitorListener: ((type: string, json: string) => void) | null = null
  private messageDbListCache: { paths: string[]; updatedAt: number } | null = null
  private mediaDbListCache: { paths: string[]; updatedAt: number } | null = null
  private snsTimelineCache: { signature: string; posts: SnsTimelinePost[] } | null = null
  private tablePresenceCache = new Map<string, boolean>()
  private messageTableColumnCache = new Map<string, Set<string>>()
  private readonly cacheTtlMs = 60 * 1000

  isAvailable(): boolean {
    return macProfileService.hasUsableProfile()
  }

  isReady(): boolean {
    return this.isAvailable() && this.connected
  }


  setLogEnabled(_enabled: boolean): void {}

  setMonitor(callback: (type: string, json: string) => void): void {
    this.monitorListener = callback
  }

  async call(type: string, payload: any = {}): Promise<any> {
    switch (type) {
      case 'testConnection':
        return this.testConnection(payload.dbPath, payload.hexKey, payload.wxid)
      case 'open':
        return this.open(payload.dbPath, payload.hexKey, payload.wxid)
      case 'close':
        return this.close()
      case 'isConnected':
        return this.isConnected()
      case 'getSessions':
        return this.getSessions()
      case 'getMessages':
        return this.getMessages(payload.sessionId, payload.limit, payload.offset)
      case 'getNewMessages':
        return this.getNewMessages(payload.sessionId, payload.minTime, payload.limit)
      case 'getMessageCount':
        return this.getMessageCount(payload.sessionId)
      case 'getMessageCounts':
        return this.getMessageCounts(payload.sessionIds)
      case 'getDisplayNames':
        return this.getDisplayNames(payload.usernames)
      case 'getAvatarUrls':
        return this.getAvatarUrls(payload.usernames)
      case 'getGroupMemberCount':
        return this.getGroupMemberCount(payload.chatroomId)
      case 'getGroupMemberCounts':
        return this.getGroupMemberCounts(payload.chatroomIds)
      case 'getGroupMembers':
        return this.getGroupMembers(payload.chatroomId)
      case 'getGroupNicknames':
        return this.getGroupNicknames(payload.chatroomId)
      case 'getMessageTableStats':
        return this.getMessageTableStats(payload.sessionId)
      case 'getMessageDates':
        return this.getMessageDates(payload.sessionId)
      case 'getContact':
        return this.getContact(payload.username)
      case 'getContactStatus':
        return this.getContactStatus(payload.usernames)
      case 'getAggregateStats':
        return this.getAggregateStats(payload.sessionIds, payload.beginTimestamp, payload.endTimestamp)
      case 'getAvailableYears':
        return this.getAvailableYears(payload.sessionIds)
      case 'getGroupStats':
        return this.getGroupStats(payload.chatroomId, payload.beginTimestamp, payload.endTimestamp)
      case 'getSnsTimeline':
        return this.getSnsTimeline(payload.limit, payload.offset, payload.usernames, payload.keyword, payload.startTime, payload.endTime)
      case 'openMessageCursor':
        return this.openMessageCursor(payload.sessionId, payload.batchSize, payload.ascending, payload.beginTimestamp, payload.endTimestamp)
      case 'openMessageCursorLite':
        return this.openMessageCursorLite(payload.sessionId, payload.batchSize, payload.ascending, payload.beginTimestamp, payload.endTimestamp)
      case 'fetchMessageBatch':
        return this.fetchMessageBatch(payload.cursor)
      case 'closeMessageCursor':
        return this.closeMessageCursor(payload.cursor)
      case 'execQuery':
        return this.execQuery(payload.kind, payload.path, payload.sql, payload.params)
      case 'getEmoticonCdnUrl':
        return this.getEmoticonCdnUrl(payload.dbPath, payload.md5)
      case 'listMessageDbs':
        return this.listMessageDbs()
      case 'listMediaDbs':
        return this.listMediaDbs()
      case 'getMessageById':
        return this.getMessageById(payload.sessionId, payload.localId)
      case 'getLogs':
        return this.getLogs()
      case 'verifyUser':
        return this.verifyUser(payload.message, payload.hwnd)
      default:
        return { success: false, error: `macOS SQLite 后端暂未实现 ${type}` }
    }
  }

  async testConnection(_dbPath: string, _hexKey: string, _wxid: string): Promise<{ success: boolean; error?: string; sessionCount?: number }> {
    try {
      const db = this.openDbByRelative('session/session.db')
      try {
        const row = db.prepare('SELECT COUNT(*) AS count FROM SessionTable').get() as { count?: number } | undefined
        return { success: true, sessionCount: Number(row?.count || 0) }
      } finally {
        db.close()
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async open(_dbPath: string, _hexKey: string, _wxid: string): Promise<boolean> {
    const test = await this.testConnection('', '', '')
    if (!test.success) return false
    this.getLocalDbPath('contact/contact.db')
    this.getLocalDbPath('session/session.db')
    try { this.getLocalDbPath('hardlink/hardlink.db') } catch {}
    try { this.getLocalDbPath('head_image/head_image.db') } catch {}
    try { this.getLocalDbPath('emoticon/emoticon.db') } catch {}
    this.connected = true
    return true
  }

  async probeProfileDatabases(relativePaths: string[] = ['session/session.db', 'contact/contact.db', 'message/message_0.db', 'hardlink/hardlink.db']): Promise<{
    success: boolean
    sourceMode?: 'encrypted-sqlcipher' | 'decrypted-sqlite'
    probes: Array<{
      relativePath: string
      sourcePath: string
      encryptedSourcePath?: string
      decryptedSourcePath?: string
      localPath?: string
      success: boolean
      tableCount?: number
      error?: string
    }>
    probedAt: number
    error?: string
  }> {
    try {
      const profile = this.getProfile()
      const sourceMode = sqlcipherMacService.getSourceMode(profile)
      const probes = relativePaths.map((relativePath) => {
        const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
        const encryptedSourcePath = join(profile.dbStoragePath, normalized)
        const decryptedSourcePath = join(profile.decryptedRoot, normalized)
        const sourcePath = sourceMode === 'encrypted-sqlcipher' ? encryptedSourcePath : decryptedSourcePath

        try {
          const localPath = this.getLocalDbPath(normalized)
          const db = this.openDb(localPath)
          try {
            const row = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get() as { count?: number } | undefined
            return {
              relativePath: normalized,
              sourcePath,
              encryptedSourcePath,
              decryptedSourcePath,
              localPath,
              success: true,
              tableCount: Number(row?.count || 0)
            }
          } finally {
            db.close()
          }
        } catch (error) {
          return {
            relativePath: normalized,
            sourcePath,
            encryptedSourcePath,
            decryptedSourcePath,
            success: false,
            error: String(error)
          }
        }
      })

      return {
        success: probes.every((item) => item.success),
        sourceMode,
        probes,
        probedAt: Date.now()
      }
    } catch (error) {
      return {
        success: false,
        probes: [],
        probedAt: Date.now(),
        error: String(error)
      }
    }
  }

  async close(): Promise<void> {
    this.connected = false
    this.cursors.clear()
  }

  async isConnected(): Promise<boolean> {
    return this.connected
  }

  async getSessions(): Promise<{ success: boolean; sessions?: any[]; error?: string }> {
    try {
      this.ensureConnected()
      const db = this.openDbByRelative('session/session.db')
      try {
        const rows = db.prepare(`
          SELECT
            username,
            type,
            unread_count,
            summary,
            last_timestamp,
            sort_timestamp,
            last_msg_type,
            last_msg_sender,
            last_sender_display_name
          FROM SessionTable
          ORDER BY sort_timestamp DESC, last_timestamp DESC
        `).all()
        return { success: true, sessions: rows }
      } finally {
        db.close()
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getMessages(sessionId: string, limit: number, offset: number): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    const cursor = await this.openMessageCursor(sessionId, Math.max(1, limit || 50), false, 0, 0)
    if (!cursor.success || !cursor.cursor) {
      return { success: false, error: cursor.error || '打开消息游标失败' }
    }

    try {
      let skipped = 0
      while (skipped < Math.max(0, offset || 0)) {
        const batch = await this.fetchMessageBatch(cursor.cursor)
        if (!batch.success || !batch.rows) return { success: false, error: batch.error || '跳过消息失败' }
        skipped += batch.rows.length
        if (!batch.hasMore) break
      }
      const batch = await this.fetchMessageBatch(cursor.cursor)
      return { success: batch.success, messages: batch.rows, error: batch.error }
    } finally {
      await this.closeMessageCursor(cursor.cursor)
    }
  }

  async getNewMessages(sessionId: string, minTime: number, limit: number = 1000): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    try {
      this.ensureConnected()
      const tableName = this.getMessageTableName(sessionId)
      const dbPaths = await this.getSessionDbPaths(sessionId)
      const rows: AnyRow[] = []
      for (const dbPath of dbPaths) {
        const db = this.openDb(dbPath)
        try {
          const sql = `
            SELECT
              m.*,
              sender_map.user_name AS sender_username,
              CASE
                WHEN lower(COALESCE(sender_map.user_name, '')) IN (?, ?) THEN 1
                ELSE NULL
              END AS computed_is_send
            FROM ${quoteIdentifier(tableName)} m
            LEFT JOIN Name2Id sender_map ON sender_map.rowid = m.real_sender_id
            WHERE m.create_time > ?
            ORDER BY m.sort_seq ASC
            LIMIT ?
          `
          const dbRows = db.prepare(sql).all(this.getProfile().wxid.toLowerCase(), this.getProfile().wxidClean.toLowerCase(), minTime, limit) as AnyRow[]
          rows.push(...dbRows)
        } finally {
          db.close()
        }
      }
      rows.sort((a, b) => this.readSortKey(a) - this.readSortKey(b))
      return { success: true, messages: rows.slice(0, limit) }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getMessageCount(sessionId: string): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
      this.ensureConnected()
      const stats = await this.getMessageTableStats(sessionId)
      if (!stats.success || !stats.tables) return { success: false, error: stats.error || '统计消息失败' }
      const count = stats.tables.reduce((sum, item) => sum + Number(item.count || 0), 0)
      return { success: true, count }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getMessageCounts(sessionIds: string[]): Promise<{ success: boolean; counts?: Record<string, number>; error?: string }> {
    try {
      const counts: Record<string, number> = {}
      for (const sessionId of sessionIds || []) {
        const result = await this.getMessageCount(sessionId)
        counts[sessionId] = result.success ? Number(result.count || 0) : 0
      }
      return { success: true, counts }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getDisplayNames(usernames: string[]): Promise<{ success: boolean; map?: Record<string, string>; error?: string }> {
    try {
      this.ensureConnected()
      const rows = this.queryContacts(usernames, 'username, remark, nick_name, alias')
      const map: Record<string, string> = {}
      for (const row of rows) {
        const username = String(row.username || '').trim()
        if (!username) continue
        map[username] = String(row.remark || row.nick_name || row.alias || username)
      }
      return { success: true, map }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getAvatarUrls(usernames: string[]): Promise<{ success: boolean; map?: Record<string, string>; error?: string }> {
    try {
      this.ensureConnected()
      const rows = this.queryContacts(usernames, 'username, big_head_url, small_head_url')
      const map: Record<string, string> = {}
      const missing = new Set<string>()
      for (const row of rows) {
        const username = String(row.username || '').trim()
        if (!username) continue
        const url = String(row.big_head_url || row.small_head_url || '').trim()
        if (url) map[username] = url
        else missing.add(username)
      }

      if (missing.size > 0) {
        const db = this.openDbByRelative('head_image/head_image.db')
        try {
          const placeholders = Array.from(missing).map(() => '?').join(',')
          const headRows = db.prepare(`SELECT username, image_buffer FROM head_image WHERE username IN (${placeholders})`).all(...Array.from(missing)) as AnyRow[]
          for (const row of headRows) {
            const username = String(row.username || '').trim()
            const buffer = Buffer.isBuffer(row.image_buffer) ? row.image_buffer : null
            const dataUrl = buffer ? bufferToDataUrl(buffer) : undefined
            if (username && dataUrl) map[username] = dataUrl
          }
        } finally {
          db.close()
        }
      }

      return { success: true, map }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getGroupMemberCount(chatroomId: string): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
      const result = await this.getGroupMembers(chatroomId)
      return { success: result.success, count: result.members?.length || 0, error: result.error }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getGroupMemberCounts(chatroomIds: string[]): Promise<{ success: boolean; map?: Record<string, number>; error?: string }> {
    try {
      const map: Record<string, number> = {}
      for (const chatroomId of chatroomIds || []) {
        const result = await this.getGroupMemberCount(chatroomId)
        map[chatroomId] = result.success ? Number(result.count || 0) : 0
      }
      return { success: true, map }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getGroupMembers(chatroomId: string): Promise<{ success: boolean; members?: any[]; error?: string }> {
    try {
      this.ensureConnected()
      const db = this.openDbByRelative('contact/contact.db')
      try {
        const rows = db.prepare(`
          SELECT
            c.username,
            c.alias,
            c.remark,
            c.nick_name,
            c.big_head_url,
            c.small_head_url,
            r.owner
          FROM chat_room r
          JOIN chatroom_member m ON m.room_id = r.id
          JOIN contact c ON c.id = m.member_id
          WHERE r.username = ?
          ORDER BY CASE WHEN COALESCE(c.remark, '') <> '' THEN 0 ELSE 1 END, COALESCE(c.nick_name, c.alias, c.username)
        `).all(chatroomId)
        return { success: true, members: rows }
      } finally {
        db.close()
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getGroupNicknames(chatroomId: string): Promise<{ success: boolean; nicknames?: Record<string, string>; error?: string }> {
    try {
      const result = await this.getGroupMembers(chatroomId)
      if (!result.success || !result.members) return { success: false, error: result.error || '获取群成员失败' }
      const nicknames: Record<string, string> = {}
      for (const row of result.members) {
        const username = String(row.username || '').trim()
        if (!username) continue
        nicknames[username] = String(row.remark || row.nick_name || row.alias || username)
      }
      return { success: true, nicknames }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getMessageTableStats(sessionId: string): Promise<{ success: boolean; tables?: any[]; error?: string }> {
    try {
      this.ensureConnected()
      const tableName = this.getMessageTableName(sessionId)
      const dbPaths = await this.getSessionDbPaths(sessionId)
      const tables: AnyRow[] = []
      for (const dbPath of dbPaths) {
        const db = this.openDb(dbPath)
        try {
          const row = db.prepare(`
            SELECT
              COUNT(*) AS count,
              MIN(create_time) AS first_timestamp,
              MAX(create_time) AS last_timestamp
            FROM ${quoteIdentifier(tableName)}
          `).get() as AnyRow | undefined
          tables.push({
            db_path: dbPath,
            table_name: tableName,
            count: Number(row?.count || 0),
            first_timestamp: Number(row?.first_timestamp || 0),
            last_timestamp: Number(row?.last_timestamp || 0)
          })
        } finally {
          db.close()
        }
      }
      return { success: true, tables }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getMessageDates(sessionId: string): Promise<{ success: boolean; dates?: string[]; error?: string }> {
    try {
      this.ensureConnected()
      const tableName = this.getMessageTableName(sessionId)
      const dbPaths = await this.getSessionDbPaths(sessionId)
      const dates = new Set<string>()
      for (const dbPath of dbPaths) {
        const db = this.openDb(dbPath)
        try {
          const rows = db.prepare(`
            SELECT DISTINCT strftime('%Y-%m-%d', create_time, 'unixepoch', 'localtime') AS msg_date
            FROM ${quoteIdentifier(tableName)}
            ORDER BY msg_date ASC
          `).all() as AnyRow[]
          for (const row of rows) {
            const value = String(row.msg_date || '').trim()
            if (value) dates.add(value)
          }
        } finally {
          db.close()
        }
      }
      return { success: true, dates: Array.from(dates).sort() }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getContact(username: string): Promise<{ success: boolean; contact?: any; error?: string }> {
    try {
      this.ensureConnected()
      const db = this.openDbByRelative('contact/contact.db')
      try {
        const row = db.prepare('SELECT * FROM contact NOT INDEXED WHERE username = ? LIMIT 1').get(username)
        return row ? { success: true, contact: row } : { success: false, error: '未找到联系人' }
      } finally {
        db.close()
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getContactStatus(usernames: string[]): Promise<{ success: boolean; map?: Record<string, { isFolded: boolean; isMuted: boolean }>; error?: string }> {
    try {
      this.ensureConnected()
      const rows = this.queryContacts(usernames, 'username, flag, extra_buffer')
      const map: Record<string, { isFolded: boolean; isMuted: boolean }> = {}
      for (const row of rows) {
        const username = String(row.username || '').trim()
        if (!username) continue
        const flag = Number(row.flag || 0)
        const isFolded = (flag & 0x10000000) !== 0
        const { isMuted } = parseExtraBuffer(row.extra_buffer)
        map[username] = { isFolded, isMuted }
      }
      return { success: true, map }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getAggregateStats(sessionIds: string[], beginTimestamp: number = 0, endTimestamp: number = 0): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.ensureConnected()
      const aggregate = this.createAggregateSkeleton()
      for (const sessionId of this.normalizeSessionIds(sessionIds)) {
        await this.accumulateSessionAggregate(aggregate, sessionId, beginTimestamp, endTimestamp, false)
      }
      return { success: true, data: aggregate }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getAvailableYears(sessionIds: string[]): Promise<{ success: boolean; data?: number[]; error?: string }> {
    try {
      this.ensureConnected()
      const years = new Set<number>()
      const currentYear = new Date().getFullYear()
      for (const sessionId of this.normalizeSessionIds(sessionIds)) {
        const result = await this.getMessageDates(sessionId)
        if (!result.success || !result.dates) continue
        for (const value of result.dates) {
          const year = Number(String(value).slice(0, 4))
          if (Number.isInteger(year) && year >= 2010 && year <= currentYear) {
            years.add(year)
          }
        }
      }
      return { success: true, data: Array.from(years).sort((a, b) => b - a) }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getGroupStats(chatroomId: string, beginTimestamp: number = 0, endTimestamp: number = 0): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.ensureConnected()
      const aggregate = this.createAggregateSkeleton()
      await this.accumulateSessionAggregate(aggregate, String(chatroomId || '').trim(), beginTimestamp, endTimestamp, true)
      return { success: true, data: aggregate }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getSnsTimeline(
    limit: number,
    offset: number,
    usernames?: string[],
    keyword?: string,
    startTime?: number,
    endTime?: number
  ): Promise<{ success: boolean; timeline?: any[]; error?: string }> {
    try {
      this.ensureConnected()
      const posts = this.getSnsTimelinePosts()
      const usernameSet = new Set((usernames || []).map((item) => String(item || '').trim()).filter(Boolean))
      const keywordLower = String(keyword || '').trim().toLowerCase()
      const filtered = posts.filter((post) => {
        if (usernameSet.size > 0 && !usernameSet.has(post.username)) return false
        if (startTime && post.createTime < startTime) return false
        if (endTime && post.createTime > endTime) return false
        if (keywordLower) {
          const haystacks = [post.contentDesc, post.nickname, post.linkTitle, post.linkUrl, post.rawXml]
          const matched = haystacks.some((value) => String(value || '').toLowerCase().includes(keywordLower))
          if (!matched) return false
        }
        return true
      })
      const safeOffset = Math.max(0, Number(offset || 0))
      const safeLimit = Math.max(0, Number(limit || 0))
      const timeline = safeLimit > 0 ? filtered.slice(safeOffset, safeOffset + safeLimit) : filtered.slice(safeOffset)
      return { success: true, timeline }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async openMessageCursor(sessionId: string, batchSize: number, ascending: boolean, beginTimestamp: number, endTimestamp: number): Promise<{ success: boolean; cursor?: number; error?: string }> {
    return this.openMessageCursorWithMode(sessionId, batchSize, ascending, beginTimestamp, endTimestamp, 'full')
  }

  async openMessageCursorLite(sessionId: string, batchSize: number, ascending: boolean, beginTimestamp: number, endTimestamp: number): Promise<{ success: boolean; cursor?: number; error?: string }> {
    return this.openMessageCursorWithMode(sessionId, batchSize, ascending, beginTimestamp, endTimestamp, 'lite')
  }

  private async openMessageCursorWithMode(
    sessionId: string,
    batchSize: number,
    ascending: boolean,
    beginTimestamp: number,
    endTimestamp: number,
    mode: CursorMode
  ): Promise<{ success: boolean; cursor?: number; error?: string }> {
    try {
      this.ensureConnected()
      const tableName = this.getMessageTableName(sessionId)
      const dbPaths = await this.getSessionDbPaths(sessionId)
      const cursor = this.cursorId++
      const state: CursorState = {
        batchSize: Math.max(1, batchSize || 50),
        ascending: ascending === true,
        beginTimestamp: Number(beginTimestamp || 0),
        endTimestamp: Number(endTimestamp || 0),
        mode,
        sources: dbPaths.map((dbPath) => ({
          dbPath,
          tableName,
          offset: 0,
          buffer: [],
          exhausted: false,
          ...this.buildCursorQueryProfile(dbPath, tableName, mode)
        }))
      }
      this.cursors.set(cursor, state)
      return { success: true, cursor }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async fetchMessageBatch(cursor: number): Promise<{ success: boolean; rows?: any[]; hasMore?: boolean; error?: string }> {
    try {
      this.ensureConnected()
      const state = this.cursors.get(cursor)
      if (!state) {
        return { success: false, error: `消息游标不存在: ${cursor}` }
      }

      const rows: AnyRow[] = []
      while (rows.length < state.batchSize) {
        for (const source of state.sources) {
          if (!source.exhausted && source.buffer.length === 0) {
            this.fillSourceBuffer(source, state)
          }
        }

        const candidates = state.sources.filter((source) => source.buffer.length > 0)
        if (candidates.length === 0) break

        let bestSource = candidates[0]
        let bestKey = this.readSortKey(bestSource.buffer[0])
        for (let index = 1; index < candidates.length; index += 1) {
          const current = candidates[index]
          const currentKey = this.readSortKey(current.buffer[0])
          const pickCurrent = state.ascending ? currentKey < bestKey : currentKey > bestKey
          if (pickCurrent) {
            bestSource = current
            bestKey = currentKey
          }
        }

        const nextRow = bestSource.buffer.shift()
        if (nextRow) rows.push(nextRow)
      }

      const hasMore = state.sources.some((source) => !source.exhausted || source.buffer.length > 0)
      return { success: true, rows, hasMore }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async closeMessageCursor(cursor: number): Promise<{ success: boolean; error?: string }> {
    this.cursors.delete(cursor)
    return { success: true }
  }

  async execQuery(kind: string, path: string | null, sql: string, params: unknown[] = []): Promise<{ success: boolean; rows?: any[]; error?: string }> {
    try {
      this.ensureConnected()
      const readonlySql = assertReadonlySql(sql)
      const dbPath = this.resolveDbPath(kind, path)
      const db = this.openDb(dbPath)
      try {
        const stmt = db.prepare(readonlySql)
        if (!stmt.reader) {
          return { success: false, error: '仅允许执行返回结果集的只读查询' }
        }
        return { success: true, rows: stmt.all(...(params || [])) }
      } finally {
        db.close()
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getEmoticonCdnUrl(dbPath: string, md5: string): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      this.ensureConnected()
      const resolvedPath = this.resolveDbPath('media', dbPath)
      const db = this.openDb(resolvedPath)
      try {
        const row = db.prepare(`
          SELECT cdn_url, thumb_url, encrypt_url
          FROM kNonStoreEmoticonTable
          WHERE md5 = ?
          LIMIT 1
        `).get(md5) as AnyRow | undefined
        return {
          success: true,
          url: String(row?.cdn_url || row?.thumb_url || row?.encrypt_url || '').trim() || undefined
        }
      } finally {
        db.close()
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async listMessageDbs(): Promise<{ success: boolean; data?: string[]; error?: string }> {
    try {
      this.ensureConnected()
      return { success: true, data: this.getMessageDbPaths() }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async listMediaDbs(): Promise<{ success: boolean; data?: string[]; error?: string }> {
    try {
      this.ensureConnected()
      return { success: true, data: this.getMediaDbPaths() }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getMessageById(sessionId: string, localId: number): Promise<{ success: boolean; message?: any; error?: string }> {
    try {
      this.ensureConnected()
      const tableName = this.getMessageTableName(sessionId)
      const dbPaths = await this.getSessionDbPaths(sessionId)
      for (const dbPath of dbPaths) {
        const db = this.openDb(dbPath)
        try {
          const row = db.prepare(`
            SELECT
              m.*,
              sender_map.user_name AS sender_username,
              CASE
                WHEN lower(COALESCE(sender_map.user_name, '')) IN (?, ?) THEN 1
                ELSE NULL
              END AS computed_is_send
            FROM ${quoteIdentifier(tableName)} m
            LEFT JOIN Name2Id sender_map ON sender_map.rowid = m.real_sender_id
            WHERE m.local_id = ?
            LIMIT 1
          `).get(this.getProfile().wxid.toLowerCase(), this.getProfile().wxidClean.toLowerCase(), localId)
          if (row) return { success: true, message: row }
        } finally {
          db.close()
        }
      }
      return { success: false, error: '未找到消息' }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async getLogs(): Promise<{ success: boolean; logs?: string[]; error?: string }> {
    return {
      success: true,
      logs: [
        'macOS profile backend active',
        `userData=${app.getPath('userData')}`,
        `profile=${macProfileService.getProfilePath()}`
      ]
    }
  }

  async verifyUser(_message: string, _hwnd?: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'macOS 版本不使用系统生物识别验证接口' }
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('macOS SQLite 后端尚未连接')
    }
  }

  private getProfile(): ResolvedMacProfile {
    const result = macProfileService.loadProfile()
    if (!result.success) throw new Error(result.error)
    return result.profile
  }

  private openDbByRelative(relativePath: string): Database.Database {
    return this.openDb(this.getLocalDbPath(relativePath))
  }

  private openDb(dbPath: string): Database.Database {
    return new Database(dbPath, { readonly: true, fileMustExist: true })
  }

  private getLocalDbPath(relativePath: string): string {
    const profile = this.getProfile()
    const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
    const keyEntry = this.getDatabaseKeyEntry(normalized)
    return sqlcipherMacService.prepareReadableDb(profile, normalized, keyEntry)
  }

  private getDatabaseKeyEntry(relativePath: string) {
    const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
    const entry = this.getProfile().databaseKeys[normalized]
    if (!entry) {
      throw new Error(`profile.json 中缺少数据库 key: ${normalized}`)
    }
    return entry
  }


  private resolveDbPath(kind: string, inputPath: string | null): string {
    if (inputPath && existsSync(inputPath)) {
      const cacheRoot = join(this.getProfile().cachePath, 'sqlite')
      if (inputPath.startsWith(cacheRoot)) return inputPath
    }

    const relativePath = this.resolveRelativePath(kind, inputPath)
    return this.getLocalDbPath(relativePath)
  }

  private resolveRelativePath(kind: string, inputPath: string | null): string {
    const profile = this.getProfile()
    const normalized = String(inputPath || '').replace(/\\/g, '/').trim()
    const fromDecrypted = normalized && normalized.startsWith(profile.decryptedRoot.replace(/\\/g, '/'))
      ? relative(profile.decryptedRoot, normalized).replace(/\\/g, '/')
      : ''
    if (fromDecrypted) return fromDecrypted

    const patterns: Array<[RegExp, string]> = [
      [/\/db_storage\/contact\/contact\.db$/i, 'contact/contact.db'],
      [/\/db_storage\/session\/session\.db$/i, 'session/session.db'],
      [/\/db_storage\/hardlink\/hardlink\.db$/i, 'hardlink/hardlink.db'],
      [/\/db_storage\/head_image\/head_image\.db$/i, 'head_image/head_image.db'],
      [/\/db_storage\/emoticon\/emoticon\.db$/i, 'emoticon/emoticon.db']
    ]
    for (const [pattern, value] of patterns) {
      if (normalized && pattern.test(normalized)) return value
    }

    const baseName = basename(normalized)
    if (/^(message_\d+|biz_message_\d+)\.db$/i.test(baseName)) return `message/${baseName}`
    if (/^media_\d+\.db$/i.test(baseName)) return `message/${baseName}`
    if (baseName === 'contact.db') return 'contact/contact.db'
    if (baseName === 'session.db') return 'session/session.db'
    if (baseName === 'hardlink.db') return 'hardlink/hardlink.db'
    if (baseName === 'head_image.db') return 'head_image/head_image.db'
    if (baseName === 'emoticon.db') return 'emoticon/emoticon.db'

    switch (kind) {
      case 'contact':
        return 'contact/contact.db'
      case 'session':
        return 'session/session.db'
      case 'media':
        return 'hardlink/hardlink.db'
      default:
        throw new Error(`无法解析数据库路径 kind=${kind} path=${inputPath || ''}`)
    }
  }

  private queryContacts(usernames: string[], columns: string): AnyRow[] {
    const normalizedUsernames = Array.from(new Set((usernames || []).map((item) => String(item || '').trim()).filter(Boolean)))
    if (normalizedUsernames.length === 0) return []

    const db = this.openDbByRelative('contact/contact.db')
    try {
      const placeholders = normalizedUsernames.map(() => '?').join(',')
      return db.prepare(`SELECT ${columns} FROM contact NOT INDEXED WHERE username IN (${placeholders})`).all(...normalizedUsernames) as AnyRow[]
    } finally {
      db.close()
    }
  }

  private getMessageDbPaths(): string[] {
    const now = Date.now()
    if (this.messageDbListCache && now - this.messageDbListCache.updatedAt < this.cacheTtlMs) {
      return this.messageDbListCache.paths
    }
    const relativePaths = Object.keys(this.getProfile().databaseKeys)
      .filter((relativePath) => /^message\/(message_\d+|biz_message_\d+)\.db$/i.test(relativePath))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    const paths = relativePaths.map((relativePath) => this.getLocalDbPath(relativePath))
    this.messageDbListCache = { paths, updatedAt: now }
    return paths
  }

  private getMediaDbPaths(): string[] {
    const now = Date.now()
    if (this.mediaDbListCache && now - this.mediaDbListCache.updatedAt < this.cacheTtlMs) {
      return this.mediaDbListCache.paths
    }
    const relativePaths = Object.keys(this.getProfile().databaseKeys)
      .filter((relativePath) => /^message\/media_\d+\.db$/i.test(relativePath))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    const paths = relativePaths.map((relativePath) => this.getLocalDbPath(relativePath))
    this.mediaDbListCache = { paths, updatedAt: now }
    return paths
  }

  private async getSessionDbPaths(sessionId: string): Promise<string[]> {
    const tableName = this.getMessageTableName(sessionId)
    return this.getMessageDbPaths().filter((dbPath) => this.messageTableExists(dbPath, tableName))
  }

  private messageTableExists(dbPath: string, tableName: string): boolean {
    const cacheKey = `${dbPath}\u0001${tableName}`
    const cached = this.tablePresenceCache.get(cacheKey)
    if (cached !== undefined) return cached

    const db = this.openDb(dbPath)
    try {
      const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1`).get(tableName)
      const exists = Boolean(row)
      this.tablePresenceCache.set(cacheKey, exists)
      return exists
    } finally {
      db.close()
    }
  }

  private getMessageTableName(sessionId: string): string {
    return `Msg_${crypto.createHash('md5').update(String(sessionId || '').trim()).digest('hex')}`
  }

  private buildCursorQueryProfile(
    dbPath: string,
    tableName: string,
    mode: CursorMode
  ): { selectClause: string; orderColumn: string; tieBreakerColumn: string } {
    if (mode === 'full') {
      return {
        selectClause: `
          m.*,
          sender_map.user_name AS sender_username,
          CASE
            WHEN lower(COALESCE(sender_map.user_name, '')) IN (?, ?) THEN 1
            ELSE NULL
          END AS computed_is_send
        `,
        orderColumn: 'sort_seq',
        tieBreakerColumn: 'local_id'
      }
    }

    const columns = this.getMessageTableColumns(dbPath, tableName)
    const required = {
      localId: this.pickExistingColumn(columns, ['local_id', 'localId']),
      createTime: this.pickExistingColumn(columns, ['create_time', 'createTime']),
      localType: this.pickExistingColumn(columns, ['local_type', 'type', 'msg_type', 'msgType']),
      sortSeq: this.pickExistingColumn(columns, ['sort_seq', 'sortSeq', 'create_time', 'createTime', 'local_id', 'localId'])
    }

    if (!required.localId || !required.createTime || !required.localType || !required.sortSeq) {
      return {
        selectClause: `
          m.*,
          sender_map.user_name AS sender_username,
          CASE
            WHEN lower(COALESCE(sender_map.user_name, '')) IN (?, ?) THEN 1
            ELSE NULL
          END AS computed_is_send
        `,
        orderColumn: 'sort_seq',
        tieBreakerColumn: 'local_id'
      }
    }

    const optionalColumns: Array<[string[], string]> = [
      [['message_content', 'messageContent', 'content', 'msg_content', 'msgContent'], 'message_content'],
      [['compress_content', 'compressContent', 'compressed_content', 'compressedContent'], 'compress_content'],
      [['image_md5', 'imageMd5'], 'image_md5'],
      [['image_dat_name', 'imageDatName'], 'image_dat_name'],
      [['emoji_cdn_url', 'emojiCdnUrl', 'emoji_url', 'emojiUrl', 'cdn_url', 'cdnUrl'], 'emoji_cdn_url'],
      [['emoji_md5', 'emojiMd5'], 'emoji_md5'],
      [['video_md5', 'videoMd5'], 'video_md5']
    ]

    const selectParts = [
      `m.${quoteIdentifier(required.localId)} AS local_id`,
      `m.${quoteIdentifier(required.createTime)} AS create_time`,
      `m.${quoteIdentifier(required.localType)} AS local_type`,
      `m.${quoteIdentifier(required.sortSeq)} AS sort_seq`
    ]

    for (const [candidates, alias] of optionalColumns) {
      const actual = this.pickExistingColumn(columns, candidates)
      if (actual) {
        selectParts.push(`m.${quoteIdentifier(actual)} AS ${quoteIdentifier(alias)}`)
      }
    }

    selectParts.push(
      'sender_map.user_name AS sender_username',
      `CASE
            WHEN lower(COALESCE(sender_map.user_name, '')) IN (?, ?) THEN 1
            ELSE NULL
          END AS computed_is_send`
    )

    const selectClause = selectParts.join(',\n          ')

    return {
      selectClause: `
          ${selectClause}
        `,
      orderColumn: required.sortSeq,
      tieBreakerColumn: required.localId
    }
  }

  private getMessageTableColumns(dbPath: string, tableName: string): Set<string> {
    const cacheKey = `${dbPath}${tableName}`
    const cached = this.messageTableColumnCache.get(cacheKey)
    if (cached) return cached

    const db = this.openDb(dbPath)
    try {
      const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as AnyRow[]
      const columns = new Set<string>()
      for (const row of rows) {
        const name = String(row?.name || '').trim()
        if (name) columns.add(name)
      }
      this.messageTableColumnCache.set(cacheKey, columns)
      return columns
    } finally {
      db.close()
    }
  }

  private pickExistingColumn(columns: Set<string>, candidates: string[]): string | null {
    for (const candidate of candidates) {
      if (columns.has(candidate)) return candidate
    }
    return null
  }

  private fillSourceBuffer(source: CursorSource, state: CursorState): void {
    const db = this.openDb(source.dbPath)
    try {
      const profile = this.getProfile()
      const whereClauses = ['1 = 1']
      const params: any[] = [profile.wxid.toLowerCase(), profile.wxidClean.toLowerCase()]
      if (state.beginTimestamp > 0) {
        whereClauses.push('m.create_time >= ?')
        params.push(state.beginTimestamp)
      }
      if (state.endTimestamp > 0) {
        whereClauses.push('m.create_time <= ?')
        params.push(state.endTimestamp)
      }
      params.push(state.batchSize, source.offset)

      const order = state.ascending ? 'ASC' : 'DESC'
      const sql = `
        SELECT
${source.selectClause}
        FROM ${quoteIdentifier(source.tableName)} m
        LEFT JOIN Name2Id sender_map ON sender_map.rowid = m.real_sender_id
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY m.${quoteIdentifier(source.orderColumn)} ${order}, m.${quoteIdentifier(source.tieBreakerColumn)} ${order}
        LIMIT ? OFFSET ?
      `

      const rows = db.prepare(sql).all(...params) as AnyRow[]
      source.buffer = rows
      source.offset += rows.length
      if (rows.length === 0) {
        source.exhausted = true
      }
    } finally {
      db.close()
    }
  }

  private createAggregateSkeleton(): AnyRow {
    return {
      total: 0,
      sent: 0,
      received: 0,
      firstTime: 0,
      lastTime: 0,
      typeCounts: {},
      hourly: {},
      weekday: {},
      daily: {},
      monthly: {},
      sessions: {},
      idMap: {}
    }
  }

  private normalizeSessionIds(sessionIds: string[]): string[] {
    return Array.from(new Set((sessionIds || []).map((item) => String(item || '').trim()).filter(Boolean)))
  }


  private async accumulateSessionAggregate(aggregate: AnyRow, sessionId: string, beginTimestamp: number, endTimestamp: number, includeSenders: boolean): Promise<void> {
    const cursor = await this.openMessageCursor(sessionId, 1000, true, beginTimestamp, endTimestamp)
    if (!cursor.success || !cursor.cursor) {
      throw new Error(cursor.error || `打开消息游标失败: ${sessionId}`)
    }

    try {
      while (true) {
        const batch = await this.fetchMessageBatch(cursor.cursor)
        if (!batch.success) {
          throw new Error(batch.error || `读取消息批次失败: ${sessionId}`)
        }

        for (const row of (batch.rows || []) as AnyRow[]) {
          this.accumulateAggregateRow(aggregate, sessionId, row, includeSenders)
        }

        if (!batch.hasMore) break
      }
    } finally {
      await this.closeMessageCursor(cursor.cursor)
    }
  }

  private accumulateAggregateRow(aggregate: AnyRow, sessionId: string, row: AnyRow, includeSenders: boolean): void {
    const createTime = this.readCreateTime(row)
    if (createTime <= 0) return

    const localType = this.readLocalType(row)
    const isSend = this.readIsSend(row)
    const sessionStats = aggregate.sessions[sessionId] || {
      total: 0,
      sent: 0,
      received: 0,
      lastTime: 0,
      ...(includeSenders ? { senders: {} } : {})
    }

    aggregate.sessions[sessionId] = sessionStats
    aggregate.idMap[sessionId] = sessionId
    aggregate.total += 1
    sessionStats.total += 1
    this.incrementCounter(aggregate.typeCounts, localType, 1)

    if (isSend) {
      aggregate.sent += 1
      sessionStats.sent += 1
    } else {
      aggregate.received += 1
      sessionStats.received += 1
    }

    if (!aggregate.firstTime || createTime < aggregate.firstTime) {
      aggregate.firstTime = createTime
    }
    if (createTime > aggregate.lastTime) {
      aggregate.lastTime = createTime
    }
    if (createTime > sessionStats.lastTime) {
      sessionStats.lastTime = createTime
    }

    const date = new Date(createTime * 1000)
    const hour = date.getHours()
    const weekday = date.getDay()
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const dayKey = `${monthKey}-${String(date.getDate()).padStart(2, '0')}`
    this.incrementCounter(aggregate.hourly, hour, 1)
    this.incrementCounter(aggregate.weekday, weekday, 1)
    this.incrementCounter(aggregate.monthly, monthKey, 1)
    this.incrementCounter(aggregate.daily, dayKey, 1)

    if (includeSenders) {
      const senderUsername = this.readSenderUsername(row)
      if (senderUsername) {
        sessionStats.senders = sessionStats.senders || {}
        sessionStats.senders[senderUsername] = Number(sessionStats.senders[senderUsername] || 0) + 1
        aggregate.idMap[senderUsername] = senderUsername
      }
    }
  }

  private getSnsTimelinePosts(): SnsTimelinePost[] {
    const dbPath = this.getLocalDbPath('sns/sns.db')
    const stat = statSync(dbPath)
    const signature = `${dbPath}:${Math.floor(stat.mtimeMs)}:${stat.size}`
    if (this.snsTimelineCache && this.snsTimelineCache.signature === signature) {
      return this.snsTimelineCache.posts
    }

    const db = this.openDb(dbPath)
    try {
      const rows = db.prepare(`
        SELECT tid, user_name, content
        FROM SnsTimeLine
        ORDER BY tid DESC
      `).all() as AnyRow[]
      const posts = rows.map((row) => this.parseSnsTimelineRow(row))
      this.snsTimelineCache = { signature, posts }
      return posts
    } finally {
      db.close()
    }
  }

  private parseSnsTimelineRow(row: AnyRow): SnsTimelinePost {
    const rawXml = this.coerceText(row?.content)
    const tid = String(row?.tid || '')
    const username = extractXmlTagValue(rawXml, ['username']) || String(row?.user_name || '').trim()
    const nickname = extractXmlTagValue(rawXml, ['sourceNickName', 'nickname', 'nickName']) || username
    const createTime = this.parseInteger(extractXmlTagValue(rawXml, ['createTime']))
    const type = this.parseInteger(extractXmlTagValue(rawXml, ['type']))
    const contentDesc = extractXmlTagValue(rawXml, ['contentDesc'])
    const media = this.parseSnsMediaFromXml(rawXml)
    const likes = this.parseSnsLikesFromXml(rawXml)
    const comments = this.parseSnsCommentsFromXml(rawXml)
    return {
      id: extractXmlTagValue(rawXml, ['id']) || tid,
      tid: tid || undefined,
      username,
      nickname,
      createTime,
      contentDesc,
      type: Number.isFinite(type) ? type : undefined,
      media,
      likes,
      comments,
      rawXml: rawXml || undefined,
      linkTitle: extractXmlTagValue(rawXml, ['title']),
      linkUrl: extractXmlTagValue(rawXml, ['contentUrl', 'webpageurl', 'webUrl'])
    }
  }

  private parseInteger(value: unknown): number {
    const parsed = Number.parseInt(String(value || ''), 10)
    return Number.isFinite(parsed) ? parsed : 0
  }

  private parseSnsMediaFromXml(xml: string): Array<Record<string, any>> {
    if (!xml) return []
    const contentObjectMatch = /<ContentObject>([\s\S]*?)<\/ContentObject>/i.exec(xml)
    const mediaListMatch = /<mediaList>([\s\S]*?)<\/mediaList>/i.exec(contentObjectMatch?.[1] || xml)
    if (!mediaListMatch?.[1]) return []

    const media: Array<Record<string, any>> = []
    const mediaRegex = /<media>([\s\S]*?)<\/media>/gi
    let match: RegExpExecArray | null
    while ((match = mediaRegex.exec(mediaListMatch[1])) !== null) {
      const block = match[1]
      const urlAttrs = /<url([^>]*)>/i.exec(block)?.[1] || ''
      const thumbAttrs = /<thumb([^>]*)>/i.exec(block)?.[1] || ''
      const item: Record<string, any> = {
        url: extractXmlTagValue(block, ['url']),
        thumb: extractXmlTagValue(block, ['thumb']),
        md5: /md5="([^"]+)"/i.exec(urlAttrs)?.[1],
        token: /token="([^"]+)"/i.exec(urlAttrs)?.[1] || /token="([^"]+)"/i.exec(thumbAttrs)?.[1],
        key: /key="([^"]+)"/i.exec(urlAttrs)?.[1] || /key="([^"]+)"/i.exec(thumbAttrs)?.[1],
        encIdx: /enc_idx="([^"]+)"/i.exec(urlAttrs)?.[1] || /enc_idx="([^"]+)"/i.exec(thumbAttrs)?.[1]
      }

      const livePhotoMatch = /<livePhoto>([\s\S]*?)<\/livePhoto>/i.exec(block)
      if (livePhotoMatch?.[1]) {
        const liveBlock = livePhotoMatch[1]
        const liveUrlAttrs = /<url([^>]*)>/i.exec(liveBlock)?.[1] || ''
        const liveThumbAttrs = /<thumb([^>]*)>/i.exec(liveBlock)?.[1] || ''
        item.livePhoto = {
          url: extractXmlTagValue(liveBlock, ['url']),
          thumb: extractXmlTagValue(liveBlock, ['thumb']),
          md5: /md5="([^"]+)"/i.exec(liveUrlAttrs)?.[1],
          token: /token="([^"]+)"/i.exec(liveUrlAttrs)?.[1] || /token="([^"]+)"/i.exec(liveThumbAttrs)?.[1],
          key: /key="([^"]+)"/i.exec(liveUrlAttrs)?.[1] || /key="([^"]+)"/i.exec(liveThumbAttrs)?.[1],
          encIdx: /enc_idx="([^"]+)"/i.exec(liveUrlAttrs)?.[1] || /enc_idx="([^"]+)"/i.exec(liveThumbAttrs)?.[1]
        }
      }

      media.push(item)
    }

    return media
  }

  private parseSnsLikesFromXml(xml: string): string[] {
    if (!xml) return []
    const listMatch = /<(?:LikeUserList|likeUserList|likeList|like_user_list)>([\s\S]*?)<\/(?:LikeUserList|likeUserList|likeList|like_user_list)>/i.exec(xml)
    if (!listMatch?.[1]) return []
    const likes: string[] = []
    const regex = /<(?:LikeUser|likeUser|user_comment)>([\s\S]*?)<\/(?:LikeUser|likeUser|user_comment)>/gi
    let match: RegExpExecArray | null
    while ((match = regex.exec(listMatch[1])) !== null) {
      const block = match[1]
      const nickname = extractXmlTagValue(block, ['nickname', 'nickName'])
      const username = extractXmlTagValue(block, ['username'])
      const value = nickname || username
      if (value) likes.push(value)
    }
    return likes
  }

  private parseSnsCommentsFromXml(xml: string): Array<Record<string, any>> {
    if (!xml) return []
    const listMatch = /<(?:CommentUserList|commentUserList|commentList|comment_user_list)>([\s\S]*?)<\/(?:CommentUserList|commentUserList|commentList|comment_user_list)>/i.exec(xml)
    if (!listMatch?.[1]) return []
    const comments: Array<Record<string, any>> = []
    const regex = /<(?:CommentUser|commentUser|comment|user_comment)>([\s\S]*?)<\/(?:CommentUser|commentUser|comment|user_comment)>/gi
    let match: RegExpExecArray | null
    while ((match = regex.exec(listMatch[1])) !== null) {
      const block = match[1]
      comments.push({
        id: extractXmlTagValue(block, ['cmtid', 'commentId', 'comment_id', 'id']),
        nickname: extractXmlTagValue(block, ['nickname', 'nickName']),
        content: extractXmlTagValue(block, ['content']),
        refCommentId: extractXmlTagValue(block, ['refCommentId', 'replyCommentId', 'ref_comment_id']),
        refNickname: extractXmlTagValue(block, ['refNickname', 'refNickName', 'replyNickname']) || undefined
      })
    }
    return comments.filter((item) => item.nickname || item.content)
  }

  private buildTopCountEntries(counter: Map<string, number>, limit: number = 10): Array<{ username: string; count: number }> {
    return Array.from(counter.entries())
      .filter(([username, count]) => username && count > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, Math.max(1, limit))
      .map(([username, count]) => ({ username, count }))
  }

  private async forEachMessageRow(
    sessionId: string,
    beginTimestamp: number,
    endTimestamp: number,
    visitor: (row: AnyRow) => void | Promise<void>
  ): Promise<void> {
    const cursor = await this.openMessageCursor(sessionId, 2000, true, beginTimestamp, endTimestamp)
    if (!cursor.success || !cursor.cursor) {
      throw new Error(cursor.error || `打开消息游标失败: ${sessionId}`)
    }

    try {
      while (true) {
        const batch = await this.fetchMessageBatch(cursor.cursor)
        if (!batch.success) {
          throw new Error(batch.error || `读取消息批次失败: ${sessionId}`)
        }
        for (const row of (batch.rows || []) as AnyRow[]) {
          const maybePromise = visitor(row)
          if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
            await maybePromise
          }
        }
        if (!batch.hasMore) break
      }
    } finally {
      await this.closeMessageCursor(cursor.cursor)
    }
  }

  private pickField(row: AnyRow, keys: string[]): unknown {
    for (const key of keys) {
      const value = row?.[key]
      if (value !== undefined && value !== null) {
        return value
      }
    }
    return undefined
  }

  private coerceText(raw: unknown): string {
    if (raw === undefined || raw === null) return ''
    if (typeof raw === 'string') return raw
    if (Buffer.isBuffer(raw)) return this.decodeBinaryContent(raw)
    if (raw instanceof Uint8Array) return this.decodeBinaryContent(Buffer.from(raw))
    return String(raw)
  }

  private looksLikeHex(value: string): boolean {
    return value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value)
  }

  private looksLikeBase64(value: string): boolean {
    return value.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(value)
  }

  private decodeMaybeCompressed(raw: unknown): string {
    if (!raw) return ''
    if (Buffer.isBuffer(raw)) return this.decodeBinaryContent(raw)
    if (raw instanceof Uint8Array) return this.decodeBinaryContent(Buffer.from(raw))
    if (typeof raw === 'string') {
      if (!raw) return ''
      if (raw.length > 16 && this.looksLikeHex(raw)) {
        const bytes = Buffer.from(raw, 'hex')
        if (bytes.length > 0) return this.decodeBinaryContent(bytes)
      }
      if (raw.length > 16 && this.looksLikeBase64(raw)) {
        try {
          return this.decodeBinaryContent(Buffer.from(raw, 'base64'))
        } catch {
          return raw
        }
      }
      return raw
    }
    return String(raw)
  }

  private decodeBinaryContent(data: Buffer): string {
    if (!data || data.length === 0) return ''
    try {
      if (data.length >= 4 && data.readUInt32LE(0) === 0xFD2FB528) {
        const decompressed = fzstd.decompress(data)
        return Buffer.from(decompressed).toString('utf8')
      }
      const utf8 = data.toString('utf8')
      const replacementCount = (utf8.match(/�/g) || []).length
      if (replacementCount < utf8.length * 0.2) {
        return utf8.replace(/�/g, '')
      }
      return data.toString('latin1')
    } catch {
      return ''
    }
  }

  private decodeMessageContent(messageContent: unknown, compressContent: unknown): string {
    const compressed = this.decodeMaybeCompressed(compressContent)
    if (compressed) return compressed
    return this.decodeMaybeCompressed(messageContent)
  }

  private readMessageContent(row: AnyRow): string {
    return this.decodeMessageContent(
      this.pickField(row, ['message_content', 'messageContent', 'content', 'msg_content', 'msgContent', 'WCDB_CT_message_content', 'WCDB_CT_messageContent']),
      this.pickField(row, ['compress_content', 'compressContent', 'compressed_content', 'WCDB_CT_compress_content', 'WCDB_CT_compressContent'])
    )
  }

  private stripEmojiOwnerPrefix(content: string): string {
    return String(content || '').replace(/^\s*[01]\s*:\s*/, '')
  }

  private normalizeStatisticsText(content: string): string {
    return this.stripEmojiOwnerPrefix(String(content || ''))
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\r/g, ' ')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private extractPhraseCandidate(content: string, localType: number): string | undefined {
    if (localType !== 1 && localType !== 244813135921) return undefined
    const text = this.normalizeStatisticsText(content)
    if (text.length < 2 || text.length > 20) return undefined
    if (text.includes('http') || text.includes('<') || text.startsWith('[') || text.startsWith('<?xml')) return undefined
    return text
  }

  private normalizeEmojiMd5(value: string): string | undefined {
    const trimmed = String(value || '').trim()
    if (!trimmed) return undefined
    const match = /([a-f0-9]{16,64})/i.exec(trimmed)
    return match ? match[1].toLowerCase() : undefined
  }

  private normalizeEmojiUrl(value: string): string | undefined {
    let next = String(value || '').trim().replace(/&amp;/g, '&')
    if (!next) return undefined
    try {
      if (next.includes('%')) next = decodeURIComponent(next)
    } catch {}
    return next || undefined
  }

  private extractEmojiMd5(content: string, row?: AnyRow): string | undefined {
    const direct = this.normalizeEmojiMd5(this.coerceText(this.pickField(row || {}, ['emoji_md5', 'emojiMd5', 'md5'])))
    if (direct) return direct
    const stripped = this.stripEmojiOwnerPrefix(content)
    const match = /md5\s*=\s*['"]([a-f0-9]{16,64})['"]/i.exec(stripped)
      || /md5\s*=\s*([a-f0-9]{16,64})/i.exec(stripped)
      || /<md5>([a-f0-9]{16,64})<\/md5>/i.exec(stripped)
      || /([a-f0-9]{16,64})/i.exec(stripped)
    return this.normalizeEmojiMd5(match?.[1] || '')
  }

  private extractEmojiUrl(content: string, row?: AnyRow): string | undefined {
    const direct = this.normalizeEmojiUrl(this.coerceText(this.pickField(row || {}, ['emoji_cdn_url', 'emojiCdnUrl', 'cdnurl', 'cdn_url', 'emoji_url', 'emojiUrl', 'url', 'thumburl', 'thumb_url'])))
    if (direct) return direct
    const stripped = this.stripEmojiOwnerPrefix(content)
    const attrMatch = /(?:cdnurl|thumburl)\s*=\s*['"]([^'"]+)['"]/i.exec(stripped)
      || /(?:cdnurl|thumburl)\s*=\s*([^'"\s>]+)/i.exec(stripped)
      || /<(?:cdnurl|thumburl)>([^<]+)<\/(?:cdnurl|thumburl)>/i.exec(stripped)
      || /(?:cdnurl|thumburl)[^>]*>([^<]+)/i.exec(stripped)
    return this.normalizeEmojiUrl(attrMatch?.[1] || '')
  }

  private buildPhraseEntries(counter: Map<string, number>, options: { minCount?: number; limit?: number } = {}): Array<{ phrase: string; count: number }> {
    const minCount = Math.max(1, Number(options.minCount || 1))
    const limit = Number(options.limit || 0)
    const entries = Array.from(counter.entries())
      .filter(([, count]) => count >= minCount)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    if (limit > 0 && entries.length > limit) {
      entries.length = limit
    }
    return entries.map(([phrase, count]) => ({ phrase, count }))
  }

  private formatDateYmd(value: Date): string {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  }

  private incrementCounter(target: Record<string, number>, key: string | number, amount: number): void {
    const normalizedKey = String(key)
    target[normalizedKey] = Number(target[normalizedKey] || 0) + amount
  }

  private readCreateTime(row: AnyRow): number {
    const value = Number(row?.create_time || row?.createTime || row?.create_time_ms || 0)
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  }

  private readLocalType(row: AnyRow): number {
    const value = Number(row?.local_type || row?.type || 1)
    return Number.isFinite(value) ? Math.floor(value) : 1
  }

  private readSenderUsername(row: AnyRow): string | undefined {
    const value = String(row?.sender_username || row?.senderUsername || row?.sender || '').trim()
    return value || undefined
  }

  private readIsSend(row: AnyRow): boolean {
    const raw = row?.computed_is_send ?? row?.is_send ?? row?.isSend
    if (raw === 1 || raw === true || String(raw) === '1') return true
    if (raw === 0 || raw === false || String(raw) === '0') return false

    const senderUsername = this.readSenderUsername(row)
    if (!senderUsername) return false
    const profile = this.getProfile()
    const senderLower = senderUsername.toLowerCase()
    const wxidLower = profile.wxid.toLowerCase()
    const wxidCleanLower = profile.wxidClean.toLowerCase()
    return senderLower === wxidLower || senderLower === wxidCleanLower || (wxidLower.startsWith(`${senderLower}_`))
  }

  private readSortKey(row: AnyRow): number {
    const value = Number(row?.sort_seq || row?.sortSeq || row?.create_time || row?.createTime || row?.local_id || row?.localId || 0)
    return Number.isFinite(value) ? value : 0
  }
}

export const wcdbMacService = new WcdbMacService()
