import { useEffect, useState, type ReactNode } from 'react'
import { Link, MessageSquare } from 'lucide-react'
import type { Message } from '../../types/models'
import { electronApi } from '../../services/ipc'
import { formatFileSize } from '../../utils/formatters'
import { toSafeMediaUrl } from '../../utils/mediaUrl'
import { renderTextWithInlineEmoji } from '../../utils/renderInlineEmoji'
import { createLogger } from '../../utils/logger'

const quotedEmojiCache = new Map<string, string>()
const logger = createLogger('AppMessageBubble')

const cleanMessageContent = (content: string): string => {
  if (!content) return ''
  return content.trim()
}


const normalizeLocalAssetUrl = (value?: string): string | undefined => {
  return toSafeMediaUrl(value)
}

export function QuotedEmoji({ cdnUrl, md5 }: { cdnUrl: string; md5?: string }) {
  const cacheKey = md5 || cdnUrl
  const [localPath, setLocalPath] = useState<string | undefined>(() => normalizeLocalAssetUrl(quotedEmojiCache.get(cacheKey)))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (localPath || loading || error) return
    setLoading(true)
    electronApi.chat.downloadEmoji(cdnUrl, md5).then((result: { success: boolean; localPath?: string }) => {
      if (result.success && result.localPath) {
        const normalizedPath = normalizeLocalAssetUrl(result.localPath)
        if (normalizedPath) {
          quotedEmojiCache.set(cacheKey, normalizedPath)
          setLocalPath(normalizedPath)
        } else {
          setError(true)
        }
      } else {
        setError(true)
      }
    }).catch(() => setError(true)).finally(() => setLoading(false))
  }, [cacheKey, cdnUrl, error, loading, localPath, md5])

  if (error || (!loading && !localPath)) return <span className="quoted-type-label">[动画表情]</span>
  if (loading) return <span className="quoted-type-label">[动画表情]</span>
  return <img src={localPath} alt="动画表情" className="quoted-emoji-image" />
}

interface AppMessageBubbleProps {
  message: Message
  sessionId: string
  transferPayerName?: string
  transferReceiverName?: string
  debugEnabled?: boolean
  fallbackContent: ReactNode
}

