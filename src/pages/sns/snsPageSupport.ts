import type { SnsPost } from '../../types/sns'

export function hasRenderableSnsMedia(post: SnsPost): boolean {
  return (post.media || []).some((item) => {
    const url = String(item?.url || '').trim()
    const thumb = String(item?.thumb || '').trim()
    const liveUrl = String(item?.livePhoto?.url || '').trim()
    const liveThumb = String(item?.livePhoto?.thumb || '').trim()
    return Boolean(url || thumb || liveUrl || liveThumb)
  })
}

export function isLikelyBrokenCachedSnsPost(post: SnsPost): boolean {
  const rawXml = String(post.rawXml || '').trim()
  if (!rawXml) return false
  const hasText = Boolean(String(post.contentDesc || '').trim())
  const hasMedia = hasRenderableSnsMedia(post)
  const hasLink = Boolean(String(post.linkUrl || '').trim() || String(post.linkTitle || '').trim())
  const hasLikes = Array.isArray(post.likes) && post.likes.length > 0
  const hasComments = Array.isArray(post.comments) && post.comments.length > 0
  return !hasText && !hasMedia && !hasLink && !hasLikes && !hasComments
}

export function formatDateOnly(timestamp: number | null): string {
  if (!timestamp || timestamp <= 0) return '--'
  const date = new Date(timestamp * 1000)
  if (Number.isNaN(date.getTime())) return '--'
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function decodeHtmlEntities(text: string): string {
  if (!text) return ''
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim()
}

export function normalizePostCountValue(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

export function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function toDateKey(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
