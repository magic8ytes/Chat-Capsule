import path from 'path'
import { z } from 'zod'

export const MAC_PROFILE_SCHEMA_VERSION = 1

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeAbsolutePath(fieldName: string, value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) {
    throw new Error(`profile.${fieldName} 为空`)
  }
  if (raw.includes('\0')) {
    throw new Error(`profile.${fieldName} 包含非法空字符`)
  }
  const normalized = path.resolve(raw)
  if (!path.isAbsolute(normalized)) {
    throw new Error(`profile.${fieldName} 必须为绝对路径`)
  }
  return normalized
}

function normalizeDatabaseKeyPath(relativePath: string): string {
  const raw = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const normalized = path.posix.normalize(raw)
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('\0')) {
    throw new Error(`profile.databaseKeys 包含非法相对路径: ${relativePath}`)
  }
  return normalized
}

const schemaVersionField = z.unknown().optional().transform((value, context) => {
  if (value === undefined || value === null || value === '') {
    return MAC_PROFILE_SCHEMA_VERSION
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed !== MAC_PROFILE_SCHEMA_VERSION) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `profile.schemaVersion 必须为 ${MAC_PROFILE_SCHEMA_VERSION}`
    })
    return z.NEVER
  }
  return parsed
})

const platformField = z.unknown().optional().transform((value, context) => {
  const platformValue = value == null ? 'macos' : String(value).trim()
  if (platformValue !== 'macos') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `profile.platform 必须为 macos，当前为 ${platformValue || '空值'}`
    })
    return z.NEVER
  }
  return 'macos' as const
})

const nonEmptyStringField = (fieldName: string) => z.unknown().transform((value, context) => {
  const normalized = String(value || '').trim()
  if (!normalized) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `profile.${fieldName} 为空`
    })
    return z.NEVER
  }
  return normalized
})

const absolutePathField = (fieldName: string) => z.unknown().transform((value, context) => {
  try {
    return normalizeAbsolutePath(fieldName, value)
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: normalizeErrorMessage(error)
    })
    return z.NEVER
  }
})

const imageXorKeyField = z.unknown().transform((value, context) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'profile.imageXorKey 无效'
    })
    return z.NEVER
  }
  return parsed
})

const readOnlyField = z.unknown().optional().transform((value, context) => {
  if (value === undefined || value === null || value === true) {
    return true as const
  }
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'profile.readOnly 必须为 true'
  })
  return z.NEVER
})

export const macDatabaseKeyEntrySchema = z.object({
  enc_key: z.string().trim().min(1, 'profile.databaseKeys[*].enc_key 为空'),
  salt: z.string().trim().min(1, 'profile.databaseKeys[*].salt 为空'),
  size_mb: z.unknown().optional().transform((value, context) => {
    const parsed = value === undefined || value === null || value === '' ? 0 : Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'profile.databaseKeys[*].size_mb 无效'
      })
      return z.NEVER
    }
    return parsed
  })
}).strict()

export const macDatabaseKeysSchema = z.record(z.string(), macDatabaseKeyEntrySchema)
  .superRefine((entries, context) => {
    if (Object.keys(entries).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'profile.databaseKeys 不能为空'
      })
      return
    }

    for (const relativePath of Object.keys(entries)) {
      try {
        normalizeDatabaseKeyPath(relativePath)
      } catch (error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: normalizeErrorMessage(error)
        })
      }
    }
  })
  .transform((entries) => Object.fromEntries(
    Object.entries(entries).map(([relativePath, entry]) => [normalizeDatabaseKeyPath(relativePath), entry])
  ))

export const macProfileSchema = z.object({
  schemaVersion: schemaVersionField,
  platform: platformField,
  accountRoot: absolutePathField('accountRoot'),
  dbStoragePath: absolutePathField('dbStoragePath'),
  wxid: nonEmptyStringField('wxid'),
  databaseKeys: macDatabaseKeysSchema,
  imageXorKey: imageXorKeyField,
  imageAesKey: nonEmptyStringField('imageAesKey'),
  cachePath: absolutePathField('cachePath'),
  readOnly: readOnlyField
}).strict()

export type MacDatabaseKeyEntry = z.infer<typeof macDatabaseKeyEntrySchema>
export type MacProfile = z.infer<typeof macProfileSchema>

export function validateMacProfilePayload(raw: unknown, options: { defaultCachePath: string }): { success: true; profile: MacProfile } | { success: false; error: string } {
  const payload = raw && typeof raw === 'object'
    ? { ...(raw as Record<string, unknown>), cachePath: (raw as Record<string, unknown>).cachePath ?? options.defaultCachePath }
    : raw

  const result = macProfileSchema.safeParse(payload)
  if (!result.success) {
    const firstIssue = result.error.issues[0]
    return {
      success: false,
      error: firstIssue?.message || 'profile.json 校验失败'
    }
  }

  return { success: true, profile: result.data }
}
