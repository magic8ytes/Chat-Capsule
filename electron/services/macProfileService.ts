import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, isAbsolute, join, resolve } from 'path'
import type { MacDatabaseKeyEntry, MacProfile } from '../../shared/contracts/profile'
import { validateMacProfilePayload } from '../../shared/contracts/profile'
import { ConfigService } from './config'
import { isSqlcipherAvailable } from './sqlcipherSupport'

export type { MacDatabaseKeyEntry, MacProfile }

export interface ResolvedMacProfile extends MacProfile {
  profilePath: string
  decryptedRoot: string
  wxidClean: string
}

export interface MacProfileSummary {
  platform: 'macos'
  profilePath: string
  profileLoaded: boolean
  sourceMode: 'encrypted-sqlcipher' | 'decrypted-sqlite'
  error?: string
  wxid?: string
  accountRoot?: string
  dbStoragePath?: string
  cachePath?: string
  decryptedRoot?: string
  readOnly?: boolean
  databaseKeyCount?: number
  accountRootExists?: boolean
  dbStoragePathExists?: boolean
  decryptedRootExists?: boolean
  sqlcipherAvailable?: boolean
}

export interface MacProfileSetupInfo {
  defaultProfilePath: string
  managedProfilePath: string
  profileDirectory: string
  isPackaged: boolean
  resolutionMode: 'env-override' | 'managed-user-data' | 'development-project-root'
}

export interface ImportMacProfileResult {
  success: boolean
  profilePath?: string
  error?: string
}

export interface ExportMacProfileResult {
  success: boolean
  profilePath?: string
  error?: string
}

export interface CreateMacProfileResult {
  success: boolean
  profilePath?: string
  error?: string
}

export interface GetMacProfileResult {
  success: boolean
  profile?: MacProfile
  error?: string
}
type CachedResult =
  | { success: true; profile: ResolvedMacProfile }
  | { success: false; error: string }

