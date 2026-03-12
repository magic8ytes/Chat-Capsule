import { z } from 'zod'

const looseRecordSchema = z.record(z.string(), z.unknown())
const stringArraySchema = z.array(z.string())
const finiteNumberSchema = z.number().finite()

const wxidConfigEntrySchema = z.object({
  decryptKey: z.string().optional(),
  imageXorKey: finiteNumberSchema.optional(),
  imageAesKey: z.string().optional(),
  updatedAt: finiteNumberSchema.optional()
}).strict()

const exportDefaultMediaSchema = z.union([
  z.boolean(),
  z.object({
    images: z.boolean().optional(),
    videos: z.boolean().optional(),
    voices: z.boolean().optional(),
    emojis: z.boolean().optional()
  }).strict()
])

export const PUBLIC_CONFIG_SCHEMAS = {
  decryptKey: z.string(),
  dbPath: z.string(),
  myWxid: z.string(),
  wxidConfigs: z.record(z.string(), wxidConfigEntrySchema),
  theme: z.enum(['light', 'dark', 'system']),
  themeId: z.string(),
  lastSession: z.string(),
  cachePath: z.string(),
  exportPath: z.string(),
  agreementAccepted: z.boolean(),
  logEnabled: z.boolean(),
  llmModelPath: z.string(),
  whisperModelName: z.string(),
  whisperModelDir: z.string(),
  whisperDownloadSource: z.string(),
  onboardingDone: z.boolean(),
  autoTranscribeVoice: z.boolean(),
  transcribeLanguages: stringArraySchema,
  exportDefaultFormat: z.string(),
  exportDefaultAvatars: z.boolean(),
  exportDefaultDateRange: z.union([z.string(), looseRecordSchema]),
  exportDefaultMedia: exportDefaultMediaSchema,
  exportDefaultVoiceAsText: z.boolean(),
  exportDefaultExcelCompactColumns: z.boolean(),
  exportDefaultTxtColumns: stringArraySchema,
  exportDefaultConcurrency: finiteNumberSchema,
  exportWriteLayout: z.enum(['A', 'B', 'C']),
  exportSessionNamePrefixEnabled: z.boolean(),
  exportLastSessionRunMap: looseRecordSchema,
  exportLastContentRunMap: looseRecordSchema,
  exportSessionRecordMap: looseRecordSchema,
  exportLastSnsPostCount: finiteNumberSchema,
  exportSessionMessageCountCacheMap: looseRecordSchema,
  exportSessionContentMetricCacheMap: looseRecordSchema,
  exportSnsStatsCacheMap: looseRecordSchema,
  exportSnsUserPostCountsCacheMap: looseRecordSchema,
  snsPageCacheMap: looseRecordSchema,
  contactsLoadTimeoutMs: finiteNumberSchema,
  contactsListCacheMap: looseRecordSchema,
  contactsAvatarCacheMap: looseRecordSchema,
  authUseHello: z.boolean(),
} as const

export type PublicConfigKey = keyof typeof PUBLIC_CONFIG_SCHEMAS

export const PUBLIC_CONFIG_VALIDATORS: { [Key in PublicConfigKey]: (value: unknown) => boolean } = Object.fromEntries(
  Object.entries(PUBLIC_CONFIG_SCHEMAS).map(([key, schema]) => [
    key,
    (value: unknown) => schema.safeParse(value).success
  ])
) as { [Key in PublicConfigKey]: (value: unknown) => boolean }

export function isPublicConfigKey(value: string): value is PublicConfigKey {
  return Object.prototype.hasOwnProperty.call(PUBLIC_CONFIG_SCHEMAS, value)
}

export function validatePublicConfigValue(key: PublicConfigKey, value: unknown): boolean {
  return PUBLIC_CONFIG_SCHEMAS[key].safeParse(value).success
}
