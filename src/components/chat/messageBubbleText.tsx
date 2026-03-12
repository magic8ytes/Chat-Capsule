import { renderTextWithInlineEmoji } from '../../utils/renderInlineEmoji'

export function cleanMessageBubbleContent(content: string): string {
  if (!content) return ''
  return content.replace(/^[a-zA-Z0-9]+@openim:\n?/, '')
}

export function formatMessageBubbleTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '未知时间'
  const date = new Date(timestamp * 1000)
  return `${date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })} ${date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })}`
}

interface MessageFallbackContentProps {
  parsedContent: string
  quotedContent?: string
  quotedSender?: string
}

export function MessageFallbackContent({
  parsedContent,
  quotedContent,
  quotedSender
}: MessageFallbackContentProps) {
  const normalizedQuoted = cleanMessageBubbleContent(quotedContent || '')
  const normalizedParsed = cleanMessageBubbleContent(parsedContent)

  if (normalizedQuoted) {
    return (
      <div className="bubble-content">
        <div className="quoted-message">
          {quotedSender && <span className="quoted-sender">{quotedSender}</span>}
          <span className="quoted-text">{renderTextWithInlineEmoji(normalizedQuoted)}</span>
        </div>
        <div className="message-text">{renderTextWithInlineEmoji(normalizedParsed)}</div>
      </div>
    )
  }

  return <div className="bubble-content">{renderTextWithInlineEmoji(normalizedParsed)}</div>
}
