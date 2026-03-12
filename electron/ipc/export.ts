import { ipcMain } from 'electron'
import type { ExportOptions, ExportProgress } from '../services/exportService'

interface ContactExportOptions {
  format: 'json' | 'csv' | 'vcf'
  exportAvatars: boolean
  contactTypes: {
    friends: boolean
    groups: boolean
    officials: boolean
  }
  selectedUsernames?: string[]
}

interface ExportServiceLike {
  getExportStats: (sessionIds: string[], options: ExportOptions) => Promise<unknown>
  exportSessions: (
    sessionIds: string[],
    outputDir: string,
    options: ExportOptions,
    onProgress: (progress: ExportProgress) => void
  ) => Promise<unknown>
  exportSessionToChatLab: (sessionId: string, outputPath: string, options: ExportOptions) => Promise<unknown>
}

interface ContactExportServiceLike {
  exportContacts: (outputDir: string, options: ContactExportOptions) => Promise<unknown>
}

interface ExportIpcContext {
  exportService: ExportServiceLike
  contactExportService: ContactExportServiceLike
}

export function registerExportIpcHandlers({ exportService, contactExportService }: ExportIpcContext): void {
  ipcMain.handle('export:getExportStats', async (_, sessionIds: string[], options: ExportOptions) => {
    return exportService.getExportStats(sessionIds, options)
  })

  ipcMain.handle('export:exportSessions', async (event, sessionIds: string[], outputDir: string, options: ExportOptions) => {
    const onProgress = (progress: ExportProgress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('export:progress', progress)
      }
    }

    return exportService.exportSessions(sessionIds, outputDir, options, onProgress)
  })

  ipcMain.handle('export:exportSession', async (_, sessionId: string, outputPath: string, options: ExportOptions) => {
    return exportService.exportSessionToChatLab(sessionId, outputPath, options)
  })

  ipcMain.handle('export:exportContacts', async (_, outputDir: string, options: ContactExportOptions) => {
    return contactExportService.exportContacts(outputDir, options)
  })
}
