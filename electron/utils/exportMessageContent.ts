export const normalizeAppMessageContent = (content: string): string => {
  if (!content) return ''
  if (content.includes('&lt;') && content.includes('&gt;')) {
    return content
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  }
  return content
}

export const extractFinderFeedDesc = (content: string): string => {
  if (!content) return ''
  const match = /<finderFeed[\s\S]*?<desc>([\s\S]*?)<\/desc>/i.exec(content)
  if (!match) return ''
  return match[1].replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim()
}
