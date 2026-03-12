export const escapeCsvCell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export const formatIsoTimestamp = (timestamp: number): string => {
  return new Date(timestamp * 1000).toISOString()
}

export const escapeHtml = (value: string): string => {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default: return char
    }
  })
}

export const escapeAttribute = (value: string): string => {
  return value.replace(/[&<>"'`]/g, (char) => {
    switch (char) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      case '`': return '&#96;'
      default: return char
    }
  })
}

export const getAvatarFallback = (name: string): string => {
  if (!name) return '?'
  return [...name][0] || '?'
}

export const sanitizeFileNameSegment = (value: string): string => {
  return String(value || '').replace(/[<>:"/\\|?*]/g, '_').replace(/\.+$/g, '').trim()
}
