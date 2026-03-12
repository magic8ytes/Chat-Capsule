import { z } from 'zod'

export const SNS_MEDIA_HOST_ALLOWLIST = ['qq.com', 'qpic.cn', 'qlogo.cn', 'wechat.com', 'weixin.qq.com'] as const

const MAX_SNS_URL_LENGTH = 4096
const MAX_SNS_MEDIA_KEY_LENGTH = 256

function isAllowedSnsMediaHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return SNS_MEDIA_HOST_ALLOWLIST.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`))
}

export function normalizeSnsMediaRemoteUrl(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw || raw.length > MAX_SNS_URL_LENGTH || raw.includes('\0')) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(raw.replace(/&amp;/g, '&'))
  } catch {
    return null
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    return null
  }
  if (parsed.username || parsed.password) {
    return null
  }
  if (!isAllowedSnsMediaHost(parsed.hostname)) {
    return null
  }

  return parsed.toString()
}

const snsMediaKeySchema = z.union([
  z.number().finite(),
  z.string().trim().min(1).max(MAX_SNS_MEDIA_KEY_LENGTH)
])

export const snsProxyPayloadSchema = z.object({
  url: z.unknown().transform((value, context) => {
    const normalized = normalizeSnsMediaRemoteUrl(value)
    if (!normalized) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'SNS 媒体 URL 不合法或不在白名单内' })
      return z.NEVER
    }
    return normalized
  }),
  key: snsMediaKeySchema.optional()
}).strict()

export type SnsProxyPayload = z.infer<typeof snsProxyPayloadSchema>

export function normalizeSnsProxyPayload(payload: unknown): SnsProxyPayload | null {
  const result = snsProxyPayloadSchema.safeParse(payload)
  return result.success ? result.data : null
}
