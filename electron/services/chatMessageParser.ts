import * as fzstd from 'fzstd'
import { parseChatRecordList, type ParsedChatRecordItem } from '../utils/chatRecordParser'
import { createElectronLogger } from '../utils/debug'

const logger = createElectronLogger('ChatMessageParser')

type ChatRecordListItem = ParsedChatRecordItem

export class ChatMessageParser {
  public getRowField(row: Record<string, any>, keys: string[]): any {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null) return row[key]
    }
    const lowerMap = new Map<string, string>()
    for (const actual of Object.keys(row)) {
      lowerMap.set(actual.toLowerCase(), actual)
    }
    for (const key of keys) {
      const actual = lowerMap.get(key.toLowerCase())
      if (actual && row[actual] !== undefined && row[actual] !== null) {
        return row[actual]
      }
    }
    return undefined
  }

  public parseEmojiInfo(content: string): { cdnUrl?: string; md5?: string; thumbUrl?: string; encryptUrl?: string; aesKey?: string } {
    try {
      // 提取 cdnurl
      let cdnUrl: string | undefined
      const cdnUrlMatch = /cdnurl\s*=\s*['"]([^'"]+)['"]/i.exec(content) || /cdnurl\s*=\s*([^'"]+?)(?=\s|\/|>)/i.exec(content)
      if (cdnUrlMatch) {
        cdnUrl = cdnUrlMatch[1].replace(/&amp;/g, '&')
        if (cdnUrl.includes('%')) {
          try {
            cdnUrl = decodeURIComponent(cdnUrl)
          } catch { }
        }
      }

      // 提取 thumburl
      let thumbUrl: string | undefined
      const thumbUrlMatch = /thumburl\s*=\s*['"]([^'"]+)['"]/i.exec(content) || /thumburl\s*=\s*([^'"]+?)(?=\s|\/|>)/i.exec(content)
      if (thumbUrlMatch) {
        thumbUrl = thumbUrlMatch[1].replace(/&amp;/g, '&')
        if (thumbUrl.includes('%')) {
          try {
            thumbUrl = decodeURIComponent(thumbUrl)
          } catch { }
        }
      }

      // 提取 md5
      const md5Match = /md5\s*=\s*['"]([a-fA-F0-9]+)['"]/i.exec(content) || /md5\s*=\s*([a-fA-F0-9]+)/i.exec(content)
      const md5 = md5Match ? md5Match[1] : undefined

      // 提取 encrypturl
      let encryptUrl: string | undefined
      const encryptUrlMatch = /encrypturl\s*=\s*['"]([^'"]+)['"]/i.exec(content) || /encrypturl\s*=\s*([^'"]+?)(?=\s|\/|>)/i.exec(content)
      if (encryptUrlMatch) {
        encryptUrl = encryptUrlMatch[1].replace(/&amp;/g, '&')
        if (encryptUrl.includes('%')) {
          try {
            encryptUrl = decodeURIComponent(encryptUrl)
          } catch { }
        }
      }

      // 提取 aeskey
      const aesKeyMatch = /aeskey\s*=\s*['"]([a-zA-Z0-9]+)['"]/i.exec(content) || /aeskey\s*=\s*([a-zA-Z0-9]+)/i.exec(content)
      const aesKey = aesKeyMatch ? aesKeyMatch[1] : undefined

      return { cdnUrl, md5, thumbUrl, encryptUrl, aesKey }
    } catch (e) {
      logger.error('[ChatService] 表情包解析失败:', e, { xml: content })
      return {}
    }
  }

  /**
   * 解析图片信息
   */
  public parseImageInfo(content: string): { md5?: string; aesKey?: string; encrypVer?: number; cdnThumbUrl?: string } {
    try {
      const md5 =
        this.extractXmlValue(content, 'md5') ||
        this.extractXmlAttribute(content, 'img', 'md5') ||
        undefined
      const aesKey = this.extractXmlAttribute(content, 'img', 'aeskey') || undefined
      const encrypVerStr = this.extractXmlAttribute(content, 'img', 'encrypver') || undefined
      const cdnThumbUrl = this.extractXmlAttribute(content, 'img', 'cdnthumburl') || undefined

      return {
        md5,
        aesKey,
        encrypVer: encrypVerStr ? parseInt(encrypVerStr, 10) : undefined,
        cdnThumbUrl
      }
    } catch {
      return {}
    }
  }

  /**
   * 解析视频MD5
   * 注意：提取 md5 字段用于查询 hardlink.db，获取实际视频文件名
   */
  public parseVideoMd5(content: string): string | undefined {
    if (!content) return undefined

    try {
      // 优先取 md5 属性（收到的视频）
      const md5 = this.extractXmlAttribute(content, 'videomsg', 'md5')
      if (md5) return md5.toLowerCase()

      // 自己发的视频没有 md5，只有 rawmd5
      const rawMd5 = this.extractXmlAttribute(content, 'videomsg', 'rawmd5')
      if (rawMd5) return rawMd5.toLowerCase()

      // 兜底：<md5> 标签
      const tagMd5 = this.extractXmlValue(content, 'md5')
      if (tagMd5) return tagMd5.toLowerCase()

      return undefined
    } catch {
      return undefined
    }
  }

  /**
   * 解析通话消息
   * 格式: <voipmsg type="VoIPBubbleMsg"><VoIPBubbleMsg><msg><![CDATA[...]]></msg><room_type>0/1</room_type>...</VoIPBubbleMsg></voipmsg>
   * room_type: 0 = 语音通话, 1 = 视频通话
   * msg 状态: 通话时长 XX:XX, 对方无应答, 已取消, 已在其它设备接听, 对方已拒绝 等
   */
  public parseVoipMessage(content: string): string {
    try {
      if (!content) return '[通话]'

      // 提取 msg 内容（中文通话状态）
      const msgMatch = /<msg><!\[CDATA\[(.*?)\]\]><\/msg>/i.exec(content)
      const msg = msgMatch?.[1]?.trim() || ''

      // 提取 room_type（0=视频，1=语音）
      const roomTypeMatch = /<room_type>(\d+)<\/room_type>/i.exec(content)
      const roomType = roomTypeMatch ? parseInt(roomTypeMatch[1], 10) : -1

      // 构建通话类型标签
      let callType: string
      if (roomType === 0) {
        callType = '视频通话'
      } else if (roomType === 1) {
        callType = '语音通话'
      } else {
        callType = '通话'
      }

      // 解析通话状态
      if (msg.includes('通话时长')) {
        // 已接听的通话，提取时长
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
        // 其他状态直接使用 msg 内容
        return `[${callType}] ${msg}`
      }

      return `[${callType}]`
    } catch (e) {
      logger.error('[ChatService] Failed to parse VOIP message:', e)
      return '[通话]'
    }
  }

  public parseImageDatNameFromRow(row: Record<string, any>): string | undefined {
    const packed = this.getRowField(row, [
      'packed_info_data',
      'packed_info',
      'packedInfoData',
      'packedInfo',
      'PackedInfoData',
      'PackedInfo',
      'WCDB_CT_packed_info_data',
      'WCDB_CT_packed_info',
      'WCDB_CT_PackedInfoData',
      'WCDB_CT_PackedInfo'
    ])
    const buffer = this.decodePackedInfo(packed)
    if (!buffer || buffer.length === 0) return undefined
    const printable: number[] = []
    for (const byte of buffer) {
      if (byte >= 0x20 && byte <= 0x7e) {
        printable.push(byte)
      } else {
        printable.push(0x20)
      }
    }
    const text = Buffer.from(printable).toString('utf-8')
    const match = /([0-9a-fA-F]{8,})(?:\.t)?\.dat/.exec(text)
    if (match?.[1]) return match[1].toLowerCase()
    const hexMatch = /([0-9a-fA-F]{16,})/.exec(text)
    return hexMatch?.[1]?.toLowerCase()
  }

  public decodePackedInfo(raw: any): Buffer | null {
    if (!raw) return null
    if (Buffer.isBuffer(raw)) return raw
    if (raw instanceof Uint8Array) return Buffer.from(raw)
    if (Array.isArray(raw)) return Buffer.from(raw)
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (/^[a-fA-F0-9]+$/.test(trimmed) && trimmed.length % 2 === 0) {
        try {
          return Buffer.from(trimmed, 'hex')
        } catch { }
      }
      try {
        return Buffer.from(trimmed, 'base64')
      } catch { }
    }
    if (typeof raw === 'object' && Array.isArray(raw.data)) {
      return Buffer.from(raw.data)
    }
    return null
  }

  public parseVoiceDurationSeconds(content: string): number | undefined {
    if (!content) return undefined
    const match = /(voicelength|length|time|playlength)\s*=\s*['"]?([0-9]+(?:\.[0-9]+)?)['"]?/i.exec(content)
    if (!match) return undefined
    const raw = parseFloat(match[2])
    if (!Number.isFinite(raw) || raw <= 0) return undefined
    if (raw > 1000) return Math.round(raw / 1000)
    return Math.round(raw)
  }

  /**
   * 解析引用消息
   */
  public parseQuoteMessage(content: string): { content?: string; sender?: string } {
    try {
      // 提取 refermsg 部分
      const referMsgStart = content.indexOf('<refermsg>')
      const referMsgEnd = content.indexOf('</refermsg>')

      if (referMsgStart === -1 || referMsgEnd === -1) {
        return {}
      }

      const referMsgXml = content.substring(referMsgStart, referMsgEnd + 11)

      // 提取发送者名称
      let displayName = this.extractXmlValue(referMsgXml, 'displayname')
      // 过滤掉 wxid
      if (displayName && this.looksLikeWxid(displayName)) {
        displayName = ''
      }

      // 提取引用内容
      const referContent = this.extractXmlValue(referMsgXml, 'content')
      const referType = this.extractXmlValue(referMsgXml, 'type')

      // 根据类型渲染引用内容
      let displayContent = referContent
      switch (referType) {
        case '1':
          // 文本消息，清理可能的 wxid
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
        content: displayContent,
        sender: displayName || undefined
      }
    } catch {
      return {}
    }
  }

  /**
   * 解析名片消息
   * 格式: <msg username="wxid_xxx" nickname="昵称" ... />
   */
  public parseCardInfo(content: string): { username?: string; nickname?: string; avatarUrl?: string } {
    try {
      if (!content) return {}

      // 提取 username
      const username = this.extractXmlAttribute(content, 'msg', 'username') || undefined

      // 提取 nickname
      const nickname = this.extractXmlAttribute(content, 'msg', 'nickname') || undefined

      // 提取头像
      const avatarUrl = this.extractXmlAttribute(content, 'msg', 'bigheadimgurl') ||
        this.extractXmlAttribute(content, 'msg', 'smallheadimgurl') || undefined

      return { username, nickname, avatarUrl }
    } catch (e) {
      logger.error('[ChatService] 名片解析失败:', e)
      return {}
    }
  }

  /**
   * 解析 Type 49 消息（链接、文件、小程序、转账等）
   * 根据 <appmsg><type>X</type> 区分不同类型
   */
  public parseType49Message(content: string): {
    xmlType?: string
    quotedContent?: string
    quotedSender?: string
    linkTitle?: string
    linkUrl?: string
    linkThumb?: string
    appMsgKind?: string
    appMsgDesc?: string
    appMsgAppName?: string
    appMsgSourceName?: string
    appMsgSourceUsername?: string
    appMsgThumbUrl?: string
    appMsgMusicUrl?: string
    appMsgDataUrl?: string
    appMsgLocationLabel?: string
    finderNickname?: string
    finderUsername?: string
    finderCoverUrl?: string
    finderAvatar?: string
    finderDuration?: number
    locationLat?: number
    locationLng?: number
    locationPoiname?: string
    locationLabel?: string
    musicAlbumUrl?: string
    musicUrl?: string
    giftImageUrl?: string
    giftWish?: string
    giftPrice?: string
    cardAvatarUrl?: string
    fileName?: string
    fileSize?: number
    fileExt?: string
    transferPayerUsername?: string
    transferReceiverUsername?: string
    chatRecordTitle?: string
    chatRecordList?: ChatRecordListItem[]
  } {
    try {
      if (!content) return {}

      // 提取 appmsg 直接子节点的 type，避免匹配到 refermsg 内部的 <type>
      // 先尝试从 <appmsg>...</appmsg> 块内提取，再用正则跳过嵌套标签
      let xmlType = ''
      const appmsgMatch = /<appmsg[\s\S]*?>([\s\S]*?)<\/appmsg>/i.exec(content)
      if (appmsgMatch) {
        // 在 appmsg 内容中，找第一个 <type> 但跳过在子元素内部的（如 refermsg > type）
        // 策略：去掉所有嵌套块（refermsg、patMsg 等），再提取 type
        const appmsgInner = appmsgMatch[1]
          .replace(/<refermsg[\s\S]*?<\/refermsg>/gi, '')
          .replace(/<patMsg[\s\S]*?<\/patMsg>/gi, '')
        const typeMatch = /<type>([\s\S]*?)<\/type>/i.exec(appmsgInner)
        if (typeMatch) xmlType = typeMatch[1].trim()
      }
      if (!xmlType) xmlType = this.extractXmlValue(content, 'type')
      if (!xmlType) return {}

      const result: any = { xmlType }

      // 提取通用字段
      const title = this.extractXmlValue(content, 'title')
      const url = this.extractXmlValue(content, 'url')
      const desc = this.extractXmlValue(content, 'des') || this.extractXmlValue(content, 'description')
      const appName = this.extractXmlValue(content, 'appname')
      const sourceName = this.extractXmlValue(content, 'sourcename')
      const sourceUsername = this.extractXmlValue(content, 'sourceusername')
      const thumbUrl =
        this.extractXmlValue(content, 'thumburl') ||
        this.extractXmlValue(content, 'cdnthumburl') ||
        this.extractXmlValue(content, 'cover') ||
        this.extractXmlValue(content, 'coverurl') ||
        this.extractXmlValue(content, 'thumb_url')
      const musicUrl =
        this.extractXmlValue(content, 'musicurl') ||
        this.extractXmlValue(content, 'playurl') ||
        this.extractXmlValue(content, 'songalbumurl')
      const dataUrl = this.extractXmlValue(content, 'dataurl') || this.extractXmlValue(content, 'lowurl')
      const locationLabel =
        this.extractXmlAttribute(content, 'location', 'label') ||
        this.extractXmlAttribute(content, 'location', 'poiname') ||
        this.extractXmlValue(content, 'label') ||
        this.extractXmlValue(content, 'poiname')
      const finderUsername =
        this.extractXmlValue(content, 'finderusername') ||
        this.extractXmlValue(content, 'finder_username') ||
        this.extractXmlValue(content, 'finderuser')
      const finderNickname =
        this.extractXmlValue(content, 'findernickname') ||
        this.extractXmlValue(content, 'finder_nickname')
      const normalized = content.toLowerCase()
      const isFinder = xmlType === '51'
      const isRedPacket = xmlType === '2001'
      const isMusic = xmlType === '3'
      const isLocation = Boolean(locationLabel)

      result.linkTitle = title || undefined
      result.linkUrl = url || undefined
      result.linkThumb = thumbUrl || undefined
      result.appMsgDesc = desc || undefined
      result.appMsgAppName = appName || undefined
      result.appMsgSourceName = sourceName || undefined
      result.appMsgSourceUsername = sourceUsername || undefined
      result.appMsgThumbUrl = thumbUrl || undefined
      result.appMsgMusicUrl = musicUrl || undefined
      result.appMsgDataUrl = dataUrl || undefined
      result.appMsgLocationLabel = locationLabel || undefined
      result.finderUsername = finderUsername || undefined
      result.finderNickname = finderNickname || undefined

      // 视频号封面/头像/时长
      if (isFinder) {
        const finderCover =
          this.extractXmlValue(content, 'thumbUrl') ||
          this.extractXmlValue(content, 'coverUrl') ||
          this.extractXmlValue(content, 'thumburl') ||
          this.extractXmlValue(content, 'coverurl')
        if (finderCover) result.finderCoverUrl = finderCover
        const finderAvatar = this.extractXmlValue(content, 'avatar')
        if (finderAvatar) result.finderAvatar = finderAvatar
        const durationStr = this.extractXmlValue(content, 'videoPlayDuration') || this.extractXmlValue(content, 'duration')
        if (durationStr) {
          const d = parseInt(durationStr, 10)
          if (Number.isFinite(d) && d > 0) result.finderDuration = d
        }
      }

      // 位置经纬度
      if (isLocation) {
        const latAttr = this.extractXmlAttribute(content, 'location', 'x') || this.extractXmlAttribute(content, 'location', 'latitude')
        const lngAttr = this.extractXmlAttribute(content, 'location', 'y') || this.extractXmlAttribute(content, 'location', 'longitude')
        if (latAttr) { const v = parseFloat(latAttr); if (Number.isFinite(v)) result.locationLat = v }
        if (lngAttr) { const v = parseFloat(lngAttr); if (Number.isFinite(v)) result.locationLng = v }
        result.locationPoiname = this.extractXmlAttribute(content, 'location', 'poiname') || locationLabel || undefined
        result.locationLabel = this.extractXmlAttribute(content, 'location', 'label') || undefined
      }

      // 音乐专辑封面
      if (isMusic) {
        const albumUrl = this.extractXmlValue(content, 'songalbumurl')
        if (albumUrl) result.musicAlbumUrl = albumUrl
        result.musicUrl = musicUrl || dataUrl || url || undefined
      }

      // 礼物消息
      const isGift = xmlType === '115'
      if (isGift) {
        result.giftWish = this.extractXmlValue(content, 'wishmessage') || undefined
        result.giftImageUrl = this.extractXmlValue(content, 'skuimgurl') || undefined
        result.giftPrice = this.extractXmlValue(content, 'skuprice') || undefined
      }

      if (isFinder) {
        result.appMsgKind = 'finder'
      } else if (isRedPacket) {
        result.appMsgKind = 'red-packet'
      } else if (isGift) {
        result.appMsgKind = 'gift'
      } else if (isLocation) {
        result.appMsgKind = 'location'
      } else if (isMusic) {
        result.appMsgKind = 'music'
      } else if (xmlType === '33' || xmlType === '36') {
        result.appMsgKind = 'miniapp'
      } else if (xmlType === '6') {
        result.appMsgKind = 'file'
      } else if (xmlType === '19') {
        result.appMsgKind = 'chat-record'
      } else if (xmlType === '2000') {
        result.appMsgKind = 'transfer'
      } else if (xmlType === '87') {
        result.appMsgKind = 'announcement'
      } else if (xmlType === '57') {
        // 引用回复消息，解析 refermsg
        result.appMsgKind = 'quote'
        const quoteInfo = this.parseQuoteMessage(content)
        result.quotedContent = quoteInfo.content
        result.quotedSender = quoteInfo.sender
      } else if ((xmlType === '5' || xmlType === '49') && (sourceUsername?.startsWith('gh_') || appName?.includes('公众号') || sourceName)) {
        result.appMsgKind = 'official-link'
      } else if (url) {
        result.appMsgKind = 'link'
      } else {
        result.appMsgKind = 'card'
      }

      switch (xmlType) {
        case '6': {
          // 文件消息
          result.fileName = title || this.extractXmlValue(content, 'filename')
          result.linkTitle = result.fileName

          // 提取文件大小
          const fileSizeStr = this.extractXmlValue(content, 'totallen') ||
            this.extractXmlValue(content, 'filesize')
          if (fileSizeStr) {
            const size = parseInt(fileSizeStr, 10)
            if (!isNaN(size)) {
              result.fileSize = size
            }
          }

          // 提取文件扩展名
          const fileExt = this.extractXmlValue(content, 'fileext')
          if (fileExt) {
            result.fileExt = fileExt
          } else if (result.fileName) {
            // 从文件名提取扩展名
            const match = /\.([^.]+)$/.exec(result.fileName)
            if (match) {
              result.fileExt = match[1]
            }
          }
          break
        }

        case '19': {
          // 聊天记录
          result.chatRecordTitle = title || '聊天记录'

          const recordList = parseChatRecordList(content)
          if (recordList && recordList.length > 0) {
            result.chatRecordList = recordList
          }
          break
        }

        case '33':
        case '36': {
          // 小程序
          result.linkTitle = title
          result.linkUrl = url

          // 提取缩略图
          const thumbUrl = this.extractXmlValue(content, 'thumburl') ||
            this.extractXmlValue(content, 'cdnthumburl')
          if (thumbUrl) {
            result.linkThumb = thumbUrl
          }
          break
        }

        case '2000': {
          // 转账
          result.linkTitle = title || '[转账]'

          // 可以提取转账金额等信息
          const payMemo = this.extractXmlValue(content, 'pay_memo')
          const feedesc = this.extractXmlValue(content, 'feedesc')

          if (payMemo) {
            result.linkTitle = payMemo
          } else if (feedesc) {
            result.linkTitle = feedesc
          }

          // 提取转账双方 wxid
          const payerUsername = this.extractXmlValue(content, 'payer_username')
          const receiverUsername = this.extractXmlValue(content, 'receiver_username')
          if (payerUsername) {
            result.transferPayerUsername = payerUsername
          }
          if (receiverUsername) {
            result.transferReceiverUsername = receiverUsername
          }
          break
        }

        default: {
          // 其他类型，提取通用字段
          result.linkTitle = title
          result.linkUrl = url

          const thumbUrl = this.extractXmlValue(content, 'thumburl') ||
            this.extractXmlValue(content, 'cdnthumburl')
          if (thumbUrl) {
            result.linkThumb = thumbUrl
          }
        }
      }

      return result
    } catch (e) {
      logger.error('[ChatService] Type 49 消息解析失败:', e)
      return {}
    }
  }

  //手动查找 media_*.db 文件（当 WCDB DLL 不支持 listMediaDbs 时的 fallback）
  public looksLikeWxid(text: string): boolean {
    if (!text) return false
    const trimmed = text.trim().toLowerCase()
    if (trimmed.startsWith('wxid_')) return true
    return /^wx[a-z0-9_-]{4,}$/.test(trimmed)
  }

  /**
   * 清理引用内容中的 wxid
   */
  public sanitizeQuotedContent(content: string): string {
    if (!content) return ''
    let result = content
    // 去掉 wxid_xxx
    result = result.replace(/wxid_[A-Za-z0-9_-]{3,}/g, '')
    // 去掉开头的分隔符
    result = result.replace(/^[\s:：\-]+/, '')
    // 折叠重复分隔符
    result = result.replace(/[:：]{2,}/g, ':')
    result = result.replace(/^[\s:：\-]+/, '')
    // 标准化空白
    result = result.replace(/\s+/g, ' ').trim()
    return result
  }

  public getMessageTypeLabel(localType: number): string {
    const labels: Record<number, string> = {
      1: '[文本]',
      3: '[图片]',
      34: '[语音]',
      42: '[名片]',
      43: '[视频]',
      47: '[动画表情]',
      48: '[位置]',
      49: '[链接]',
      50: '[通话]',
      10000: '[系统消息]',
      244813135921: '[引用消息]',
      266287972401: '[拍一拍]',
      81604378673: '[聊天记录]',
      154618822705: '[小程序]',
      8594229559345: '[红包]',
      8589934592049: '[转账]',
      34359738417: '[文件]',
      103079215153: '[文件]',
      25769803825: '[文件]'
    }
    return labels[localType] || '[消息]'
  }

  public extractXmlValue(xml: string, tagName: string): string {
    const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i')
    const match = regex.exec(xml)
    if (match) {
      return match[1].replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim()
    }
    return ''
  }

  public extractXmlAttribute(xml: string, tagName: string, attrName: string): string {
    // 匹配 <tagName ... attrName="value" ... /> 或 <tagName ... attrName="value" ...>
    const regex = new RegExp(`<${tagName}[^>]*\\s${attrName}\\s*=\\s*['"]([^'"]*)['"']`, 'i')
    const match = regex.exec(xml)
    return match ? match[1] : ''
  }

  public cleanSystemMessage(content: string): string {
    // 移除 XML 声明
    let cleaned = content.replace(/<\?xml[^?]*\?>/gi, '')
    // 移除所有 XML/HTML 标签
    cleaned = cleaned.replace(/<[^>]+>/g, '')
    // 移除尾部的数字（如撤回消息后的时间戳）
    cleaned = cleaned.replace(/\d+\s*$/, '')
    // 清理多余空白
    cleaned = cleaned.replace(/\s+/g, ' ').trim()
    return cleaned || '[系统消息]'
  }

  public stripSenderPrefix(content: string): string {
    return content.replace(/^[\s]*([a-zA-Z0-9_-]+):(?!\/\/)\s*/, '')
  }

  public decodeHtmlEntities(content: string): string {
    return content
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
  }


  public cleanString(str: string): string {
    if (!str) return ''
    if (Buffer.isBuffer(str)) {
      str = str.toString('utf-8')
    }
    return this.cleanUtf16(String(str))
  }

  public cleanUtf16(input: string): string {
    if (!input) return input
    try {
      const cleaned = input.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, '')
      const codeUnits = cleaned.split('').map((c) => c.charCodeAt(0))
      const validUnits: number[] = []
      for (let i = 0; i < codeUnits.length; i += 1) {
        const unit = codeUnits[i]
        if (unit >= 0xd800 && unit <= 0xdbff) {
          if (i + 1 < codeUnits.length) {
            const nextUnit = codeUnits[i + 1]
            if (nextUnit >= 0xdc00 && nextUnit <= 0xdfff) {
              validUnits.push(unit, nextUnit)
              i += 1
              continue
            }
          }
          continue
        }
        if (unit >= 0xdc00 && unit <= 0xdfff) {
          continue
        }
        validUnits.push(unit)
      }
      return String.fromCharCode(...validUnits)
    } catch {
      return input.replace(/[^\u0020-\u007E\u4E00-\u9FFF\u3000-\u303F]/g, '')
    }
  }

  /**
   * 清理拍一拍消息
   * 格式示例:
   *   纯文本: 我拍了拍 "梨绒" ງ໐໐໓ ຖiງht620000wxid_...
   *   XML: <msg><appmsg...><title>"有幸"拍了拍"浩天空"相信未来!</title>...</msg>
   */
  public cleanPatMessage(content: string): string {
    if (!content) return '[拍一拍]'

    // 1. 优先从 XML <title> 标签提取内容
    const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(content)
    if (titleMatch) {
      const title = titleMatch[1]
        .replace(/<!\[CDATA\[/g, '')
        .replace(/\]\]>/g, '')
        .trim()
      if (title) {
        return `[拍一拍] ${title}`
      }
    }

    // 2. 尝试匹配标准的 "A拍了拍B" 格式
    const match = /^(.+?拍了拍.+?)(?:[\r\n]|$|ງ|wxid_)/.exec(content)
    if (match) {
      return `[拍一拍] ${match[1].trim()}`
    }

    // 3. 如果匹配失败，尝试清理掉疑似的 garbage (wxid, 乱码)
    let cleaned = content.replace(/wxid_[a-zA-Z0-9_-]+/g, '') // 移除 wxid
    cleaned = cleaned.replace(/[ງ໐໓ຖiht]+/g, ' ') // 移除已知的乱码字符
    cleaned = cleaned.replace(/\d{6,}/g, '') // 移除长数字
    cleaned = cleaned.replace(/\s+/g, ' ').trim() // 清理空格

    // 移除不可见字符
    cleaned = this.cleanUtf16(cleaned)

    // 如果清理后还有内容，返回
    if (cleaned && cleaned.length > 1 && !cleaned.includes('xml')) {
      return `[拍一拍] ${cleaned}`
    }

    return '[拍一拍]'
  }

  /**
   * 解码消息内容（处理 BLOB 和压缩数据）
   */
  public decodeMessageContent(messageContent: any, compressContent: any): string {
    // 优先使用 compress_content
    let content = this.decodeMaybeCompressed(compressContent, 'compress_content')
    if (!content || content.length === 0) {
      content = this.decodeMaybeCompressed(messageContent, 'message_content')
    }
    return content
  }

  /**
   * 尝试解码可能压缩的内容
   */
  public decodeMaybeCompressed(raw: any, fieldName: string = 'unknown'): string {
    if (!raw) return ''

    // 

    // 如果是 Buffer/Uint8Array
    if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
      return this.decodeBinaryContent(Buffer.from(raw), String(raw))
    }

    // 如果是字符串
    if (typeof raw === 'string') {
      if (raw.length === 0) return ''

      // 检查是否是 hex 编码
      // 只有当字符串足够长（超过16字符）且看起来像 hex 时才尝试解码
      // 短字符串（如 "123456" 等纯数字）容易被误判为 hex
      if (raw.length > 16 && this.looksLikeHex(raw)) {
        const bytes = Buffer.from(raw, 'hex')
        if (bytes.length > 0) {
          const result = this.decodeBinaryContent(bytes, raw)
          // 
          return result
        }
      }

      // 检查是否是 base64 编码
      // 只有当字符串足够长（超过16字符）且看起来像 base64 时才尝试解码
      // 短字符串（如 "test", "home" 等）容易被误判为 base64
      if (raw.length > 16 && this.looksLikeBase64(raw)) {
        try {
          const bytes = Buffer.from(raw, 'base64')
          return this.decodeBinaryContent(bytes, raw)
        } catch { }
      }

      // 普通字符串
      return raw
    }

    return ''
  }

  /**
   * 解码二进制内容（处理 zstd 压缩）
   */
  public decodeBinaryContent(data: Buffer, fallbackValue?: string): string {
    if (data.length === 0) return ''

    try {
      // 检查是否是 zstd 压缩数据 (magic number: 0xFD2FB528)
      if (data.length >= 4) {
        const magicLE = data.readUInt32LE(0)
        const magicBE = data.readUInt32BE(0)
        if (magicLE === 0xFD2FB528 || magicBE === 0xFD2FB528) {
          // zstd 压缩，需要解压
          try {
            const decompressed = fzstd.decompress(data)
            return Buffer.from(decompressed).toString('utf-8')
          } catch (e) {
            logger.error('zstd 解压失败:', e)
          }
        }
      }

      // 尝试直接 UTF-8 解码
      const decoded = data.toString('utf-8')
      // 检查是否有太多替换字符
      const replacementCount = (decoded.match(/\uFFFD/g) || []).length
      if (replacementCount < decoded.length * 0.2) {
        return decoded.replace(/\uFFFD/g, '')
      }

      // 如果提供了 fallbackValue，且解码结果看起来像二进制垃圾，则返回 fallbackValue
      if (fallbackValue && replacementCount > 0) {
        // 
        return fallbackValue
      }

      // 尝试 latin1 解码
      return data.toString('latin1')
    } catch {
      return fallbackValue || ''
    }
  }

  /**
   * 检查是否像 hex 编码
   */
  public looksLikeHex(s: string): boolean {
    if (s.length % 2 !== 0) return false
    return /^[0-9a-fA-F]+$/.test(s)
  }

  /**
   * 检查是否像 base64 编码
   */
  public looksLikeBase64(s: string): boolean {
    if (s.length % 4 !== 0) return false
    return /^[A-Za-z0-9+/=]+$/.test(s)
  }

  public shouldKeepSession(username: string): boolean {
    if (!username) return false
    const lowered = username.toLowerCase()
    // 排除所有 placeholder 会话（包括折叠群）
    if (lowered.includes('@placeholder')) return false
    if (username.startsWith('gh_')) return false

    const excludeList = [
      'weixin', 'qqmail', 'fmessage', 'medianote', 'floatbottle',
      'newsapp', 'brandsessionholder', 'brandservicesessionholder',
      'notifymessage', 'opencustomerservicemsg', 'notification_messages',
      'userexperience_alarm', 'helper_folders',
      '@helper_folders'
    ]

    for (const prefix of excludeList) {
      if (username.startsWith(prefix) || username === prefix) return false
    }

    if (username.includes('@kefu.openim') || username.includes('@openim')) return false
    if (username.includes('service_')) return false

    return true
  }

}
