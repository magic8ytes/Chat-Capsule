import * as fs from 'fs'
import * as path from 'path'
import { resolveWechatEmojiPath } from '../utils/wechatEmoji'
import { parseChatRecordList, type ParsedChatRecordItem } from '../utils/chatRecordParser'
import { escapeAttribute, escapeHtml } from '../utils/exportFormatters'
import { extractFinderFeedDesc, normalizeAppMessageContent } from '../utils/exportMessageContent'
import { cleanAccountDirName } from '../utils/chatServiceHelpers'
import { MESSAGE_TYPE_MAP, TXT_COLUMN_DEFINITIONS } from '../utils/exportServiceConstants'
import { LRUCache } from '../utils/LRUCache.js'
import { EXPORT_HTML_STYLES } from './exportHtmlStyles'
import { voiceTranscribeService } from './voiceTranscribeService'

interface MediaExportItem {
  relativePath: string
  kind: 'image' | 'voice' | 'emoji' | 'video'
  posterDataUrl?: string
}

export class ExportMessageFormatter {
  private htmlStyleCache: string | null = null

  constructor(private readonly inlineEmojiCache: LRUCache<string, string>) {}

  public convertMessageType(localType: number, content: string): number {
    // 检查 XML 中的 type 标签（支持大 localType 的情况）
    const xmlTypeMatch = /<type>(\d+)<\/type>/i.exec(content)
    const xmlType = xmlTypeMatch ? parseInt(xmlTypeMatch[1]) : null

    // 特殊处理 type 49 或 XML type
    if (localType === 49 || xmlType) {
      const subType = xmlType || 0
      switch (subType) {
        case 6: return 4   // 文件 -> FILE
        case 19: return 7  // 聊天记录 -> LINK (ChatLab 没有专门的聊天记录类型)
        case 33:
        case 36: return 24 // 小程序 -> SHARE
        case 57: return 25 // 引用回复 -> REPLY
        case 2000: return 99 // 转账 -> OTHER (ChatLab 没有转账类型)
        case 5:
        case 49: return 7  // 链接 -> LINK
        default:
          if (xmlType) return 7 // 有 XML type 但未知，默认为链接
      }
    }
    return MESSAGE_TYPE_MAP[localType] ?? 99 // 未知类型 -> OTHER
  }

  /**
   * 解码消息内容
   */
  public decodeMessageContent(messageContent: any, compressContent: any): string {
    let content = this.decodeMaybeCompressed(compressContent)
    if (!content || content.length === 0) {
      content = this.decodeMaybeCompressed(messageContent)
    }
    return content
  }

  public decodeMaybeCompressed(raw: any): string {
    if (!raw) return ''
    if (typeof raw === 'string') {
      if (raw.length === 0) return ''
      if (/^[0-9]+$/.test(raw)) {
        return raw
      }
      // 只有当字符串足够长（超过16字符）且看起来像 hex 时才尝试解码
      if (raw.length > 16 && this.looksLikeHex(raw)) {
        const bytes = Buffer.from(raw, 'hex')
        if (bytes.length > 0) return this.decodeBinaryContent(bytes)
      }
      // 只有当字符串足够长（超过16字符）且看起来像 base64 时才尝试解码
      // 短字符串（如 "test", "home" 等）容易被误判为 base64
      if (raw.length > 16 && this.looksLikeBase64(raw)) {
        try {
          const bytes = Buffer.from(raw, 'base64')
          return this.decodeBinaryContent(bytes)
        } catch {
          return raw
        }
      }
      return raw
    }
    return ''
  }

  public decodeBinaryContent(data: Buffer): string {
    if (data.length === 0) return ''
    try {
      if (data.length >= 4) {
        const magic = data.readUInt32LE(0)
        if (magic === 0xFD2FB528) {
          const fzstd = require('fzstd')
          const decompressed = fzstd.decompress(data)
          return Buffer.from(decompressed).toString('utf-8')
        }
      }
      const decoded = data.toString('utf-8')
      const replacementCount = (decoded.match(/\uFFFD/g) || []).length
      if (replacementCount < decoded.length * 0.2) {
        return decoded.replace(/\uFFFD/g, '')
      }
      return data.toString('latin1')
    } catch {
      return ''
    }
  }

  public looksLikeHex(s: string): boolean {
    if (s.length % 2 !== 0) return false
    return /^[0-9a-fA-F]+$/.test(s)
  }

