import { normalizeLocalOpenPath } from '../../shared/contracts/shell.ts'

export interface IpcMainHandleLike {
  handle: (channel: string, listener: (...args: unknown[]) => unknown) => void
}

export interface ProfileSetupInfoLike {
  defaultProfilePath: string
  managedProfilePath: string
  profileDirectory: string
  isPackaged: boolean
  resolutionMode: 'env-override' | 'managed-user-data' | 'development-project-root'
}

export interface ProfileTransferResultLike {
  success: boolean
  profilePath?: string
  error?: string
}

export interface ProfilePayloadResultLike {
  success: boolean
  profile?: unknown
  error?: string
}

export interface MacProfileServiceLike {
  getSetupInfo: () => ProfileSetupInfoLike
  getProfilePayload: () => ProfilePayloadResultLike
  importProfileFromPath: (sourcePath: string) => Promise<ProfileTransferResultLike>
  exportProfileToPath: (targetPath: string) => Promise<ProfileTransferResultLike>
  exportProfileTemplateToPath: (targetPath: string) => Promise<ProfileTransferResultLike>
  createProfileFromPayload: (payload: unknown) => Promise<ProfileTransferResultLike>
}

export interface AuditServiceLike {
  record: (event: { event: string; severity?: 'info' | 'warn' | 'error'; data?: Record<string, unknown> }) => void
}

export interface CoreProfileIpcContext {
  macProfileService: MacProfileServiceLike
  auditService: AuditServiceLike
  summarizePathForAudit: (targetPath: string) => Record<string, unknown>
}

export function registerCoreProfileIpcHandlersOn(
  ipcMainLike: IpcMainHandleLike,
  { macProfileService, auditService, summarizePathForAudit }: CoreProfileIpcContext
): void {
  ipcMainLike.handle(
    'app:getMacProfileSetup',
    (async (): Promise<ProfileSetupInfoLike> => macProfileService.getSetupInfo()) as (...args: unknown[]) => Promise<ProfileSetupInfoLike>
  )

  ipcMainLike.handle(
    'app:getMacProfile',
    (async (): Promise<ProfilePayloadResultLike> => macProfileService.getProfilePayload()) as (...args: unknown[]) => Promise<ProfilePayloadResultLike>
  )

  ipcMainLike.handle(
    'app:importMacProfile',
    ((async (_event: unknown, sourcePath: string): Promise<ProfileTransferResultLike> => {
      const normalizedSourcePath = normalizeLocalOpenPath(sourcePath)
      if (!normalizedSourcePath) {
        return { success: false, error: '请选择本地 profile.json 文件' }
      }

      const result = await macProfileService.importProfileFromPath(normalizedSourcePath)
      auditService.record({
        event: result.success ? 'mac_profile_imported' : 'mac_profile_import_failed',
        severity: result.success ? 'info' : 'warn',
        data: {
          sourcePath: summarizePathForAudit(normalizedSourcePath),
          profilePath: result.profilePath ? summarizePathForAudit(result.profilePath) : undefined,
          error: result.error || undefined
        }
      })
      return result
    }) as unknown) as (...args: unknown[]) => Promise<ProfileTransferResultLike>
  )

  ipcMainLike.handle(
    'app:exportMacProfile',
    ((async (_event: unknown, targetPath: string): Promise<ProfileTransferResultLike> => {
      const normalizedTargetPath = normalizeLocalOpenPath(targetPath)
      if (!normalizedTargetPath) {
        return { success: false, error: '请选择合法的导出路径' }
      }

      const result = await macProfileService.exportProfileToPath(normalizedTargetPath)
      auditService.record({
        event: result.success ? 'mac_profile_exported' : 'mac_profile_export_failed',
        severity: result.success ? 'info' : 'warn',
        data: {
          profilePath: result.profilePath ? summarizePathForAudit(result.profilePath) : summarizePathForAudit(normalizedTargetPath),
          error: result.error || undefined
        }
      })
      return result
    }) as unknown) as (...args: unknown[]) => Promise<ProfileTransferResultLike>
  )

  ipcMainLike.handle(
    'app:exportMacProfileTemplate',
    ((async (_event: unknown, targetPath: string): Promise<ProfileTransferResultLike> => {
      const normalizedTargetPath = normalizeLocalOpenPath(targetPath)
      if (!normalizedTargetPath) {
        return { success: false, error: '请选择合法的导出路径' }
      }

      const result = await macProfileService.exportProfileTemplateToPath(normalizedTargetPath)
      auditService.record({
        event: result.success ? 'mac_profile_template_exported' : 'mac_profile_template_export_failed',
        severity: result.success ? 'info' : 'warn',
        data: {
          profilePath: result.profilePath ? summarizePathForAudit(result.profilePath) : summarizePathForAudit(normalizedTargetPath),
          error: result.error || undefined
        }
      })
      return result
    }) as unknown) as (...args: unknown[]) => Promise<ProfileTransferResultLike>
  )

  ipcMainLike.handle(
    'app:createMacProfile',
    ((async (_event: unknown, payload: unknown): Promise<ProfileTransferResultLike> => {
      const result = await macProfileService.createProfileFromPayload(payload)
      auditService.record({
        event: result.success ? 'mac_profile_created' : 'mac_profile_create_failed',
        severity: result.success ? 'info' : 'warn',
        data: {
          profilePath: result.profilePath ? summarizePathForAudit(result.profilePath) : undefined,
          error: result.error || undefined
        }
      })
      return result
    }) as unknown) as (...args: unknown[]) => Promise<ProfileTransferResultLike>
  )
}
