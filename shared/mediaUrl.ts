export const LOCAL_MEDIA_PROTOCOL = 'weflow-media:'
export const LOCAL_MEDIA_URL_PREFIX = 'weflow-media://local?path='

const PREVIEW_MEDIA_HOST_ALLOWLIST = ['qq.com', 'qpic.cn', 'qlogo.cn', 'wechat.com', 'weixin.qq.com'] as const

function isAllowedPreviewMediaHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return PREVIEW_MEDIA_HOST_ALLOWLIST.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`))
}

function normalizeAllowedPreviewRemoteUrl(value: string): string | null {
  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
      return null
    }
    if (parsed.username || parsed.password) {
      return null
    }
    if (!isAllowedPreviewMediaHost(parsed.hostname)) {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function decodeFileUrlPath(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol === 'file:') {
      const pathname = decodeURIComponent(url.pathname || '')
      if (pathname) return pathname
    }
  } catch {
  }

  const raw = value.replace(/^file:\/\//i, '')
  const withoutHash = raw.split('#')[0] || raw
  const withoutSearch = withoutHash.split('?')[0] || withoutHash
  try {
    return decodeURIComponent(withoutSearch)
  } catch {
    return withoutSearch
  }
}

export function toSafeMediaUrl(value?: string | null): string | undefined {
  const normalized = String(value || '').trim()
  if (!normalized) return undefined
  if (/^(data:|https?:|weflow-media:)/i.test(normalized)) return normalized

  if (/^file:\/\//i.test(normalized)) {
    const filePath = decodeFileUrlPath(normalized)
    if (filePath.startsWith('/')) {
      return `${LOCAL_MEDIA_URL_PREFIX}${encodeURIComponent(filePath)}`
    }
    return normalized
  }

  if (normalized.startsWith('/')) {
    return `${LOCAL_MEDIA_URL_PREFIX}${encodeURIComponent(normalized)}`
  }

  return normalized
}

export function getLocalMediaPathFromUrl(value?: string | null): string | null {
  const normalized = String(value || '').trim()
  if (!normalized) return null

  try {
    const url = new URL(normalized)
    if (url.protocol === LOCAL_MEDIA_PROTOCOL) {
      const pathParam = url.searchParams.get('path')
      if (pathParam) {
        return pathParam.startsWith('/') ? pathParam : null
      }

      const decodedPathname = decodeURIComponent(url.pathname || '')
      if (decodedPathname.startsWith('/')) {
        return decodedPathname
      }
    }
  } catch {
  }

  if (!normalized.startsWith(LOCAL_MEDIA_URL_PREFIX)) return null
  const encodedPath = normalized.slice(LOCAL_MEDIA_URL_PREFIX.length)
  if (!encodedPath) return null
  try {
    const decoded = decodeURIComponent(encodedPath)
    return decoded.startsWith('/') ? decoded : null
  } catch {
    return null
  }
}

export function toSafePreviewMediaUrl(value?: string | null): string | undefined {
  const normalized = toSafeMediaUrl(value)
  if (!normalized) return undefined
  if (/^(data:|weflow-media:)/i.test(normalized)) return normalized
  if (getLocalMediaPathFromUrl(normalized)) return normalized

  const allowedRemote = normalizeAllowedPreviewRemoteUrl(normalized)
  return allowedRemote || undefined
}
