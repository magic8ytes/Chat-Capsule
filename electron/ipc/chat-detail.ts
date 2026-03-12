import { ipcMain } from 'electron'

interface ExportSessionStatsOptions {
  includeRelations?: boolean
  forceRefresh?: boolean
  allowStaleCache?: boolean
  preferAccurateSpecialTypes?: boolean
  cacheOnly?: boolean
}

interface ChatDetailServiceLike {
  getSessionDetail: (sessionId: string) => Promise<unknown>
  getSessionDetailFast: (sessionId: string) => Promise<unknown>
  getSessionDetailExtra: (sessionId: string) => Promise<unknown>
  getExportSessionStats: (sessionIds: string[], options?: ExportSessionStatsOptions) => Promise<unknown>
  getGroupMyMessageCountHint: (chatroomId: string) => Promise<unknown>
  getImageData: (sessionId: string, msgId: string) => Promise<unknown>
  getVoiceData: (sessionId: string, msgId: string, createTime?: number, serverId?: string | number) => Promise<unknown>
  getAllVoiceMessages: (sessionId: string) => Promise<unknown>
  getAllImageMessages: (sessionId: string) => Promise<unknown>
  getImageMessageDateCounts: (sessionId: string) => Promise<unknown>
  getImageMessagesByDates: (sessionId: string, dates: string[]) => Promise<unknown>
  getMessageDates: (sessionId: string) => Promise<unknown>
  getMessageDateCounts: (sessionId: string) => Promise<unknown>
  resolveVoiceCache: (sessionId: string, msgId: string) => Promise<unknown>
  getVoiceTranscript: (
    sessionId: string,
    msgId: string,
    createTime: number | undefined,
    onPartial?: (text: string) => void
  ) => Promise<unknown>
  getMessageById: (sessionId: string, localId: number) => Promise<unknown>
}

interface ChatDetailIpcContext {
  chatService: ChatDetailServiceLike
}

export function registerChatDetailIpcHandlers({ chatService }: ChatDetailIpcContext): void {
  ipcMain.handle('chat:getSessionDetail', async (_, sessionId: string) => {
    return chatService.getSessionDetail(sessionId)
  })

  ipcMain.handle('chat:getSessionDetailFast', async (_, sessionId: string) => {
    return chatService.getSessionDetailFast(sessionId)
  })

  ipcMain.handle('chat:getSessionDetailExtra', async (_, sessionId: string) => {
    return chatService.getSessionDetailExtra(sessionId)
  })

  ipcMain.handle('chat:getExportSessionStats', async (_, sessionIds: string[], options?: ExportSessionStatsOptions) => {
    return chatService.getExportSessionStats(sessionIds, options)
  })

  ipcMain.handle('chat:getGroupMyMessageCountHint', async (_, chatroomId: string) => {
    return chatService.getGroupMyMessageCountHint(chatroomId)
  })

  ipcMain.handle('chat:getImageData', async (_, sessionId: string, msgId: string) => {
    return chatService.getImageData(sessionId, msgId)
  })

  ipcMain.handle('chat:getVoiceData', async (_, sessionId: string, msgId: string, createTime?: number, serverId?: string | number) => {
    return chatService.getVoiceData(sessionId, msgId, createTime, serverId)
  })

  ipcMain.handle('chat:getAllVoiceMessages', async (_, sessionId: string) => {
    return chatService.getAllVoiceMessages(sessionId)
  })

  ipcMain.handle('chat:getAllImageMessages', async (_, sessionId: string) => {
    return chatService.getAllImageMessages(sessionId)
  })

  ipcMain.handle('chat:getImageMessageDateCounts', async (_, sessionId: string) => {
    return chatService.getImageMessageDateCounts(sessionId)
  })

  ipcMain.handle('chat:getImageMessagesByDates', async (_, sessionId: string, dates: string[]) => {
    return chatService.getImageMessagesByDates(sessionId, dates)
  })

  ipcMain.handle('chat:getMessageDates', async (_, sessionId: string) => {
    return chatService.getMessageDates(sessionId)
  })

  ipcMain.handle('chat:getMessageDateCounts', async (_, sessionId: string) => {
    return chatService.getMessageDateCounts(sessionId)
  })

  ipcMain.handle('chat:resolveVoiceCache', async (_, sessionId: string, msgId: string) => {
    return chatService.resolveVoiceCache(sessionId, msgId)
  })

  ipcMain.handle('chat:getVoiceTranscript', async (event, sessionId: string, msgId: string, createTime?: number) => {
    return chatService.getVoiceTranscript(sessionId, msgId, createTime, (text) => {
      event.sender.send('chat:voiceTranscriptPartial', { msgId, text })
    })
  })

  ipcMain.handle('chat:getMessage', async (_, sessionId: string, localId: number) => {
    return chatService.getMessageById(sessionId, localId)
  })
}
