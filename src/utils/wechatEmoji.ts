import { getEmojiPath } from 'wechat-emojis'

export type InlineEmojiSegment =
  | { type: 'text'; value: string }
  | { type: 'emoji'; value: string }

const emojiLookup = getEmojiPath as unknown as (name: string) => string | null | undefined

export function resolveWechatEmojiPath(name: string): string | null {
  const normalized = name.trim()
  if (!normalized) return null
  const emojiPath = emojiLookup(normalized)
  return typeof emojiPath === 'string' && emojiPath.length > 0 ? emojiPath : null
}

export function splitTextWithInlineEmoji(text: string): InlineEmojiSegment[] {
  if (!text) return []

  return text
    .split(/\[(.*?)\]/g)
    .map((value, index): InlineEmojiSegment | null => {
      if (!value) return null
      return index % 2 === 1 ? { type: 'emoji', value } : { type: 'text', value }
    })
    .filter((segment): segment is InlineEmojiSegment => segment !== null)
}
