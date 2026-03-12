import { ipcMain } from 'electron'

interface AnalyticsServiceLike {
  getOverallStatistics: (force?: boolean) => Promise<unknown>
  getContactRankings: (limit?: number, beginTimestamp?: number, endTimestamp?: number) => Promise<unknown>
  getTimeDistribution: () => Promise<unknown>
  getExcludedUsernames: () => Promise<unknown>
  setExcludedUsernames: (usernames: string[]) => Promise<unknown>
  getExcludeCandidates: () => Promise<unknown>
}

interface AnalyticsIpcContext {
  analyticsService: AnalyticsServiceLike
}

export function registerAnalyticsIpcHandlers({ analyticsService }: AnalyticsIpcContext): void {
  ipcMain.handle('analytics:getOverallStatistics', async (_, force?: boolean) => {
    return analyticsService.getOverallStatistics(force)
  })

  ipcMain.handle('analytics:getContactRankings', async (_, limit?: number, beginTimestamp?: number, endTimestamp?: number) => {
    return analyticsService.getContactRankings(limit, beginTimestamp, endTimestamp)
  })

  ipcMain.handle('analytics:getTimeDistribution', async () => {
    return analyticsService.getTimeDistribution()
  })

  ipcMain.handle('analytics:getExcludedUsernames', async () => {
    return analyticsService.getExcludedUsernames()
  })

  ipcMain.handle('analytics:setExcludedUsernames', async (_, usernames: string[]) => {
    return analyticsService.setExcludedUsernames(usernames)
  })

  ipcMain.handle('analytics:getExcludeCandidates', async () => {
    return analyticsService.getExcludeCandidates()
  })
}