function buildProfileTemplate(profile?: MacProfile): Record<string, unknown> {
  if (profile) {
    const databaseKeys = Object.fromEntries(
      Object.entries(profile.databaseKeys || {}).map(([path, entry]) => ([
        path,
        {
          enc_key: entry.enc_key,
          salt: entry.salt
        }
      ]))
    )

    return {
      schemaVersion: profile.schemaVersion,
      accountRoot: profile.accountRoot,
      dbStoragePath: profile.dbStoragePath,
      wxid: profile.wxid,
      databaseKeys,
      imageXorKey: profile.imageXorKey,
      imageAesKey: profile.imageAesKey,
      cachePath: profile.cachePath
    }
  }

  return {
    schemaVersion: 1,
    accountRoot: '/Users/yourname/Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/Account/example-account',
    dbStoragePath: '/Users/yourname/Documents/WeChatData/db_storage',
    wxid: 'wxid_example',
    databaseKeys: {
      'bizchat/bizchat.db': {
        enc_key: 'replace-with-bizchat-enc-key',
        salt: 'replace-with-bizchat-salt'
      },
      'contact/contact.db': {
        enc_key: 'replace-with-contact-enc-key',
        salt: 'replace-with-contact-salt'
      },
      'contact/contact_fts.db': {
        enc_key: 'replace-with-contact-fts-enc-key',
        salt: 'replace-with-contact-fts-salt'
      },
      'emoticon/emoticon.db': {
        enc_key: 'replace-with-emoticon-enc-key',
        salt: 'replace-with-emoticon-salt'
      },
      'favorite/favorite.db': {
        enc_key: 'replace-with-favorite-enc-key',
        salt: 'replace-with-favorite-salt'
      },
      'favorite/favorite_fts.db': {
        enc_key: 'replace-with-favorite-fts-enc-key',
        salt: 'replace-with-favorite-fts-salt'
      },
      'general/general.db': {
        enc_key: 'replace-with-general-enc-key',
        salt: 'replace-with-general-salt'
      },
      'hardlink/hardlink.db': {
        enc_key: 'replace-with-hardlink-enc-key',
        salt: 'replace-with-hardlink-salt'
      },
      'head_image/head_image.db': {
        enc_key: 'replace-with-head-image-enc-key',
        salt: 'replace-with-head-image-salt'
      },
      'message/biz_message_0.db': {
        enc_key: 'replace-with-biz-message-0-enc-key',
        salt: 'replace-with-biz-message-0-salt'
      },
      'message/biz_message_1.db': {
        enc_key: 'replace-with-biz-message-1-enc-key',
        salt: 'replace-with-biz-message-1-salt'
      },
      'message/media_0.db': {
        enc_key: 'replace-with-media-0-enc-key',
        salt: 'replace-with-media-0-salt'
      },
      'message/message_0.db': {
        enc_key: 'replace-with-message-0-enc-key',
        salt: 'replace-with-message-0-salt'
      },
      'message/message_1.db': {
        enc_key: 'replace-with-message-1-enc-key',
        salt: 'replace-with-message-1-salt'
      },
      'message/message_2.db': {
        enc_key: 'replace-with-message-2-enc-key',
        salt: 'replace-with-message-2-salt'
      },
      'message/message_3.db': {
        enc_key: 'replace-with-message-3-enc-key',
        salt: 'replace-with-message-3-salt'
      },
      'message/message_4.db': {
        enc_key: 'replace-with-message-4-enc-key',
        salt: 'replace-with-message-4-salt'
      },
      'message/message_5.db': {
        enc_key: 'replace-with-message-5-enc-key',
        salt: 'replace-with-message-5-salt'
      },
      'message/message_6.db': {
        enc_key: 'replace-with-message-6-enc-key',
        salt: 'replace-with-message-6-salt'
      },
      'message/message_7.db': {
        enc_key: 'replace-with-message-7-enc-key',
        salt: 'replace-with-message-7-salt'
      },
      'message/message_fts.db': {
        enc_key: 'replace-with-message-fts-enc-key',
        salt: 'replace-with-message-fts-salt'
      },
      'message/message_resource.db': {
        enc_key: 'replace-with-message-resource-enc-key',
        salt: 'replace-with-message-resource-salt'
      },
      'migrate/unspportmsg.db': {
        enc_key: 'replace-with-unspportmsg-enc-key',
        salt: 'replace-with-unspportmsg-salt'
      },
      'session/session.db': {
        enc_key: 'replace-with-session-enc-key',
        salt: 'replace-with-session-salt'
      },
      'sns/sns.db': {
        enc_key: 'replace-with-sns-enc-key',
        salt: 'replace-with-sns-salt'
      },
      'solitaire/solitaire.db': {
        enc_key: 'replace-with-solitaire-enc-key',
        salt: 'replace-with-solitaire-salt'
      }
    },
    imageXorKey: 95,
    imageAesKey: 'replace-with-image-aes-key',
    cachePath: '/Users/yourname/Documents/WechatHistoryManager/ChatCapsule/.cache/chat-capsule'
  }
}

function cleanWxid(value: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (trimmed.toLowerCase().startsWith('wxid_')) {
    const match = trimmed.match(/^(wxid_[^_]+)/i)
    return match?.[1] || trimmed
  }
  const suffixMatch = trimmed.match(/^(.+)_([a-zA-Z0-9]{4})$/)
  return suffixMatch ? suffixMatch[1] : trimmed
}

function resolveSourceMode(dbStoragePath: string): 'encrypted-sqlcipher' | 'decrypted-sqlite' {
  return isSqlcipherAvailable() && existsSync(dbStoragePath)
    ? 'encrypted-sqlcipher'
    : 'decrypted-sqlite'
}

function resolveMacFallbackPath(name: 'appData' | 'userData'): string {
  const homePath = process.env.HOME || homedir()
  const appDataPath = join(homePath, 'Library', 'Application Support')
  if (name === 'appData') return appDataPath
  return join(appDataPath, 'ChatCapsule')
}