  public normalizeGroupNickname(value: string): string {
    const trimmed = (value || '').trim()
    if (!trimmed) return ''
    const cleaned = trimmed.replace(/[\x00-\x1F\x7F]/g, '')
    if (!cleaned) return ''
    if (/^[,"'“”‘’，、]+$/.test(cleaned)) return ''
    return cleaned
  }

  public buildGroupNicknameIdCandidates(values: Array<string | undefined | null>): string[] {
    const set = new Set<string>()
    for (const rawValue of values) {
      const raw = String(rawValue || '').trim()
      if (!raw) continue
      set.add(raw)
      const cleaned = cleanAccountDirName(raw)
      if (cleaned && cleaned !== raw) set.add(cleaned)
    }
    return Array.from(set)
  }

  public resolveGroupNicknameByCandidates(groupNicknamesMap: Map<string, string>, candidates: Array<string | undefined | null>): string {
    const idCandidates = this.buildGroupNicknameIdCandidates(candidates)
    if (idCandidates.length === 0) return ''

    for (const id of idCandidates) {
      const exact = this.normalizeGroupNickname(groupNicknamesMap.get(id) || '')
      if (exact) return exact
      const lower = this.normalizeGroupNickname(groupNicknamesMap.get(id.toLowerCase()) || '')
      if (lower) return lower
    }

    for (const id of idCandidates) {
      const lower = id.toLowerCase()
      let found = ''
      let matched = 0
      for (const [key, value] of groupNicknamesMap.entries()) {
        if (String(key || '').toLowerCase() !== lower) continue
        const normalized = this.normalizeGroupNickname(value || '')
        if (!normalized) continue
        found = normalized
        matched += 1
        if (matched > 1) return ''
      }
      if (matched === 1 && found) return found
    }

    return ''
  }

  /**
   * 根据用户偏好获取显示名称
   */
  public getPreferredDisplayName(
    wxid: string,
    nickname: string,
    remark: string,
    groupNickname: string,
    preference: 'group-nickname' | 'remark' | 'nickname' = 'remark'
  ): string {
    switch (preference) {
      case 'group-nickname':
        return groupNickname || remark || nickname || wxid
      case 'remark':
        return remark || nickname || wxid
      case 'nickname':
        return nickname || wxid
      default:
        return nickname || wxid
    }
  }

  /**
   * 从转账消息 XML 中提取并解析 "谁转账给谁" 描述
   * @param content 原始消息内容 XML
   * @param myWxid 当前用户 wxid
   * @param groupNicknamesMap 群昵称映射
   * @param getContactName 联系人名称解析函数
   * @returns "A 转账给 B" 或 null
   */
  public async resolveTransferDesc(
    content: string,
    myWxid: string,
    groupNicknamesMap: Map<string, string>,
    getContactName: (username: string) => Promise<string>
  ): Promise<string | null> {
    const normalizedContent = normalizeAppMessageContent(content || '')
    if (!normalizedContent) return null

    const xmlType = this.extractXmlValue(normalizedContent, 'type')
    if (xmlType && xmlType !== '2000') return null

    const payerUsername = this.extractXmlValue(normalizedContent, 'payer_username')
    const receiverUsername = this.extractXmlValue(normalizedContent, 'receiver_username')
    if (!payerUsername || !receiverUsername) return null

    const cleanedMyWxid = myWxid ? cleanAccountDirName(myWxid) : ''

    const resolveName = async (username: string): Promise<string> => {
      // 当前用户自己
      if (myWxid && (username === myWxid || username === cleanedMyWxid)) {
        const groupNick = this.resolveGroupNicknameByCandidates(groupNicknamesMap, [username, myWxid, cleanedMyWxid])
        if (groupNick) return groupNick
        return '我'
      }
      // 群昵称
      const groupNick = this.resolveGroupNicknameByCandidates(groupNicknamesMap, [username])
      if (groupNick) return groupNick
      // 联系人名称
      return getContactName(username)
    }

    const [payerName, receiverName] = await Promise.all([
      resolveName(payerUsername),
      resolveName(receiverUsername)
    ])

    return `${payerName} 转账给 ${receiverName}`
  }

  public isSameWxid(lhs?: string, rhs?: string): boolean {
    const left = new Set(this.buildGroupNicknameIdCandidates([lhs]).map((id) => id.toLowerCase()))
    if (left.size === 0) return false
    const right = this.buildGroupNicknameIdCandidates([rhs]).map((id) => id.toLowerCase())
    return right.some((id) => left.has(id))
  }

  public getTransferPrefix(content: string, myWxid?: string, senderWxid?: string, isSend?: boolean): '[转账]' | '[转账收款]' {
    const normalizedContent = normalizeAppMessageContent(content || '')
    if (!normalizedContent) return '[转账]'

    const paySubtype = this.extractXmlValue(normalizedContent, 'paysubtype')
    // 转账消息在部分账号数据中 `payer_username` 可能为空，优先用 `paysubtype` 判定
    // 实测：1=发起侧，3=收款侧
    if (paySubtype === '3') return '[转账收款]'
    if (paySubtype === '1') return '[转账]'

    const payerUsername = this.extractXmlValue(normalizedContent, 'payer_username')
    const receiverUsername = this.extractXmlValue(normalizedContent, 'receiver_username')
    const senderIsPayer = senderWxid ? this.isSameWxid(senderWxid, payerUsername) : false
    const senderIsReceiver = senderWxid ? this.isSameWxid(senderWxid, receiverUsername) : false

    // 实测字段语义：sender 命中 receiver_username 为转账发起侧，命中 payer_username 为收款侧
    if (senderWxid) {
      if (senderIsReceiver && !senderIsPayer) return '[转账]'
      if (senderIsPayer && !senderIsReceiver) return '[转账收款]'
    }

    // 兜底：按当前账号角色判断
    if (myWxid) {
      if (this.isSameWxid(myWxid, receiverUsername)) return '[转账]'
      if (this.isSameWxid(myWxid, payerUsername)) return '[转账收款]'
    }

    return '[转账]'
  }

  public isTransferExportContent(content: string): boolean {
    return content.startsWith('[转账]') || content.startsWith('[转账收款]')
  }

  public appendTransferDesc(content: string, transferDesc: string): string {
    const prefix = content.startsWith('[转账收款]') ? '[转账收款]' : '[转账]'
    return content.replace(prefix, `${prefix} (${transferDesc})`)
  }

  public looksLikeBase64(s: string): boolean {
    if (s.length % 4 !== 0) return false
    return /^[A-Za-z0-9+/=]+$/.test(s)
  }

  /**
   * 解析消息内容为可读文本
   * 注意：语音消息在这里返回占位符，实际转文字在导出时异步处理
   */
  public parseMessageContent(
    content: string,
    localType: number,
    sessionId?: string,
    createTime?: number,
    myWxid?: string,
    senderWxid?: string,
    isSend?: boolean
  ): string | null {
    if (!content) return null

    // 检查 XML 中的 type 标签（支持大 localType 的情况）
    const xmlTypeMatch = /<type>(\d+)<\/type>/i.exec(content)
    const xmlType = xmlTypeMatch ? xmlTypeMatch[1] : null

    switch (localType) {
      case 1: // 文本
        return this.stripSenderPrefix(content)
      case 3: return '[图片]'
      case 34: {
        // 语音消息 - 尝试获取转写文字
        const transcriptGetter = (voiceTranscribeService as unknown as {
          getCachedTranscript?: (sessionId: string, createTime: number) => string | null | undefined
        }).getCachedTranscript

        if (sessionId && createTime && typeof transcriptGetter === 'function') {
          const transcript = transcriptGetter(sessionId, createTime)
          if (transcript) {
            return `[语音消息] ${transcript}`
          }
        }
        return '[语音消息]'  // 占位符，导出时会替换为转文字结果
      }
      case 42: return '[名片]'
      case 43: return '[视频]'
      case 47: return '[动画表情]'
      case 48: {
        const normalized48 = normalizeAppMessageContent(content)
        const locPoiname = this.extractXmlAttribute(normalized48, 'location', 'poiname') || this.extractXmlValue(normalized48, 'poiname') || this.extractXmlValue(normalized48, 'poiName')
        const locLabel = this.extractXmlAttribute(normalized48, 'location', 'label') || this.extractXmlValue(normalized48, 'label')
        const locLat = this.extractXmlAttribute(normalized48, 'location', 'x') || this.extractXmlAttribute(normalized48, 'location', 'latitude')
        const locLng = this.extractXmlAttribute(normalized48, 'location', 'y') || this.extractXmlAttribute(normalized48, 'location', 'longitude')
        const locParts: string[] = []
        if (locPoiname) locParts.push(locPoiname)
        if (locLabel && locLabel !== locPoiname) locParts.push(locLabel)
        if (locLat && locLng) locParts.push(`(${locLat},${locLng})`)
        return locParts.length > 0 ? `[位置] ${locParts.join(' ')}` : '[位置]'
      }
      case 49: {
        const title = this.extractXmlValue(content, 'title')
        const type = this.extractXmlValue(content, 'type')
        const songName = this.extractXmlValue(content, 'songname')

        // 转账消息特殊处理
        if (type === '2000') {
          const feedesc = this.extractXmlValue(content, 'feedesc')
          const payMemo = this.extractXmlValue(content, 'pay_memo')
          const transferPrefix = this.getTransferPrefix(content, myWxid, senderWxid, isSend)
          if (feedesc) {
            return payMemo ? `${transferPrefix} ${feedesc} ${payMemo}` : `${transferPrefix} ${feedesc}`
          }
          return transferPrefix
        }

        if (type === '3') return songName ? `[音乐] ${songName}` : (title ? `[音乐] ${title}` : '[音乐]')
        if (type === '6') return title ? `[文件] ${title}` : '[文件]'
        if (type === '19') return title ? `[聊天记录] ${title}` : '[聊天记录]'
        if (type === '33' || type === '36') return title ? `[小程序] ${title}` : '[小程序]'
        if (type === '57') return title || '[引用消息]'
        if (type === '5' || type === '49') return title ? `[链接] ${title}` : '[链接]'
        return title ? `[链接] ${title}` : '[链接]'
      }
      case 50: return this.parseVoipMessage(content)
      case 10000: return this.cleanSystemMessage(content)
      case 266287972401: return this.cleanSystemMessage(content)  // 拍一拍
      case 244813135921: {
        // 引用消息
        const title = this.extractXmlValue(content, 'title')
        return title || '[引用消息]'
      }
      default:
        // 对于未知的 localType，检查 XML type 来判断消息类型
        if (xmlType) {
          const title = this.extractXmlValue(content, 'title')

          // 群公告消息（type 87）
          if (xmlType === '87') {
            const textAnnouncement = this.extractXmlValue(content, 'textannouncement')
            if (textAnnouncement) {
              return `[群公告] ${textAnnouncement}`
            }
            return '[群公告]'
          }

          // 转账消息
          if (xmlType === '2000') {
            const feedesc = this.extractXmlValue(content, 'feedesc')
            const payMemo = this.extractXmlValue(content, 'pay_memo')
            const transferPrefix = this.getTransferPrefix(content, myWxid, senderWxid, isSend)
            if (feedesc) {
              return payMemo ? `${transferPrefix} ${feedesc} ${payMemo}` : `${transferPrefix} ${feedesc}`
            }
            return transferPrefix
          }

          // 其他类型
          if (xmlType === '3') return title ? `[音乐] ${title}` : '[音乐]'
          if (xmlType === '6') return title ? `[文件] ${title}` : '[文件]'
          if (xmlType === '19') return title ? `[聊天记录] ${title}` : '[聊天记录]'
          if (xmlType === '33' || xmlType === '36') return title ? `[小程序] ${title}` : '[小程序]'
          if (xmlType === '57') return title || '[引用消息]'
          if (xmlType === '5' || xmlType === '49') return title ? `[链接] ${title}` : '[链接]'

          // 有 title 就返回 title
          if (title) return title
        }

        // 最后尝试提取文本内容
        return this.stripSenderPrefix(content) || null
    }
  }

  public formatPlainExportContent(
    content: string,
    localType: number,
    options: { exportVoiceAsText?: boolean },
    voiceTranscript?: string,
    myWxid?: string,
    senderWxid?: string,
    isSend?: boolean
  ): string {
    const safeContent = content || ''

    if (localType === 3) return '[图片]'
    if (localType === 1) return this.stripSenderPrefix(safeContent)
    if (localType === 34) {
      if (options.exportVoiceAsText) {
        return voiceTranscript || '[语音消息 - 转文字失败]'
      }
      return '[其他消息]'
    }
    if (localType === 42) {
      const normalized = normalizeAppMessageContent(safeContent)
      const nickname =
        this.extractXmlValue(normalized, 'nickname') ||
        this.extractXmlValue(normalized, 'displayname') ||
        this.extractXmlValue(normalized, 'name')
      return nickname ? `[名片]${nickname}` : '[名片]'
    }
    if (localType === 43) {
      const normalized = normalizeAppMessageContent(safeContent)
      const lengthValue =
        this.extractXmlValue(normalized, 'playlength') ||
        this.extractXmlValue(normalized, 'playLength') ||
        this.extractXmlValue(normalized, 'length') ||
        this.extractXmlValue(normalized, 'duration')
      const seconds = lengthValue ? this.parseDurationSeconds(lengthValue) : null
      return seconds ? `[视频]${seconds}s` : '[视频]'
    }
    if (localType === 48) {
      const normalized = normalizeAppMessageContent(safeContent)
      const locPoiname = this.extractXmlAttribute(normalized, 'location', 'poiname') || this.extractXmlValue(normalized, 'poiname') || this.extractXmlValue(normalized, 'poiName')
      const locLabel = this.extractXmlAttribute(normalized, 'location', 'label') || this.extractXmlValue(normalized, 'label')
      const locLat = this.extractXmlAttribute(normalized, 'location', 'x') || this.extractXmlAttribute(normalized, 'location', 'latitude')
      const locLng = this.extractXmlAttribute(normalized, 'location', 'y') || this.extractXmlAttribute(normalized, 'location', 'longitude')
      const locParts: string[] = []
      if (locPoiname) locParts.push(locPoiname)
      if (locLabel && locLabel !== locPoiname) locParts.push(locLabel)
      if (locLat && locLng) locParts.push(`(${locLat},${locLng})`)
      return locParts.length > 0 ? `[位置] ${locParts.join(' ')}` : '[位置]'
    }
    if (localType === 50) {
      return this.parseVoipMessage(safeContent)
    }
    if (localType === 10000 || localType === 266287972401) {
      return this.cleanSystemMessage(safeContent)
    }

    const normalized = normalizeAppMessageContent(safeContent)
    const isAppMessage = normalized.includes('<appmsg') || normalized.includes('<msg>')
    if (localType === 49 || isAppMessage) {
      const typeMatch = /<type>(\d+)<\/type>/i.exec(normalized)
      const subType = typeMatch ? parseInt(typeMatch[1], 10) : 0
      const title = this.extractXmlValue(normalized, 'title') || this.extractXmlValue(normalized, 'appname')

      // 群公告消息（type 87）
      if (subType === 87) {
        const textAnnouncement = this.extractXmlValue(normalized, 'textannouncement')
        if (textAnnouncement) {
          return `[群公告]${textAnnouncement}`
        }
        return '[群公告]'
      }

      // 转账消息特殊处理
      if (subType === 2000 || title.includes('转账') || normalized.includes('transfer')) {
        const feedesc = this.extractXmlValue(normalized, 'feedesc')
        const payMemo = this.extractXmlValue(normalized, 'pay_memo')
        const transferPrefix = this.getTransferPrefix(normalized, myWxid, senderWxid, isSend)
        if (feedesc) {
          return payMemo ? `${transferPrefix}${feedesc} ${payMemo}` : `${transferPrefix}${feedesc}`
        }
        const amount = this.extractAmountFromText(
          [
            title,
            this.extractXmlValue(normalized, 'des'),
            this.extractXmlValue(normalized, 'money'),
            this.extractXmlValue(normalized, 'amount'),
            this.extractXmlValue(normalized, 'fee')
          ]
            .filter(Boolean)
            .join(' ')
        )
        return amount ? `${transferPrefix}${amount}` : transferPrefix
      }

      if (subType === 3 || normalized.includes('<musicurl') || normalized.includes('<songname')) {
        const songName = this.extractXmlValue(normalized, 'songname') || title || '音乐'
        return `[音乐]${songName}`
      }
      if (subType === 6) {
        const fileName = this.extractXmlValue(normalized, 'filename') || title || '文件'
        return `[文件]${fileName}`
      }
      if (title.includes('红包') || normalized.includes('hongbao')) {
        return `[红包]${title || '微信红包'}`
      }
      if (subType === 19 || normalized.includes('<recorditem')) {
        const forwardName =
          this.extractXmlValue(normalized, 'nickname') ||
          this.extractXmlValue(normalized, 'title') ||
          this.extractXmlValue(normalized, 'des') ||
          this.extractXmlValue(normalized, 'displayname')
        return forwardName ? `[转发的聊天记录]${forwardName}` : '[转发的聊天记录]'
      }
      if (subType === 33 || subType === 36) {
        const appName = this.extractXmlValue(normalized, 'appname') || title || '小程序'
        return `[小程序]${appName}`
      }
      if (subType === 57) {
        return title || '[引用消息]'
      }
      if (title) {
        return `[链接]${title}`
      }
      return '[其他消息]'
    }

    return '[其他消息]'
  }

  public parseDurationSeconds(value: string): number | null {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return null
    if (numeric >= 1000) return Math.round(numeric / 1000)
    return Math.round(numeric)
  }

  public extractAmountFromText(text: string): string | null {
    if (!text) return null
    const match = /([¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?)/.exec(text)
    return match ? match[1].replace(/\s+/g, '') : null
  }

  public stripSenderPrefix(content: string): string {
    return content.replace(/^[\s]*([a-zA-Z0-9_-]+):(?!\/\/)/, '')
  }

  public getWeCloneTypeName(localType: number, content: string): string {
    if (localType === 1) return 'text'
    if (localType === 3) return 'image'
    if (localType === 47) return 'sticker'
    if (localType === 43) return 'video'
    if (localType === 34) return 'voice'
    if (localType === 48) return 'location'
    if (localType === 49) {
      const xmlType = this.extractXmlValue(content || '', 'type')
      if (xmlType === '6') return 'file'
      return 'text'
    }
    return 'text'
  }

  public getWeCloneSource(msg: any, typeName: string, mediaItem: MediaExportItem | null): string {
    if (mediaItem?.relativePath) {
      return mediaItem.relativePath
    }

    if (typeName === 'image') {
      return msg.imageDatName || ''
    }
    if (typeName === 'sticker') {
      return msg.emojiCdnUrl || ''
    }
    if (typeName === 'video') {
      return ''
    }
    if (typeName === 'file') {
      const xml = msg.content || ''
      return this.extractXmlValue(xml, 'filename') || this.extractXmlValue(xml, 'title') || ''
    }
    return ''
  }

  /**
   * 从撤回消息内容中提取撤回者的 wxid
   * 撤回消息 XML 格式通常包含 <session> 或 <newmsgid> 等字段
   * 以及撤回者的 wxid 在某些字段中
   * @returns { isRevoke: true, isSelfRevoke: true } - 是自己撤回的消息
   * @returns { isRevoke: true, revokerWxid: string } - 是别人撤回的消息，提取到撤回者
   * @returns { isRevoke: false } - 不是撤回消息
   */
  public extractRevokerInfo(content: string): { isRevoke: boolean; isSelfRevoke?: boolean; revokerWxid?: string } {
    if (!content) return { isRevoke: false }

    if (!content.includes('revokemsg') && !content.includes('撤回')) {
      return { isRevoke: false }
    }

    if (content.includes('你撤回')) {
      return { isRevoke: true, isSelfRevoke: true }
    }

    const sessionMatch = /<session>([^<]+)<\/session>/i.exec(content)
    if (sessionMatch) {
      const session = sessionMatch[1].trim()
      if (session.startsWith('wxid_') || /^[a-zA-Z][a-zA-Z0-9_-]+$/.test(session)) {
        return { isRevoke: true, revokerWxid: session }
      }
    }

    const fromUserMatch = /<fromusername>([^<]+)<\/fromusername>/i.exec(content)
    if (fromUserMatch) {
      return { isRevoke: true, revokerWxid: fromUserMatch[1].trim() }
    }

    return { isRevoke: true }
  }

  public extractXmlValue(xml: string, tagName: string): string {
    const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\/${tagName}>`, 'i')
    const match = regex.exec(xml)
    if (match) {
      return match[1].replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim()
    }
    return ''
  }

  public extractXmlAttribute(xml: string, tagName: string, attrName: string): string {
    const tagRegex = new RegExp(`<${tagName}\\s+[^>]*${attrName}\\s*=\\s*"([^"]*)"`, 'i')
    const match = tagRegex.exec(xml)
    return match ? match[1] : ''
  }

  public cleanSystemMessage(content: string): string {
    if (!content) return '[系统消息]'

    const sysmsgTextMatch = /<sysmsg[^>]*>([\s\S]*?)<\/sysmsg>/i.exec(content)
    if (sysmsgTextMatch) {
      content = sysmsgTextMatch[1]
    }

    const revokeMatch = /<replacemsg><!\[CDATA\[(.*?)\]\]><\/replacemsg>/i.exec(content)
    if (revokeMatch) {
      return revokeMatch[1].trim()
    }

    const patMatch = /<template><!\[CDATA\[(.*?)\]\]><\/template>/i.exec(content)
    if (patMatch) {
      return patMatch[1]
        .replace(/\$\{([^}]+)\}/g, (_, varName) => {
          const varMatch = new RegExp(`<${varName}><!\\\\\[CDATA\\\\\[([^\]]*)\\\\\]\\\\\]><\/${varName}>`, 'i').exec(content)
          return varMatch ? varMatch[1] : ''
        })
        .replace(/<[^>]+>/g, '')
        .trim()
    }

    const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(content)
    if (titleMatch) {
      const title = titleMatch[1].replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim()
      if (title) {
        return title
      }
    }

    content = content.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')

    return content
      .replace(/<img[^>]*>/gi, '')
      .replace(/<\/?[a-zA-Z0-9_:]+[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim() || '[系统消息]'
  }

  /**
   * 解析通话消息
   * 格式: <voipmsg type="VoIPBubbleMsg"><VoIPBubbleMsg><msg><![CDATA[...]]></msg><room_type>0/1</room_type>...</VoIPBubbleMsg></voipmsg>
   * room_type: 0 = 语音通话, 1 = 视频通话
   */
  public parseVoipMessage(content: string): string {
    try {
      if (!content) return '[通话]'

      const msgMatch = /<msg><!\[CDATA\[(.*?)\]\]><\/msg>/i.exec(content)
      const msg = msgMatch?.[1]?.trim() || ''

      const roomTypeMatch = /<room_type>(\d+)<\/room_type>/i.exec(content)
      const roomType = roomTypeMatch ? parseInt(roomTypeMatch[1], 10) : -1

      let callType: string
      if (roomType === 0) {
        callType = '视频通话'
      } else if (roomType === 1) {
        callType = '语音通话'
      } else {
        callType = '通话'
      }

      if (msg.includes('通话时长')) {
        const durationMatch = /通话时长\s*(\d{1,2}:\d{2}(?::\d{2})?)/i.exec(msg)
        const duration = durationMatch?.[1] || ''
        if (duration) {
          return `[${callType}] ${duration}`
        }
        return `[${callType}] 已接听`
      } else if (msg.includes('对方无应答')) {
        return `[${callType}] 对方无应答`
      } else if (msg.includes('已取消')) {
        return `[${callType}] 已取消`
      } else if (msg.includes('已在其它设备接听') || msg.includes('已在其他设备接听')) {
        return `[${callType}] 已在其他设备接听`
      } else if (msg.includes('对方已拒绝') || msg.includes('已拒绝')) {
        return `[${callType}] 对方已拒绝`
      } else if (msg.includes('忙线未接听') || msg.includes('忙线')) {
        return `[${callType}] 忙线未接听`
      } else if (msg.includes('未接听')) {
        return `[${callType}] 未接听`
      } else if (msg) {
        return `[${callType}] ${msg}`
      }

      return `[${callType}]`
    } catch {
      return '[通话]'
    }
  }

  /**
   * 获取消息类型名称
   */
  public getMessageTypeName(localType: number, content?: string): string {
    if (content) {
      const xmlTypeMatch = /<type>(\d+)<\/type>/i.exec(content)
      const xmlType = xmlTypeMatch ? xmlTypeMatch[1] : null

      if (xmlType) {
        switch (xmlType) {
          case '3': return '音乐消息'
          case '87': return '群公告'
          case '2000': return '转账消息'
          case '5': return '链接消息'
          case '6': return '文件消息'
          case '19': return '聊天记录'
          case '33':
          case '36': return '小程序消息'
          case '57': return '引用消息'
        }
      }
    }

    const typeNames: Record<number, string> = {
      1: '文本消息',
      3: '图片消息',
      34: '语音消息',
      42: '名片消息',
      43: '视频消息',
      47: '动画表情',
      48: '位置消息',
      49: '链接消息',
      50: '通话消息',
      10000: '系统消息',
      244813135921: '引用消息'
    }
    return typeNames[localType] || '其他消息'
  }

  /**
   * 格式化时间戳为可读字符串
   */
  public formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp * 1000)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  }

