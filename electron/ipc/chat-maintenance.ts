import { app, ipcMain } from 'electron'
import { existsSync } from 'fs'
import { readdir, rm } from 'fs/promises'
import { join } from 'path'
import type { ConfigService } from '../services/config'
import { macProfileService } from '../services/macProfileService'

interface CacheOperationResult {
  success: boolean
  error?: string
}

interface AnalyticsServiceLike {
  clearCache: () => Promise<CacheOperationResult>
}

interface ImageDecryptServiceLike {
  clearCache: () => Promise<CacheOperationResult>
}

interface ChatServiceLike {
  close: () => void
  clearCaches: (options?: {
    includeMessages?: boolean
    includeContacts?: boolean
    includeEmojis?: boolean
  }) => CacheOperationResult
}

interface WcdbServiceLike {
  close: () => void
}

interface ChatMaintenanceIpcContext {
  getConfigService: () => ConfigService | null
  wcdbService: WcdbServiceLike
  chatService: ChatServiceLike
  analyticsService: AnalyticsServiceLike
  imageDecryptService: ImageDecryptServiceLike
}

const normalizeAccountId = (value: string): string => {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (trimmed.toLowerCase().startsWith('wxid_')) {
    const match = trimmed.match(/^(wxid_[^_]+)/i)
    return match?.[1] || trimmed
  }
  const suffixMatch = trimmed.match(/^(.+)_([a-zA-Z0-9]{4})$/)
  return suffixMatch ? suffixMatch[1] : trimmed
}

const buildAccountNameMatcher = (wxidCandidates: string[]) => {
  const loweredCandidates = wxidCandidates
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
  return (name: string): boolean => {
    const loweredName = String(name || '').trim().toLowerCase()
    if (!loweredName) return false
    return loweredCandidates.some((candidate) => (
      loweredName === candidate ||
      loweredName.startsWith(`${candidate}_`) ||
      loweredName.includes(candidate)
    ))
  }
}

const removePathIfExists = async (
  targetPath: string,
  removedPaths: string[],
  warnings: string[]
): Promise<void> => {
  if (!targetPath || !existsSync(targetPath)) return
  try {
    await rm(targetPath, { recursive: true, force: true })
    removedPaths.push(targetPath)
  } catch (error) {
    warnings.push(`${targetPath}: ${String(error)}`)
  }
}

const removeMatchedEntriesInDir = async (
  rootDir: string,
  shouldRemove: (name: string) => boolean,
  removedPaths: string[],
  warnings: string[]
): Promise<void> => {
  if (!rootDir || !existsSync(rootDir)) return
  try {
    const entries = await readdir(rootDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!shouldRemove(entry.name)) continue
      const targetPath = join(rootDir, entry.name)
      await removePathIfExists(targetPath, removedPaths, warnings)
    }
  } catch (error) {
    warnings.push(`${rootDir}: ${String(error)}`)
  }
}

