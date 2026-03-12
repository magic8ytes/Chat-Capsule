import { ipcMain } from 'electron'

interface SessionContactInfoOptions {
  skipDisplayName?: boolean
  onlyMissingAvatar?: boolean
}

interface ChatServiceLike {
  connect: () => Promise<unknown>
  getSessions: () => Promise<unknown>
  getSessionStatuses: (usernames: string[]) => Promise<unknown>
  getExportTabCounts: () => Promise<unknown>
  getContactTypeCounts: () => Promise<unknown>
  getSessionMessageCounts: (sessionIds: string[]) => Promise<unknown>
  enrichSessionsContactInfo: (usernames: string[], options?: SessionContactInfoOptions) => Promise<unknown>
  getMessages: (
    sessionId: string,
    offset?: number,
    limit?: number,
    startTime?: number,
    endTime?: number,
    ascending?: boolean
  ) => Promise<unknown>
  getLatestMessages: (sessionId: string, limit?: number) => Promise<unknown>
  getNewMessages: (sessionId: string, minTime: number, limit?: number) => Promise<unknown>
  getContact: (username: string) => Promise<unknown>
  getContactAvatar: (username: string) => Promise<unknown>
  resolveTransferDisplayNames: (chatroomId: string, payerUsername: string, receiverUsername: string) => Promise<unknown>
  getContacts: () => Promise<unknown>
  getCachedSessionMessages: (sessionId: string) => Promise<unknown>
  getMyAvatarUrl: () => Promise<unknown>
  downloadEmoji: (cdnUrl: string, md5?: string) => Promise<unknown>
  close: () => void
}

interface ChatBaseIpcContext {
  chatService: ChatServiceLike
}

export function registerChatBaseIpcHandlers({ chatService }: ChatBaseIpcContext): void {
  ipcMain.handle('chat:connect', async () => {
    return chatService.connect()
  })

  ipcMain.handle('chat:getSessions', async () => {
    return chatService.getSessions()
  })

  ipcMain.handle('chat:getSessionStatuses', async (_, usernames: string[]) => {
    return chatService.getSessionStatuses(usernames)
  })

  ipcMain.handle('chat:getExportTabCounts', async () => {
    return chatService.getExportTabCounts()
  })

  ipcMain.handle('chat:getContactTypeCounts', async () => {
    return chatService.getContactTypeCounts()
  })

  ipcMain.handle('chat:getSessionMessageCounts', async (_, sessionIds: string[]) => {
    return chatService.getSessionMessageCounts(sessionIds)
  })

  ipcMain.handle('chat:enrichSessionsContactInfo', async (_, usernames: string[], options?: SessionContactInfoOptions) => {
    return chatService.enrichSessionsContactInfo(usernames, options)
  })

  ipcMain.handle('chat:getMessages', async (_, sessionId: string, offset?: number, limit?: number, startTime?: number, endTime?: number, ascending?: boolean) => {
    return chatService.getMessages(sessionId, offset, limit, startTime, endTime, ascending)
  })

  ipcMain.handle('chat:getLatestMessages', async (_, sessionId: string, limit?: number) => {
    return chatService.getLatestMessages(sessionId, limit)
  })

  ipcMain.handle('chat:getNewMessages', async (_, sessionId: string, minTime: number, limit?: number) => {
    return chatService.getNewMessages(sessionId, minTime, limit)
  })

  ipcMain.handle('chat:getContact', async (_, username: string) => {
    return chatService.getContact(username)
  })

  ipcMain.handle('chat:getContactAvatar', async (_, username: string) => {
    return chatService.getContactAvatar(username)
  })

  ipcMain.handle('chat:resolveTransferDisplayNames', async (_, chatroomId: string, payerUsername: string, receiverUsername: string) => {
    return chatService.resolveTransferDisplayNames(chatroomId, payerUsername, receiverUsername)
  })

  ipcMain.handle('chat:getContacts', async () => {
    return chatService.getContacts()
  })

  ipcMain.handle('chat:getCachedMessages', async (_, sessionId: string) => {
    return chatService.getCachedSessionMessages(sessionId)
  })

  ipcMain.handle('chat:getMyAvatarUrl', async () => {
    return chatService.getMyAvatarUrl()
  })

  ipcMain.handle('chat:downloadEmoji', async (_, cdnUrl: string, md5?: string) => {
    return chatService.downloadEmoji(cdnUrl, md5)
  })

  ipcMain.handle('chat:close', async () => {
    chatService.close()
    return true
  })
}
