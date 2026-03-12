import crypto from 'crypto'
import path from 'path'
import { z } from 'zod'

export const DEFAULT_HTTP_API_PORT = 5031
export const HTTP_API_TOKEN_HEADER = 'x-chat-capsule-token'
export const HTTP_API_AUTH_SCHEME = 'Bearer'

export type HttpApiSecurityMode = 'strict-local-readonly'

export const httpApiTokenViewSchema = z.object({
  tokenPresent: z.boolean(),
  tokenMasked: z.string().trim().min(1).nullable()
}).strict()

export const httpApiStatusSchema = httpApiTokenViewSchema.extend({
  running: z.boolean(),
  port: z.number().int().min(1).max(65535).nullable(),
  mediaExportPath: z.string(),
  authRequired: z.literal(true),
  allowedOrigins: z.array(z.string()),
  securityMode: z.literal('strict-local-readonly')
}).strict()

export type HttpApiStatus = z.infer<typeof httpApiStatusSchema>
export type HttpApiTokenView = z.infer<typeof httpApiTokenViewSchema>

export interface HttpApiErrorPayload {
  success: false
  error: {
    code: string
    message: string
  }
}

export function normalizeHttpApiPort(value: unknown, fallback: number = DEFAULT_HTTP_API_PORT): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback
  }
  return parsed
}

export function normalizeOriginAllowlistEntry(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw || raw === '*') return null

  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

export function normalizeOriginAllowlist(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map((item) => normalizeOriginAllowlistEntry(item))
    .filter((item): item is string => Boolean(item))))
}

export function isOriginAllowed(origin: string | null | undefined, allowedOrigins: string[]): boolean {
  const normalizedOrigin = normalizeOriginAllowlistEntry(origin)
  if (!normalizedOrigin) return false
  return normalizeOriginAllowlist(allowedOrigins).includes(normalizedOrigin)
}

export function generateHttpApiToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

export function maskHttpApiToken(token: string | null | undefined): string | null {
  const normalized = String(token || '').trim()
  if (!normalized) return null
  if (normalized.length <= 8) {
    return '•'.repeat(normalized.length)
  }
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`
}

export function extractHttpApiToken(input: {
  authorization?: string | string[] | null
  tokenHeader?: string | string[] | null
}): string | null {
  const tokenHeader = Array.isArray(input.tokenHeader) ? input.tokenHeader[0] : input.tokenHeader
  const authorization = Array.isArray(input.authorization) ? input.authorization[0] : input.authorization

  if (tokenHeader && String(tokenHeader).trim()) {
    return String(tokenHeader).trim()
  }

  const normalizedAuthorization = String(authorization || '').trim()
  if (normalizedAuthorization) {
    const prefix = `${HTTP_API_AUTH_SCHEME} `
    if (normalizedAuthorization.startsWith(prefix)) {
      return normalizedAuthorization.slice(prefix.length).trim() || null
    }
  }

  return null
}

export function resolveMediaRequestPath(mediaBasePath: string, requestRelativePath: string): string | null {
  const basePath = path.resolve(mediaBasePath)
  let decoded: string

  try {
    decoded = decodeURIComponent(String(requestRelativePath || '').trim())
  } catch {
    return null
  }

  const normalized = path.posix.normalize(decoded.replace(/^\/+/, ''))
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('\0')) {
    return null
  }

  const resolvedPath = path.resolve(basePath, normalized)
  if (resolvedPath !== basePath && !resolvedPath.startsWith(`${basePath}${path.sep}`)) {
    return null
  }

  return resolvedPath
}