export function registerChatMaintenanceIpcHandlers({
  getConfigService,
  wcdbService,
  chatService,
  analyticsService,
  imageDecryptService
}: ChatMaintenanceIpcContext): void {
  ipcMain.handle('chat:clearCurrentAccountData', async (_, options?: { clearCache?: boolean; clearExports?: boolean; clearProfile?: boolean }) => {
    const cfg = getConfigService()
    if (!cfg) return { success: false, error: '配置服务未初始化' }

    const clearCache = options?.clearCache === true
    const clearExports = options?.clearExports === true
    const clearProfile = options?.clearProfile === true
    if (!clearCache && !clearExports && !clearProfile) {
      return { success: false, error: '请至少选择一项清理范围' }
    }

    const rawWxid = String(cfg.get('myWxid') || '').trim()
    if (!rawWxid) {
      return { success: false, error: '当前账号未登录或未识别，无法清理' }
    }
    const normalizedWxid = normalizeAccountId(rawWxid)
    const wxidCandidates = Array.from(new Set([rawWxid, normalizedWxid].filter(Boolean)))
    const isMatchedAccountName = buildAccountNameMatcher(wxidCandidates)
    const removedPaths: string[] = []
    const warnings: string[] = []

    try {
      wcdbService.close()
      chatService.close()
    } catch (error) {
      warnings.push(`关闭数据库连接失败: ${String(error)}`)
    }

    if (clearCache) {
      const [analyticsResult, imageResult] = await Promise.all([
        analyticsService.clearCache(),
        imageDecryptService.clearCache()
      ])
      const chatResult = chatService.clearCaches()
      const cleanupResults = [analyticsResult, imageResult, chatResult]
      for (const result of cleanupResults) {
        if (!result.success && result.error) warnings.push(result.error)
      }

      const configuredCachePath = String(cfg.get('cachePath') || '').trim()
      const documentsWeFlowDir = join(app.getPath('documents'), 'ChatCapsule')
      const userDataCacheDir = join(app.getPath('userData'), 'cache')
      const cacheRootCandidates = [
        configuredCachePath,
        join(documentsWeFlowDir, 'Images'),
        join(documentsWeFlowDir, 'Voices'),
        join(documentsWeFlowDir, 'Emojis'),
        userDataCacheDir
      ].filter(Boolean)

      for (const wxid of wxidCandidates) {
        if (configuredCachePath) {
          await removePathIfExists(join(configuredCachePath, wxid), removedPaths, warnings)
          await removePathIfExists(join(configuredCachePath, 'Images', wxid), removedPaths, warnings)
          await removePathIfExists(join(configuredCachePath, 'Voices', wxid), removedPaths, warnings)
          await removePathIfExists(join(configuredCachePath, 'Emojis', wxid), removedPaths, warnings)
        }
        await removePathIfExists(join(documentsWeFlowDir, 'Images', wxid), removedPaths, warnings)
        await removePathIfExists(join(documentsWeFlowDir, 'Voices', wxid), removedPaths, warnings)
        await removePathIfExists(join(documentsWeFlowDir, 'Emojis', wxid), removedPaths, warnings)
        await removePathIfExists(join(userDataCacheDir, wxid), removedPaths, warnings)
      }

      for (const cacheRoot of cacheRootCandidates) {
        await removeMatchedEntriesInDir(cacheRoot, isMatchedAccountName, removedPaths, warnings)
      }
    }

    if (clearExports) {
      const configuredExportPath = String(cfg.get('exportPath') || '').trim()
      const documentsWeFlowDir = join(app.getPath('documents'), 'ChatCapsule')
      const exportRootCandidates = [
        configuredExportPath,
        join(documentsWeFlowDir, 'exports'),
        join(documentsWeFlowDir, 'Exports')
      ].filter(Boolean)

      for (const exportRoot of exportRootCandidates) {
        await removeMatchedEntriesInDir(exportRoot, isMatchedAccountName, removedPaths, warnings)
      }

      const resetConfigKeys = [
        'exportSessionRecordMap',
        'exportLastSessionRunMap',
        'exportLastContentRunMap',
        'exportSessionMessageCountCacheMap',
        'exportSessionContentMetricCacheMap',
        'exportSnsStatsCacheMap',
        'snsPageCacheMap',
        'contactsListCacheMap',
        'contactsAvatarCacheMap',
        'lastSession'
      ]
      for (const key of resetConfigKeys) {
        const defaultValue = key === 'lastSession' ? '' : {}
        cfg.set(key as any, defaultValue as any)
      }
    }

    if (clearProfile) {
      try {
        const profilePath = macProfileService.getProfilePath()
        await removePathIfExists(profilePath, removedPaths, warnings)
        macProfileService.invalidate()
      } catch (error) {
        warnings.push(`删除 profile.json 失败: ${String(error)}`)
      }
    }

    if (clearCache || clearProfile) {
      try {
        const wxidConfigsRaw = cfg.get('wxidConfigs') as Record<string, any> | undefined
        if (wxidConfigsRaw && typeof wxidConfigsRaw === 'object') {
          const nextConfigs: Record<string, any> = { ...wxidConfigsRaw }
          for (const key of Object.keys(nextConfigs)) {
            if (isMatchedAccountName(key) || normalizeAccountId(key) === normalizedWxid) {
              delete nextConfigs[key]
            }
          }
          cfg.set('wxidConfigs' as any, nextConfigs as any)
        }
        cfg.set('myWxid' as any, '')
        cfg.set('decryptKey' as any, '')
        cfg.set('imageXorKey' as any, 0)
        cfg.set('imageAesKey' as any, '')
        cfg.set('dbPath' as any, '')
        cfg.set('lastOpenedDb' as any, '')
        cfg.set('onboardingDone' as any, false)
        cfg.set('lastSession' as any, '')
      } catch (error) {
        warnings.push(`清理账号配置失败: ${String(error)}`)
      }
    }

    return {
      success: true,
      removedPaths,
      warning: warnings.length > 0 ? warnings.join('; ') : undefined
    }
  })
}
