import { ipcMain } from 'electron'

interface GroupMembersPanelOptions {
  forceRefresh?: boolean
  includeMessageCounts?: boolean
}

interface GroupAnalyticsServiceLike {
  getGroupChats: () => Promise<unknown>
  getGroupMembers: (chatroomId: string) => Promise<unknown>
  getGroupMembersPanelData: (chatroomId: string, options?: GroupMembersPanelOptions) => Promise<unknown>
  getGroupMessageRanking: (chatroomId: string, limit?: number, startTime?: number, endTime?: number) => Promise<unknown>
  getGroupActiveHours: (chatroomId: string, startTime?: number, endTime?: number) => Promise<unknown>
  getGroupMediaStats: (chatroomId: string, startTime?: number, endTime?: number) => Promise<unknown>
  exportGroupMembers: (chatroomId: string, outputPath: string) => Promise<unknown>
  exportGroupMemberMessages: (
    chatroomId: string,
    memberUsername: string,
    outputPath: string,
    startTime?: number,
    endTime?: number
  ) => Promise<unknown>
}

interface GroupAnalyticsIpcContext {
  groupAnalyticsService: GroupAnalyticsServiceLike
}

export function registerGroupAnalyticsIpcHandlers({ groupAnalyticsService }: GroupAnalyticsIpcContext): void {
  ipcMain.handle('groupAnalytics:getGroupChats', async () => {
    return groupAnalyticsService.getGroupChats()
  })

  ipcMain.handle('groupAnalytics:getGroupMembers', async (_, chatroomId: string) => {
    return groupAnalyticsService.getGroupMembers(chatroomId)
  })

  ipcMain.handle(
    'groupAnalytics:getGroupMembersPanelData',
    async (_, chatroomId: string, options?: GroupMembersPanelOptions | boolean) => {
      const normalizedOptions = typeof options === 'boolean'
        ? { forceRefresh: options }
        : options
      return groupAnalyticsService.getGroupMembersPanelData(chatroomId, normalizedOptions)
    }
  )

  ipcMain.handle('groupAnalytics:getGroupMessageRanking', async (_, chatroomId: string, limit?: number, startTime?: number, endTime?: number) => {
    return groupAnalyticsService.getGroupMessageRanking(chatroomId, limit, startTime, endTime)
  })

  ipcMain.handle('groupAnalytics:getGroupActiveHours', async (_, chatroomId: string, startTime?: number, endTime?: number) => {
    return groupAnalyticsService.getGroupActiveHours(chatroomId, startTime, endTime)
  })

  ipcMain.handle('groupAnalytics:getGroupMediaStats', async (_, chatroomId: string, startTime?: number, endTime?: number) => {
    return groupAnalyticsService.getGroupMediaStats(chatroomId, startTime, endTime)
  })

  ipcMain.handle('groupAnalytics:exportGroupMembers', async (_, chatroomId: string, outputPath: string) => {
    return groupAnalyticsService.exportGroupMembers(chatroomId, outputPath)
  })

  ipcMain.handle(
    'groupAnalytics:exportGroupMemberMessages',
    async (_, chatroomId: string, memberUsername: string, outputPath: string, startTime?: number, endTime?: number) => {
      return groupAnalyticsService.exportGroupMemberMessages(chatroomId, memberUsername, outputPath, startTime, endTime)
    }
  )
}
