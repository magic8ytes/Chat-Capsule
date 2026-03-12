import { getEmojiPath } from 'wechat-emojis'

const emojiLookup = getEmojiPath as unknown as (name: string) => string | null | undefined

export function resolveWechatEmojiPath(name: string): string | null {
  const normalized = name.trim()
  if (!normalized) return null
  const emojiPath = emojiLookup(normalized)
  return typeof emojiPath === 'string' && emojiPath.length > 0 ? emojiPath : null
}
