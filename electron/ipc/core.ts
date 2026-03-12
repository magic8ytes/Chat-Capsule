import { app, dialog, ipcMain } from 'electron'
import { dirname, join, resolve, sep } from 'path'
import type { ConfigService } from '../services/config'
import { auditService, summarizePathForAudit } from '../services/auditService'
import { exportCardDiagnosticsService } from '../services/exportCardDiagnosticsService'
import { macProfileService } from '../services/macProfileService'
import { wcdbMacService } from '../services/wcdbMacService'
import { APP_SUPPORTED_ROUTES } from '../../shared/contracts/routes'
import { DEFAULT_HTTP_API_PORT } from '../../shared/contracts/http'
import { isTrustedExternalOpenUrl, normalizeExternalOpenUrl, normalizeLocalOpenPath } from '../../shared/contracts/shell'
import { isPublicConfigKey, validatePublicConfigValue } from '../../shared/contracts/config'
import { registerCoreProfileIpcHandlersOn } from './coreProfileHandlers'

interface CoreIpcContext {
  getConfigService: () => ConfigService | null
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const resolvedTarget = resolve(targetPath)
  const resolvedRoot = resolve(rootPath)
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${sep}`)
}

function resolveAllowedOpenRoots(getConfigService: () => ConfigService | null): string[] {
  const profile = macProfileService.getSummary()
  const profileSetup = macProfileService.getSetupInfo()
  const configService = getConfigService()

  return Array.from(new Set([
    profile.profilePath,
    dirname(profile.profilePath || profileSetup.defaultProfilePath),
    profileSetup.profileDirectory,
    profileSetup.managedProfilePath,
    profile.accountRoot,
    profile.dbStoragePath,
    profile.decryptedRoot,
    profile.cachePath,
    configService?.get('exportPath') as string | undefined,
    configService?.get('whisperModelDir') as string | undefined,
    join(app.getPath('documents'), 'ChatCapsule', 'models'),
    app.getPath('downloads')
  ].map((item) => String(item || '').trim()).filter(Boolean).map((item) => resolve(item))))
}

function isAllowedOpenPath(targetPath: string, getConfigService: () => ConfigService | null): boolean {
  return resolveAllowedOpenRoots(getConfigService).some((root) => isPathInsideRoot(targetPath, root))
}

function describeSensitivePath(targetPath: string, getConfigService: () => ConfigService | null): { kind: string; pathTail: string; parentTail?: string } | null {
  const normalizedTarget = String(targetPath || '').trim()
  if (!normalizedTarget) return null

  const profile = macProfileService.getSummary()
  const profileSetup = macProfileService.getSetupInfo()
  const configService = getConfigService()
  const candidates: Array<{ kind: string; value?: string | null }> = [
    { kind: 'mac_profile_json', value: profile.profilePath },
    { kind: 'mac_profile_dir', value: profileSetup.profileDirectory },
    { kind: 'account_root', value: profile.accountRoot },
    { kind: 'db_storage', value: profile.dbStoragePath },
    { kind: 'decrypted_root', value: profile.decryptedRoot },
    { kind: 'cache_path', value: profile.cachePath },
    { kind: 'export_path', value: configService?.get('exportPath') as string | undefined },
    { kind: 'model_dir', value: configService?.get('whisperModelDir') as string | undefined },
    { kind: 'model_dir_default', value: join(app.getPath('documents'), 'ChatCapsule', 'models', 'sensevoice') }
  ]

  for (const candidate of candidates) {
    const candidatePath = String(candidate.value || '').trim()
    if (!candidatePath) continue
    if (!isPathInsideRoot(normalizedTarget, candidatePath)) continue
    return {
      kind: candidate.kind,
      ...summarizePathForAudit(normalizedTarget)
    }
  }

  return null
}

export function registerCoreIpcHandlers({ getConfigService }: CoreIpcContext): void {
  ipcMain.handle('config:get', async (_, key: string) => {
    const normalizedKey = String(key || '').trim()
    if (!isPublicConfigKey(normalizedKey)) {
      throw new Error('不允许读取该配置项')
    }
    return getConfigService()?.get(normalizedKey as never)
  })

  ipcMain.handle('config:set', async (_, key: string, value: unknown) => {
    const normalizedKey = String(key || '').trim()
    if (!isPublicConfigKey(normalizedKey)) {
      throw new Error('不允许写入该配置项')
    }
    if (!validatePublicConfigValue(normalizedKey, value)) {
      throw new Error('配置项值不合法')
    }
    getConfigService()?.set(normalizedKey as never, value as never)
    return true
  })

  ipcMain.handle('dialog:openFile', async (_, options) => {
    const { dialog: electronDialog } = await import('electron')
    return electronDialog.showOpenDialog(options)
  })

  ipcMain.handle('dialog:openDirectory', async (_, options) => {
    const { dialog: electronDialog } = await import('electron')
    return electronDialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      ...options
    })
  })

  ipcMain.handle('dialog:saveFile', async (_, options) => {
    const { dialog: electronDialog } = await import('electron')
    return electronDialog.showSaveDialog(options)
  })

  ipcMain.handle('shell:openPath', async (_, path: string) => {
    const normalizedPath = normalizeLocalOpenPath(path)
    if (!normalizedPath) {
      auditService.record({
        event: 'shell_open_path_blocked',
        severity: 'warn',
        data: { reason: 'invalid_local_absolute_path' }
      })
      throw new Error('仅允许打开本地绝对路径')
    }

    if (!isAllowedOpenPath(normalizedPath, getConfigService)) {
      auditService.record({
        event: 'shell_open_path_blocked',
        severity: 'warn',
        data: {
          reason: 'path_outside_allowlist',
          ...summarizePathForAudit(normalizedPath)
        }
      })
      throw new Error('仅允许打开应用管理目录、导出目录、缓存目录和已登记的模型目录')
    }

    const sensitivePath = describeSensitivePath(normalizedPath, getConfigService)
    const { shell } = await import('electron')
    const result = await shell.openPath(normalizedPath)
    if (sensitivePath) {
      auditService.record({
        event: 'sensitive_path_opened',
        severity: result ? 'warn' : 'info',
        data: {
          ...sensitivePath,
          success: !result,
          error: result || undefined
        }
      })
    }
    return result
  })

  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    const normalizedUrl = normalizeExternalOpenUrl(url)
    if (!normalizedUrl) {
      auditService.record({
        event: 'shell_open_external_blocked',
        severity: 'warn',
        data: { reason: 'invalid_or_private_external_url' }
      })
      throw new Error('仅允许打开受信任的公网 http/https 外部链接')
    }

    if (!isTrustedExternalOpenUrl(normalizedUrl)) {
      const target = new URL(normalizedUrl)
      const result = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['继续打开', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: '打开外部链接',
        message: '即将打开外部站点',
        detail: `${target.hostname}\n\n${normalizedUrl}`
      })

      if (result.response !== 0) {
        auditService.record({
          event: 'shell_open_external_cancelled',
          severity: 'info',
          data: { hostname: target.hostname }
        })
        return undefined
      }

      auditService.record({
        event: 'shell_open_external_confirmed',
        severity: 'warn',
        data: { hostname: target.hostname }
      })
    }

    const { shell } = await import('electron')
    return shell.openExternal(normalizedUrl)
  })

  ipcMain.handle('app:getDownloadsPath', async () => {
    return app.getPath('downloads')
  })

  ipcMain.handle('app:getCapabilities', async () => {
    const macSummary = macProfileService.getSummary()
    const macProfileMode = process.platform === 'darwin' && macSummary.profileLoaded
    const readOnly = process.platform === 'darwin' ? macSummary.readOnly !== false : false

    return {
      platform: process.platform === 'darwin' ? 'macos' : process.platform,
      mode: macProfileMode ? 'mac-profile' : 'mac-unconfigured',
      readOnly,
      supportedRoutes: [...APP_SUPPORTED_ROUTES],
      sourceMode: macSummary.sourceMode,
      httpApi: {
        enabled: true,
        authRequired: true,
        defaultPort: DEFAULT_HTTP_API_PORT
      },
      messageMutation: false,
      snsMutation: false,
      rawSql: false,
      securityMode: 'strict-local-readonly' as const,
      profile: macSummary
    }
  })

  registerCoreProfileIpcHandlersOn(ipcMain, {
    macProfileService: {
      getSetupInfo: () => macProfileService.getSetupInfo(),
      getProfilePayload: () => macProfileService.getProfilePayload(),
      importProfileFromPath: (sourcePath: string) => macProfileService.importProfileFromPath(sourcePath, getConfigService()),
      exportProfileToPath: (targetPath: string) => macProfileService.exportProfileToPath(targetPath),
      exportProfileTemplateToPath: (targetPath: string) => macProfileService.exportProfileTemplateToPath(targetPath),
      createProfileFromPayload: (payload: unknown) => macProfileService.createProfileFromPayload(payload, getConfigService())
    },
    auditService,
    summarizePathForAudit
  })

  ipcMain.handle('app:probeMacProfile', async () => {
    if (process.platform !== 'darwin') {
      return {
        success: false,
        sourceMode: 'decrypted-sqlite' as const,
        probes: [],
        probedAt: Date.now(),
        error: '当前平台不是 macOS。'
      }
    }

    const result = await wcdbMacService.probeProfileDatabases()
    const failedProbes = (result.probes || []).filter((probe) => !probe.success)
    if (!result.success || failedProbes.length > 0) {
      auditService.record({
        event: 'mac_profile_probe_failed',
        severity: 'warn',
        data: {
          sourceMode: result.sourceMode,
          failedProbeCount: failedProbes.length,
          failedProbes: failedProbes.map((probe) => probe.relativePath),
          error: result.error || undefined
        }
      })
    }
    return result
  })

  ipcMain.handle('app:getVersion', async () => {
    return app.getVersion()
  })

  ipcMain.handle('diagnostics:getExportCardLogs', async (_, options?: { limit?: number }) => {
    return exportCardDiagnosticsService.snapshot(options?.limit)
  })

  ipcMain.handle('diagnostics:clearExportCardLogs', async () => {
    exportCardDiagnosticsService.clear()
    return { success: true }
  })

  ipcMain.handle('diagnostics:exportExportCardLogs', async (_, payload?: {
    filePath?: string
    frontendLogs?: unknown[]
  }) => {
    const filePath = typeof payload?.filePath === 'string' ? payload.filePath.trim() : ''
    if (!filePath) {
      return { success: false, error: '导出路径不能为空' }
    }
    return exportCardDiagnosticsService.exportCombinedLogs(filePath, payload?.frontendLogs || [])
  })
}
