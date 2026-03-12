export function extractXmlTagValue(xml: string, tags: string[]): string {
  const source = String(xml || '')
  for (const tag of tags) {
    const normalizedTag = String(tag || '').trim()
    if (!normalizedTag) continue
    const pattern = `<${normalizedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${normalizedTag}>`
    const match = new RegExp(pattern, 'i').exec(source)
    if (match?.[1]) {
      return match[1].trim()
    }
  }
  return ''
}
