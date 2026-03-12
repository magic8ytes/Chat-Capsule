import path from 'path'
import { z } from 'zod'

const MAX_EXTERNAL_URL_LENGTH = 2048

const TRUSTED_EXTERNAL_HOSTS = [
  'uri.amap.com',
  'amap.com',
  'qq.com',
  'qpic.cn',
  'qlogo.cn',
  'wechat.com',
  'weixin.qq.com'
] as const

function isPrivateIpv4Host(hostname: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return false
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [a, b] = parts
  if (a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return true
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true
  if (normalized === '::1') return true
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    const ipv6 = normalized.slice(1, -1)
    if (ipv6 === '::1' || ipv6.startsWith('fc') || ipv6.startsWith('fd') || ipv6.startsWith('fe80:')) {
      return true
    }
  }
  return isPrivateIpv4Host(normalized)
}

export const localOpenPathSchema = z.unknown().transform((value, context) => {
  const raw = String(value || '').trim()
  if (!raw) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '路径为空' })
    return z.NEVER
  }
  if (raw.includes('\0')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '路径包含空字符' })
    return z.NEVER
  }
  if (/^[a-z]+:\/\//i.test(raw)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '不允许 URL 协议路径' })
    return z.NEVER
  }
  if (!path.isAbsolute(raw)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '必须为本地绝对路径' })
    return z.NEVER
  }
  return path.resolve(raw)
})

export const externalOpenUrlSchema = z.unknown().transform((value, context) => {
  const raw = String(value || '').trim()
  if (!raw) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'URL 为空' })
    return z.NEVER
  }
  if (raw.length > MAX_EXTERNAL_URL_LENGTH) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'URL 过长' })
    return z.NEVER
  }
  if (raw.includes('\0')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'URL 包含空字符' })
    return z.NEVER
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'URL 格式不合法' })
    return z.NEVER
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '仅允许 http/https 外部链接' })
    return z.NEVER
  }
  if (!parsed.hostname) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'URL 缺少主机名' })
    return z.NEVER
  }
  if (parsed.username || parsed.password) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '不允许携带认证信息的外部链接' })
    return z.NEVER
  }
  if (isPrivateHost(parsed.hostname)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '不允许打开本机或内网地址' })
    return z.NEVER
  }

  return parsed.toString()
})

export function normalizeLocalOpenPath(value: unknown): string | null {
  const result = localOpenPathSchema.safeParse(value)
  return result.success ? result.data : null
}

export function normalizeExternalOpenUrl(value: unknown): string | null {
  const result = externalOpenUrlSchema.safeParse(value)
  return result.success ? result.data : null
}

export function isTrustedExternalOpenUrl(value: unknown): boolean {
  const normalized = normalizeExternalOpenUrl(value)
  if (!normalized) return false

  try {
    const parsed = new URL(normalized)
    return TRUSTED_EXTERNAL_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}
