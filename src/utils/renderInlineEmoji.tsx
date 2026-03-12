import type { ReactNode } from 'react'
import { resolveWechatEmojiPath, splitTextWithInlineEmoji } from './wechatEmoji'

const inlineEmojiStyle = {
  width: 22,
  height: 22,
  verticalAlign: 'bottom',
  margin: '0 1px'
} as const

export function renderTextWithInlineEmoji(text: string): ReactNode {
  if (!text) return text

  return splitTextWithInlineEmoji(text).map((segment, index) => {
    if (segment.type === 'text') return segment.value

    const emojiPath = resolveWechatEmojiPath(segment.value)
    if (!emojiPath) return `[${segment.value}]`

    return (
      <img
        key={`emoji-${index}-${segment.value}`}
        src={`${import.meta.env.BASE_URL}${emojiPath}`}
        alt={`[${segment.value}]`}
        className="inline-emoji"
        style={inlineEmojiStyle}
      />
    )
  })
}