  public normalizeTxtColumns(columns?: string[] | null): string[] {
    const fallback = ['index', 'time', 'senderRole', 'messageType', 'content']
    const selected = new Set((columns && columns.length > 0 ? columns : fallback).filter(Boolean))
    const ordered = TXT_COLUMN_DEFINITIONS.map((col) => col.id).filter((id) => selected.has(id))
    return ordered.length > 0 ? ordered : fallback
  }

  public loadExportHtmlStyles(): string {
    if (this.htmlStyleCache !== null) {
      return this.htmlStyleCache
    }
    const candidates = [
      path.join(__dirname, 'exportHtml.css'),
      path.join(process.cwd(), 'electron', 'services', 'exportHtml.css')
    ]
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8')
          if (content.trim().length > 0) {
            this.htmlStyleCache = content
            return content
          }
        } catch {
          continue
        }
      }
    }
    this.htmlStyleCache = EXPORT_HTML_STYLES
    return this.htmlStyleCache
  }

  /**
   * 解析合并转发的聊天记录 (Type 19)
   */
  public parseChatHistory(content: string): ParsedChatRecordItem[] | undefined {
    return parseChatRecordList(content)
  }

  public extractAppMessageType(content: string): string {
    if (!content) return ''
    const appmsgMatch = /<appmsg[\s\S]*?>([\s\S]*?)<\/appmsg>/i.exec(content)
    if (appmsgMatch) {
      const appmsgInner = appmsgMatch[1]
        .replace(/<refermsg[\s\S]*?<\/refermsg>/gi, '')
        .replace(/<patMsg[\s\S]*?<\/patMsg>/gi, '')
      const typeMatch = /<type>([\s\S]*?)<\/type>/i.exec(appmsgInner)
      if (typeMatch) return typeMatch[1].trim()
    }
    return this.extractXmlValue(content, 'type')
  }

  public looksLikeWxid(text: string): boolean {
    if (!text) return false
    const trimmed = text.trim().toLowerCase()
    if (trimmed.startsWith('wxid_')) return true
    return /^wx[a-z0-9_-]{4,}$/.test(trimmed)
  }

  public sanitizeQuotedContent(content: string): string {
    if (!content) return ''
    let result = content
    result = result.replace(/wxid_[A-Za-z0-9_-]{3,}/g, '')
    result = result.replace(/^[\s:：\-]+/, '')
    result = result.replace(/[:：]{2,}/g, ':')
    result = result.replace(/^[\s:：\-]+/, '')
    result = result.replace(/\s+/g, ' ').trim()
    return result
  }

  public parseQuoteMessage(content: string): { content?: string; sender?: string; type?: string } {
    try {
      const normalized = normalizeAppMessageContent(content || '')
      const referMsgStart = normalized.indexOf('<refermsg>')
      const referMsgEnd = normalized.indexOf('</refermsg>')
      if (referMsgStart === -1 || referMsgEnd === -1) {
        return {}
      }

      const referMsgXml = normalized.substring(referMsgStart, referMsgEnd + 11)
      let sender = this.extractXmlValue(referMsgXml, 'displayname')
      if (sender && this.looksLikeWxid(sender)) {
        sender = ''
      }

      const referContent = this.extractXmlValue(referMsgXml, 'content')
      const referType = this.extractXmlValue(referMsgXml, 'type')
      let displayContent = referContent

      switch (referType) {
        case '1':
          displayContent = this.sanitizeQuotedContent(referContent)
          break
        case '3':
          displayContent = '[图片]'
          break
        case '34':
          displayContent = '[语音]'
          break
        case '43':
          displayContent = '[视频]'
          break
        case '47':
          displayContent = '[动画表情]'
          break
        case '49':
          displayContent = '[链接]'
          break
        case '42':
          displayContent = '[名片]'
          break
        case '48':
          displayContent = '[位置]'
          break
        default:
          if (!referContent || referContent.includes('wxid_')) {
            displayContent = '[消息]'
          } else {
            displayContent = this.sanitizeQuotedContent(referContent)
          }
      }

      return {
        content: displayContent || undefined,
        sender: sender || undefined,
        type: referType || undefined
      }
    } catch {
      return {}
    }
  }

  public extractArkmeAppMessageMeta(content: string, localType: number): Record<string, any> | null {
    if (!content) return null

    const normalized = normalizeAppMessageContent(content)
    const looksLikeAppMsg =
      localType === 49 ||
      localType === 244813135921 ||
      normalized.includes('<appmsg') ||
      normalized.includes('<msg>')
    const hasReferMsg = normalized.includes('<refermsg>')
    const xmlType = this.extractAppMessageType(normalized)
    const isFinder =
      xmlType === '51' ||
      normalized.includes('<finder') ||
      normalized.includes('finderusername') ||
      normalized.includes('finderobjectid')
    const isMusic =
      xmlType === '3' ||
      normalized.includes('<musicurl') ||
      normalized.includes('<playurl>') ||
      normalized.includes('<dataurl>')

    if (!looksLikeAppMsg && !isFinder && !hasReferMsg) return null

    let appMsgKind: string | undefined
    if (isFinder) {
      appMsgKind = 'finder'
    } else if (xmlType === '2001') {
      appMsgKind = 'red-packet'
    } else if (isMusic) {
      appMsgKind = 'music'
    } else if (xmlType === '33' || xmlType === '36') {
      appMsgKind = 'miniapp'
    } else if (xmlType === '6') {
      appMsgKind = 'file'
    } else if (xmlType === '19') {
      appMsgKind = 'chat-record'
    } else if (xmlType === '2000') {
      appMsgKind = 'transfer'
    } else if (xmlType === '87') {
      appMsgKind = 'announcement'
    } else if (xmlType === '57' || hasReferMsg || localType === 244813135921) {
      appMsgKind = 'quote'
    } else if (xmlType === '5' || xmlType === '49') {
      appMsgKind = 'link'
    } else if (looksLikeAppMsg) {
      appMsgKind = 'card'
    }

    const meta: Record<string, any> = {}
    if (xmlType) meta.appMsgType = xmlType
    else if (appMsgKind === 'quote') meta.appMsgType = '57'
    if (appMsgKind) meta.appMsgKind = appMsgKind

    if (appMsgKind === 'quote') {
      const quoteInfo = this.parseQuoteMessage(normalized)
      if (quoteInfo.content) meta.quotedContent = quoteInfo.content
      if (quoteInfo.sender) meta.quotedSender = quoteInfo.sender
      if (quoteInfo.type) meta.quotedType = quoteInfo.type
    }

    if (isMusic) {
      const musicTitle =
        this.extractXmlValue(normalized, 'songname') ||
        this.extractXmlValue(normalized, 'title')
      const musicUrl =
        this.extractXmlValue(normalized, 'musicurl') ||
        this.extractXmlValue(normalized, 'playurl') ||
        this.extractXmlValue(normalized, 'songalbumurl')
      const musicDataUrl =
        this.extractXmlValue(normalized, 'dataurl') ||
        this.extractXmlValue(normalized, 'lowurl')
      const musicAlbumUrl = this.extractXmlValue(normalized, 'songalbumurl')
      const musicCoverUrl =
        this.extractXmlValue(normalized, 'thumburl') ||
        this.extractXmlValue(normalized, 'cdnthumburl') ||
        this.extractXmlValue(normalized, 'coverurl') ||
        this.extractXmlValue(normalized, 'cover')
      const musicSinger =
        this.extractXmlValue(normalized, 'singername') ||
        this.extractXmlValue(normalized, 'artist') ||
        this.extractXmlValue(normalized, 'albumartist')
      const musicAppName = this.extractXmlValue(normalized, 'appname')
      const musicSourceName = this.extractXmlValue(normalized, 'sourcename')
      const durationRaw =
        this.extractXmlValue(normalized, 'playlength') ||
        this.extractXmlValue(normalized, 'play_length') ||
        this.extractXmlValue(normalized, 'duration')
      const musicDuration = durationRaw ? this.parseDurationSeconds(durationRaw) : null

      if (musicTitle) meta.musicTitle = musicTitle
      if (musicUrl) meta.musicUrl = musicUrl
      if (musicDataUrl) meta.musicDataUrl = musicDataUrl
      if (musicAlbumUrl) meta.musicAlbumUrl = musicAlbumUrl
      if (musicCoverUrl) meta.musicCoverUrl = musicCoverUrl
      if (musicSinger) meta.musicSinger = musicSinger
      if (musicAppName) meta.musicAppName = musicAppName
      if (musicSourceName) meta.musicSourceName = musicSourceName
      if (musicDuration != null) meta.musicDuration = musicDuration
    }

    if (!isFinder) {
      return Object.keys(meta).length > 0 ? meta : null
    }

    const rawTitle = this.extractXmlValue(normalized, 'title')
    const finderFeedDesc = extractFinderFeedDesc(normalized)
    const finderTitle = (!rawTitle || rawTitle.includes('不支持')) ? finderFeedDesc : rawTitle
    const finderDesc = this.extractXmlValue(normalized, 'des') || this.extractXmlValue(normalized, 'desc')
    const finderUsername =
      this.extractXmlValue(normalized, 'finderusername') ||
      this.extractXmlValue(normalized, 'finder_username') ||
      this.extractXmlValue(normalized, 'finderuser')
    const finderNickname =
      this.extractXmlValue(normalized, 'findernickname') ||
      this.extractXmlValue(normalized, 'finder_nickname')
    const finderCoverUrl =
      this.extractXmlValue(normalized, 'thumbUrl') ||
      this.extractXmlValue(normalized, 'coverUrl') ||
      this.extractXmlValue(normalized, 'thumburl') ||
      this.extractXmlValue(normalized, 'coverurl')
    const finderAvatar = this.extractXmlValue(normalized, 'avatar')
    const durationRaw = this.extractXmlValue(normalized, 'videoPlayDuration') || this.extractXmlValue(normalized, 'duration')
    const finderDuration = durationRaw ? this.parseDurationSeconds(durationRaw) : null
    const finderObjectId =
      this.extractXmlValue(normalized, 'finderobjectid') ||
      this.extractXmlValue(normalized, 'finder_objectid') ||
      this.extractXmlValue(normalized, 'objectid') ||
      this.extractXmlValue(normalized, 'object_id')
    const finderUrl =
      this.extractXmlValue(normalized, 'url') ||
      this.extractXmlValue(normalized, 'shareurl')

    if (finderTitle) meta.finderTitle = finderTitle
    if (finderDesc) meta.finderDesc = finderDesc
    if (finderUsername) meta.finderUsername = finderUsername
    if (finderNickname) meta.finderNickname = finderNickname
    if (finderCoverUrl) meta.finderCoverUrl = finderCoverUrl
    if (finderAvatar) meta.finderAvatar = finderAvatar
    if (finderDuration != null) meta.finderDuration = finderDuration
    if (finderObjectId) meta.finderObjectId = finderObjectId
    if (finderUrl) meta.finderUrl = finderUrl

    return Object.keys(meta).length > 0 ? meta : null
  }

  public extractArkmeContactCardMeta(content: string, localType: number): Record<string, any> | null {
    if (!content || localType !== 42) return null

    const normalized = normalizeAppMessageContent(content)
    const readAttr = (attrName: string): string =>
      this.extractXmlAttribute(normalized, 'msg', attrName) || this.extractXmlValue(normalized, attrName)

    const contactCardWxid =
      readAttr('username') ||
      readAttr('encryptusername') ||
      readAttr('encrypt_user_name')
    const contactCardNickname = readAttr('nickname')
    const contactCardAlias = readAttr('alias')
    const contactCardRemark = readAttr('remark')
    const contactCardProvince = readAttr('province')
    const contactCardCity = readAttr('city')
    const contactCardSignature = readAttr('sign') || readAttr('signature')
    const contactCardAvatar =
      readAttr('smallheadimgurl') ||
      readAttr('bigheadimgurl') ||
      readAttr('headimgurl') ||
      readAttr('avatar')
    const sexRaw = readAttr('sex')
    const contactCardGender = sexRaw ? parseInt(sexRaw, 10) : NaN

    const meta: Record<string, any> = {
      cardKind: 'contact-card'
    }
    if (contactCardWxid) meta.contactCardWxid = contactCardWxid
    if (contactCardNickname) meta.contactCardNickname = contactCardNickname
    if (contactCardAlias) meta.contactCardAlias = contactCardAlias
    if (contactCardRemark) meta.contactCardRemark = contactCardRemark
    if (contactCardProvince) meta.contactCardProvince = contactCardProvince
    if (contactCardCity) meta.contactCardCity = contactCardCity
    if (contactCardSignature) meta.contactCardSignature = contactCardSignature
    if (contactCardAvatar) meta.contactCardAvatar = contactCardAvatar
    if (Number.isFinite(contactCardGender) && contactCardGender >= 0) {
      meta.contactCardGender = contactCardGender
    }

    return Object.keys(meta).length > 0 ? meta : null
  }

  public getInlineEmojiDataUrl(name: string): string | null {
    if (!name) return null
    const cached = this.inlineEmojiCache.get(name)
    if (cached) return cached
    const emojiPath = resolveWechatEmojiPath(name)
    if (!emojiPath) return null
    const baseDir = path.dirname(require.resolve('wechat-emojis'))
    const absolutePath = path.join(baseDir, emojiPath)
    if (!fs.existsSync(absolutePath)) return null
    try {
      const buffer = fs.readFileSync(absolutePath)
      const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`
      this.inlineEmojiCache.set(name, dataUrl)
      return dataUrl
    } catch {
      return null
    }
  }

  public renderTextWithEmoji(text: string): string {
    if (!text) return ''
    const parts = text.split(/\[(.*?)\]/g)
    const rendered = parts.map((part, index) => {
      if (index % 2 === 1) {
        const emojiDataUrl = this.getInlineEmojiDataUrl(part)
        if (emojiDataUrl) {
          // Cache full <img> tag to avoid re-escaping data URL every time
          const escapedName = escapeAttribute(part)
          return `<img class="inline-emoji" src="${emojiDataUrl}" alt="[${escapedName}]" />`
        }
        return escapeHtml(`[${part}]`)
      }
      return escapeHtml(part)
    })
    return rendered.join('')
  }

  public formatHtmlMessageText(content: string, localType: number, myWxid?: string, senderWxid?: string, isSend?: boolean): string {
    if (!content) return ''

    if (localType === 1) {
      return this.stripSenderPrefix(content)
    }

    if (localType === 34) {
      return this.parseMessageContent(content, localType, undefined, undefined, myWxid, senderWxid, isSend) || ''
    }

    return this.formatPlainExportContent(content, localType, { exportVoiceAsText: false }, undefined, myWxid, senderWxid, isSend)
  }

  public extractHtmlLinkCard(content: string, localType: number): { title: string; url: string } | null {
    if (!content) return null

    const normalized = normalizeAppMessageContent(content)
    const isAppMessage = localType === 49 || normalized.includes('<appmsg') || normalized.includes('<msg>')
    if (!isAppMessage) return null

    const subType = this.extractXmlValue(normalized, 'type')
    if (subType && subType !== '5' && subType !== '49') return null

    const url = this.normalizeHtmlLinkUrl(this.extractXmlValue(normalized, 'url'))
    if (!url) return null

    const title = this.extractXmlValue(normalized, 'title') || this.extractXmlValue(normalized, 'des') || url
    return { title, url }
  }

  public normalizeHtmlLinkUrl(rawUrl: string): string {
    const value = (rawUrl || '').trim()
    if (!value) return ''

    const parseHttpUrl = (candidate: string): string => {
      try {
        const parsed = new URL(candidate)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return parsed.toString()
        }
      } catch {
        return ''
      }
      return ''
    }

    if (value.startsWith('//')) {
      return parseHttpUrl(`https:${value}`)
    }

    const direct = parseHttpUrl(value)
    if (direct) return direct

    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
    const isDomainLike = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:[/:?#].*)?$/.test(value)
    if (!hasScheme && isDomainLike) {
      return parseHttpUrl(`https://${value}`)
    }

    return ''
  }

}