function getElectronPath(name: 'appData' | 'userData'): string {
  const envKey = name === 'appData' ? 'CHATCAPSULE_APP_DATA_PATH' : 'CHATCAPSULE_USER_DATA_PATH'
  const legacyEnvKey = name === 'appData' ? 'WEFLOW_APP_DATA_PATH' : 'WEFLOW_USER_DATA_PATH'
  const envValue = String(process.env[envKey] || process.env[legacyEnvKey] || '').trim()
  if (envValue) return envValue

  const electronApp = app as typeof app | undefined
  if (electronApp && typeof electronApp.getPath === 'function') {
    try {
      return electronApp.getPath(name)
    } catch {
      // ignore and fallback below
    }
  }
  return resolveMacFallbackPath(name)
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveConfiguredProfilePath(): string | null {
  const injectedProfilePath = String(process.env.CHATCAPSULE_MAC_PROFILE_PATH || process.env.WEFLOW_MAC_PROFILE_PATH || '').trim()
  if (!injectedProfilePath) return null
  return isAbsolute(injectedProfilePath)
    ? injectedProfilePath
    : resolve(process.cwd(), injectedProfilePath)
}

function isPackagedAppBuild(): boolean {
  const electronApp = app as typeof app | undefined
  return Boolean(electronApp?.isPackaged)
}

function getManagedProfilePath(): string {
  return resolve(getElectronPath('userData'), 'profile.json')
}

function getProjectProfilePath(): string {
  return resolve(process.cwd(), 'profile.json')
}

function getProfileCandidatePaths(): string[] {
  const injectedProfilePath = resolveConfiguredProfilePath()
  if (injectedProfilePath) return [injectedProfilePath]

  const projectProfilePath = getProjectProfilePath()
  if (isPackagedAppBuild()) {
    return [getManagedProfilePath(), projectProfilePath]
  }
  return [projectProfilePath]
}

function getDefaultProfilePath(): string {
  return getProfileCandidatePaths()[0]
}

function getDefaultCachePath(): string {
  return join(getElectronPath('userData'), 'cache')
}

class MacProfileService {
  private cached: CachedResult | null = null

  isSupportedPlatform(): boolean {
    return process.platform === 'darwin'
  }

  getManagedProfilePath(): string {
    return getManagedProfilePath()
  }

  getSetupInfo(): MacProfileSetupInfo {
    const configuredProfilePath = resolveConfiguredProfilePath()
    const defaultProfilePath = getDefaultProfilePath()

    return {
      defaultProfilePath,
      managedProfilePath: getManagedProfilePath(),
      profileDirectory: dirname(defaultProfilePath),
      isPackaged: isPackagedAppBuild(),
      resolutionMode: configuredProfilePath
        ? 'env-override'
        : (isPackagedAppBuild() ? 'managed-user-data' : 'development-project-root')
    }
  }

  getProfilePath(): string {
    const candidatePaths = getProfileCandidatePaths()

    for (const candidatePath of candidatePaths) {
      if (existsSync(candidatePath)) return candidatePath
    }

    return candidatePaths[0]
  }

  invalidate(): void {
    this.cached = null
  }

  loadProfile(): CachedResult {
    this.cached = null

    if (!this.isSupportedPlatform()) {
      this.cached = { success: false, error: '当前平台不是 macOS' }
      return this.cached
    }

    const profilePath = this.getProfilePath()
    if (!existsSync(profilePath)) {
      const candidates = getProfileCandidatePaths().join('、')
      this.cached = { success: false, error: `未找到 macOS profile.json，已检查：${candidates}` }
      return this.cached
    }

    try {
      const rawText = readFileSync(profilePath, 'utf8')
      const parsed = JSON.parse(rawText) as unknown
      const validation = validateMacProfilePayload(parsed, {
        defaultCachePath: getDefaultCachePath()
      })
      if (!validation.success) {
        this.cached = { success: false, error: validation.error }
        return this.cached
      }

      const profile: ResolvedMacProfile = {
        ...validation.profile,
        profilePath,
        decryptedRoot: '',
        wxidClean: ''
      }

      profile.wxidClean = cleanWxid(profile.wxid)
      profile.decryptedRoot = this.resolveDecryptedRoot(profile)
      this.cached = { success: true, profile }
      return this.cached
    } catch (error) {
      this.cached = { success: false, error: normalizeErrorMessage(error) }
      return this.cached
    }
  }

  getSummary(): MacProfileSummary {
    const result = this.loadProfile()
    const profilePath = this.getProfilePath()
    if (!result.success) {
      return {
        platform: 'macos',
        profilePath,
        profileLoaded: false,
        sourceMode: 'decrypted-sqlite',
        error: result.error,
        sqlcipherAvailable: isSqlcipherAvailable()
      }
    }

    const { profile } = result
    return {
      platform: 'macos',
      profilePath,
      profileLoaded: true,
      sourceMode: resolveSourceMode(profile.dbStoragePath),
      wxid: profile.wxid,
      accountRoot: profile.accountRoot,
      dbStoragePath: profile.dbStoragePath,
      cachePath: profile.cachePath,
      decryptedRoot: profile.decryptedRoot,
      readOnly: profile.readOnly,
      databaseKeyCount: Object.keys(profile.databaseKeys).length,
      accountRootExists: existsSync(profile.accountRoot),
      dbStoragePathExists: existsSync(profile.dbStoragePath),
      decryptedRootExists: existsSync(profile.decryptedRoot),
      sqlcipherAvailable: isSqlcipherAvailable()
    }
  }

  hasUsableProfile(): boolean {
    const result = this.loadProfile()
    if (!result.success) return false

    const accountRootExists = existsSync(result.profile.accountRoot)
    const encryptedReady = isSqlcipherAvailable() && existsSync(result.profile.dbStoragePath)
    const decryptedReady = existsSync(result.profile.decryptedRoot)
    return accountRootExists && (encryptedReady || decryptedReady)
  }

  async exportProfileToPath(targetPath: string): Promise<ExportMacProfileResult> {
    if (!this.isSupportedPlatform()) {
      return { success: false, error: '当前平台不是 macOS' }
    }

    const result = this.loadProfile()
    if (!result.success) {
      return { success: false, error: result.error }
    }

    const normalizedTargetPath = isAbsolute(targetPath)
      ? resolve(targetPath)
      : resolve(process.cwd(), targetPath)

    const { profile } = result
    const exportPayload: MacProfile = {
      schemaVersion: profile.schemaVersion,
      platform: profile.platform,
      accountRoot: profile.accountRoot,
      dbStoragePath: profile.dbStoragePath,
      wxid: profile.wxid,
      databaseKeys: profile.databaseKeys,
      imageXorKey: profile.imageXorKey,
      imageAesKey: profile.imageAesKey,
      cachePath: profile.cachePath,
      readOnly: profile.readOnly
    }

    try {
      await mkdir(dirname(normalizedTargetPath), { recursive: true })
      await writeFile(normalizedTargetPath, `${JSON.stringify(exportPayload, null, 2)}\n`, 'utf8')
      return { success: true, profilePath: normalizedTargetPath }
    } catch (error) {
      return { success: false, error: normalizeErrorMessage(error) }
    }
  }

  async exportProfileTemplateToPath(targetPath: string): Promise<ExportMacProfileResult> {
    if (!this.isSupportedPlatform()) {
      return { success: false, error: '当前平台不是 macOS' }
    }

    const normalizedTargetPath = isAbsolute(targetPath)
      ? resolve(targetPath)
      : resolve(process.cwd(), targetPath)

    const loaded = this.loadProfile()
    const exportPayload = buildProfileTemplate(loaded.success ? loaded.profile : undefined)

    try {
      await mkdir(dirname(normalizedTargetPath), { recursive: true })
      await writeFile(normalizedTargetPath, `${JSON.stringify(exportPayload, null, 2)}\n`, 'utf8')
      return { success: true, profilePath: normalizedTargetPath }
    } catch (error) {
      return { success: false, error: normalizeErrorMessage(error) }
    }
  }

  getProfilePayload(): GetMacProfileResult {
    const result = this.loadProfile()
    if (!result.success) {
      return { success: false, error: result.error }
    }

    const { profile } = result
    return {
      success: true,
      profile: {
        schemaVersion: profile.schemaVersion,
        platform: profile.platform,
        accountRoot: profile.accountRoot,
        dbStoragePath: profile.dbStoragePath,
        wxid: profile.wxid,
        databaseKeys: profile.databaseKeys,
        imageXorKey: profile.imageXorKey,
        imageAesKey: profile.imageAesKey,
        cachePath: profile.cachePath,
        readOnly: profile.readOnly
      }
    }
  }

  async createProfileFromPayload(payload: unknown, configService?: ConfigService | null): Promise<CreateMacProfileResult> {
    if (!this.isSupportedPlatform()) {
      return { success: false, error: '当前平台不是 macOS' }
    }

    const validation = validateMacProfilePayload(payload, {
      defaultCachePath: getDefaultCachePath()
    })
    if (!validation.success) {
      return { success: false, error: validation.error }
    }

    const targetProfilePath = getDefaultProfilePath()
    try {
      await mkdir(dirname(targetProfilePath), { recursive: true })
      await writeFile(targetProfilePath, `${JSON.stringify(validation.profile, null, 2)}\n`, 'utf8')

      this.invalidate()
      if (configService) {
        this.syncCompatibilityConfig(configService)
      }

      return { success: true, profilePath: targetProfilePath }
    } catch (error) {
      return { success: false, error: normalizeErrorMessage(error) }
    }
  }

  async importProfileFromPath(sourcePath: string, configService?: ConfigService | null): Promise<ImportMacProfileResult> {
    if (!this.isSupportedPlatform()) {
      return { success: false, error: '当前平台不是 macOS' }
    }

    const normalizedSourcePath = isAbsolute(sourcePath)
      ? resolve(sourcePath)
      : resolve(process.cwd(), sourcePath)

    try {
      const rawText = await readFile(normalizedSourcePath, 'utf8')
      const parsed = JSON.parse(rawText) as unknown
      const validation = validateMacProfilePayload(parsed, {
        defaultCachePath: getDefaultCachePath()
      })
      if (!validation.success) {
        return { success: false, error: validation.error }
      }

      const targetProfilePath = getDefaultProfilePath()
      await mkdir(dirname(targetProfilePath), { recursive: true })
      await writeFile(targetProfilePath, `${JSON.stringify(validation.profile, null, 2)}\n`, 'utf8')

      this.invalidate()
      if (configService) {
        this.syncCompatibilityConfig(configService)
      }

      return { success: true, profilePath: targetProfilePath }
    } catch (error) {
      return { success: false, error: normalizeErrorMessage(error) }
    }
  }

  syncCompatibilityConfig(configService: ConfigService): void {
    const result = this.loadProfile()
    if (!result.success) return

    const { profile } = result
    const compatibilityDecryptKey = profile.databaseKeys['session/session.db']?.enc_key
      || Object.values(profile.databaseKeys)[0]?.enc_key
      || ''

    mkdirSync(profile.cachePath, { recursive: true })
    configService.set('dbPath', profile.accountRoot)
    configService.set('myWxid', profile.wxid)
    configService.set('decryptKey', compatibilityDecryptKey)
    configService.set('imageXorKey', profile.imageXorKey)
    configService.set('imageAesKey', profile.imageAesKey)
    configService.set('cachePath', profile.cachePath)
    configService.set('onboardingDone', true)

    const existingWxidConfigs = configService.get('wxidConfigs')
    const nextWxidConfigs = {
      ...existingWxidConfigs,
      [profile.wxid]: {
        ...(existingWxidConfigs[profile.wxid] || {}),
        decryptKey: compatibilityDecryptKey,
        imageXorKey: profile.imageXorKey,
        imageAesKey: profile.imageAesKey,
        updatedAt: Date.now()
      }
    }
    configService.set('wxidConfigs', nextWxidConfigs)
  }

  private resolveDecryptedRoot(profile: Pick<MacProfile, 'accountRoot'>): string {
    const accountRootDir = dirname(profile.accountRoot)
    const candidates = [
      join(accountRootDir, 'decrypted'),
      join(dirname(accountRootDir), 'decrypted')
    ]

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }

    return candidates[0]
  }
}

export const macProfileService = new MacProfileService()