export default function AppMessageBubble({
  message,
  sessionId,
  transferPayerName,
  transferReceiverName,
  debugEnabled = false,
  fallbackContent
}: AppMessageBubbleProps) {
  const isAppMsg = message.rawContent?.includes('<appmsg') || (message.parsedContent && message.parsedContent.includes('<appmsg'))
  if (!isAppMsg) return <>{fallbackContent}</>

  let title = '链接'
  let desc = ''
  let url = ''
  let appMsgType = ''
  let textAnnouncement = ''
  let parsedDoc: Document | null = null

  try {
    const content = message.rawContent || message.parsedContent || ''
    const msgIndex = content.indexOf('<msg>')
    const xmlContent = msgIndex >= 0 ? content.substring(msgIndex) : content

    const parser = new DOMParser()
    parsedDoc = parser.parseFromString(xmlContent, 'text/xml')

    title = parsedDoc.querySelector('title')?.textContent || '链接'
    desc = parsedDoc.querySelector('des')?.textContent || ''
    url = parsedDoc.querySelector('url')?.textContent || ''
    appMsgType = parsedDoc.querySelector('appmsg > type')?.textContent || parsedDoc.querySelector('type')?.textContent || ''
    textAnnouncement = parsedDoc.querySelector('textannouncement')?.textContent || ''
  } catch (error) {
    if (debugEnabled) {
      logger.error('解析 AppMsg 失败:', error)
    }
  }

  if (appMsgType === '57') {
    const replyText = parsedDoc?.querySelector('title')?.textContent?.trim() || cleanMessageContent(message.parsedContent) || ''
    const referContent = parsedDoc?.querySelector('refermsg > content')?.textContent?.trim() || ''
    const referSender = parsedDoc?.querySelector('refermsg > displayname')?.textContent?.trim() || ''
    const referType = parsedDoc?.querySelector('refermsg > type')?.textContent?.trim() || ''

    const renderReferContent = () => {
      if (referType === '47') {
        try {
          const innerDoc = new DOMParser().parseFromString(referContent, 'text/xml')
          const cdnUrl = innerDoc.querySelector('emoji')?.getAttribute('cdnurl') || ''
          const md5 = innerDoc.querySelector('emoji')?.getAttribute('md5') || ''
          if (cdnUrl) return <QuotedEmoji cdnUrl={cdnUrl} md5={md5} />
        } catch {
          return <span className="quoted-type-label">[动画表情]</span>
        }
        return <span className="quoted-type-label">[动画表情]</span>
      }
      const typeLabels: Record<string, string> = {
        '3': '图片',
        '34': '语音',
        '43': '视频',
        '49': '链接',
        '50': '通话',
        '10000': '系统消息',
        '10002': '撤回消息'
      }
      if (referType && typeLabels[referType]) {
        return <span className="quoted-type-label">[{typeLabels[referType]}]</span>
      }
      return <>{renderTextWithInlineEmoji(cleanMessageContent(referContent))}</>
    }

    return (
      <div className="bubble-content">
        <div className="quoted-message">
          {referSender && <span className="quoted-sender">{referSender}</span>}
          <span className="quoted-text">{renderReferContent()}</span>
        </div>
        <div className="message-text">{renderTextWithInlineEmoji(cleanMessageContent(replyText))}</div>
      </div>
    )
  }

  if (appMsgType === '87') {
    const announcementText = textAnnouncement || desc || '群公告'
    return (
      <div className="announcement-message">
        <div className="announcement-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3zm-8.27 4a2 2 0 0 1-3.46 0" />
          </svg>
        </div>
        <div className="announcement-content">
          <div className="announcement-label">群公告</div>
          <div className="announcement-text">{announcementText}</div>
        </div>
      </div>
    )
  }

  if (appMsgType === '19') {
    const recordList = message.chatRecordList || []
    const displayTitle = title || '群聊的聊天记录'
    const metaText = recordList.length > 0 ? `共 ${recordList.length} 条聊天记录` : desc || '聊天记录'
    const previewItems = recordList.slice(0, 4)

    return (
      <div
        className="link-message chat-record-message"
        onClick={(event) => {
          event.stopPropagation()
          electronApi.window.openChatHistoryWindow(sessionId, message.localId)
        }}
        title="点击查看详细聊天记录"
      >
        <div className="link-header">
          <div className="link-title" title={displayTitle}>
            {displayTitle}
          </div>
        </div>
        <div className="link-body">
          <div className="chat-record-preview">
            {previewItems.length > 0 ? (
              <>
                <div className="chat-record-meta-line" title={metaText}>
                  {metaText}
                </div>
                <div className="chat-record-list">
                  {previewItems.map((item, index) => (
                    <div key={index} className="chat-record-item">
                      <span className="source-name">{item.sourcename ? `${item.sourcename}: ` : ''}</span>
                      {item.datadesc || item.datatitle || '[媒体消息]'}
                    </div>
                  ))}
                  {recordList.length > previewItems.length && (
                    <div className="chat-record-more">还有 {recordList.length - previewItems.length} 条…</div>
                  )}
                </div>
              </>
            ) : (
              <div className="chat-record-desc">{desc || '点击打开查看完整聊天记录'}</div>
            )}
          </div>
          <div className="chat-record-icon">
            <MessageSquare size={18} />
          </div>
        </div>
      </div>
    )
  }

  if (appMsgType === '6') {
    const fileName = message.fileName || title || '文件'
    const fileSize = message.fileSize
    const fileExt = message.fileExt || fileName.split('.').pop()?.toLowerCase() || ''
    const isArchive = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(fileExt)

    return (
      <div className="file-message">
        <div className="file-icon">
          {isArchive ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
          )}
        </div>
        <div className="file-info">
          <div className="file-name" title={fileName}>{fileName}</div>
          <div className="file-meta">{fileSize ? formatFileSize(fileSize) : ''}</div>
        </div>
      </div>
    )
  }

  if (appMsgType === '2000') {
    try {
      const feedesc = parsedDoc?.querySelector('feedesc')?.textContent || ''
      const payMemo = parsedDoc?.querySelector('pay_memo')?.textContent || ''
      const paysubtype = parsedDoc?.querySelector('paysubtype')?.textContent || '1'
      const isReceived = paysubtype === '3'
      const displayAmount = feedesc || title || '微信转账'
      const transferDesc = transferPayerName && transferReceiverName
        ? `${transferPayerName} 转账给 ${transferReceiverName}`
        : undefined

      return (
        <div className={`transfer-message ${isReceived ? 'received' : ''}`}>
          <div className="transfer-icon">
            {isReceived ? (
              <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="18" stroke="white" strokeWidth="2" />
                <path d="M12 20l6 6 10-12" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="18" stroke="white" strokeWidth="2" />
                <path d="M12 20h16M20 12l8 8-8 8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <div className="transfer-info">
            <div className="transfer-amount">{displayAmount}</div>
            {transferDesc && <div className="transfer-desc">{transferDesc}</div>}
            {payMemo && <div className="transfer-memo">{payMemo}</div>}
            <div className="transfer-label">{isReceived ? '已收款' : '微信转账'}</div>
          </div>
        </div>
      )
    } catch (error) {
      if (debugEnabled) {
        logger.error('[Transfer Debug] Parse error:', error)
      }
      const feedesc = title || '微信转账'
      return (
        <div className="transfer-message">
          <div className="transfer-icon">
            <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="18" stroke="white" strokeWidth="2" />
              <path d="M12 20h16M20 12l8 8-8 8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="transfer-info">
            <div className="transfer-amount">{feedesc}</div>
            <div className="transfer-label">微信转账</div>
          </div>
        </div>
      )
    }
  }

  if (appMsgType === '33' || appMsgType === '36') {
    return (
      <div className="miniapp-message">
        <div className="miniapp-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
        </div>
        <div className="miniapp-info">
          <div className="miniapp-title">{title}</div>
          <div className="miniapp-label">小程序</div>
        </div>
      </div>
    )
  }

  if (url) {
    return (
      <div
        className="link-message"
        onClick={(event) => {
          event.stopPropagation()
          void electronApi.shell.openExternal(url)
        }}
      >
        <div className="link-header">
          <div className="link-title" title={title}>{title}</div>
        </div>
        <div className="link-body">
          <div className="link-desc" title={desc}>{desc}</div>
          <div className="link-thumb-placeholder">
            <Link size={24} />
          </div>
        </div>
      </div>
    )
  }

  return <>{fallbackContent}</>
}
