import { contextBridge, ipcRenderer } from 'electron'
import type { PublicConfigKey } from '../shared/contracts/config'
import { subscribeIpcEvent, subscribeIpcPayload } from './utils/preloadSubscriptions'

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 配置
  config: {
    get: (key: PublicConfigKey) => ipcRenderer.invoke('config:get', key),
    set: (key: PublicConfigKey, value: unknown) => ipcRenderer.invoke('config:set', key, value)
  },

  // 认证
  auth: {
    hello: (message?: string) => ipcRenderer.invoke('auth:hello', message),
    verifyEnabled: () => ipcRenderer.invoke('auth:verifyEnabled'),
    unlock: (password: string) => ipcRenderer.invoke('auth:unlock', password),
    enableLock: (password: string) => ipcRenderer.invoke('auth:enableLock', password),
    disableLock: (password: string) => ipcRenderer.invoke('auth:disableLock', password),
    changePassword: (oldPassword: string, newPassword: string) => ipcRenderer.invoke('auth:changePassword', oldPassword, newPassword),
    setHelloSecret: (password: string) => ipcRenderer.invoke('auth:setHelloSecret', password),
    clearHelloSecret: () => ipcRenderer.invoke('auth:clearHelloSecret'),
    isLockMode: () => ipcRenderer.invoke('auth:isLockMode')
  },


  // 对话框
  dialog: {
    openFile: (options?: Electron.OpenDialogOptions) => ipcRenderer.invoke('dialog:openFile', options),
    openDirectory: (options?: Electron.OpenDialogOptions) => ipcRenderer.invoke('dialog:openDirectory', options),
    saveFile: (options?: Electron.SaveDialogOptions) => ipcRenderer.invoke('dialog:saveFile', options)
  },

  // Shell
  shell: {
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
  },

  // App
  app: {
    getCapabilities: () => ipcRenderer.invoke('app:getCapabilities'),
    getMacProfileSetup: () => ipcRenderer.invoke('app:getMacProfileSetup'),
    getMacProfile: () => ipcRenderer.invoke('app:getMacProfile'),
    importMacProfile: (sourcePath: string) => ipcRenderer.invoke('app:importMacProfile', sourcePath),
    exportMacProfile: (targetPath: string) => ipcRenderer.invoke('app:exportMacProfile', targetPath),
    exportMacProfileTemplate: (targetPath: string) => ipcRenderer.invoke('app:exportMacProfileTemplate', targetPath),
    createMacProfile: (payload: unknown) => ipcRenderer.invoke('app:createMacProfile', payload),
    probeMacProfile: () => ipcRenderer.invoke('app:probeMacProfile'),
    getDownloadsPath: () => ipcRenderer.invoke('app:getDownloadsPath'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },

  diagnostics: {
    getExportCardLogs: (options?: { limit?: number }) =>
      ipcRenderer.invoke('diagnostics:getExportCardLogs', options),
    clearExportCardLogs: () =>
      ipcRenderer.invoke('diagnostics:clearExportCardLogs'),
    exportExportCardLogs: (payload: { filePath: string; frontendLogs?: unknown[] }) =>
      ipcRenderer.invoke('diagnostics:exportExportCardLogs', payload)
  },

  // 窗口控制
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    openAgreementWindow: () => ipcRenderer.invoke('window:openAgreementWindow'),
    completeOnboarding: () => ipcRenderer.invoke('window:completeOnboarding'),
    openOnboardingWindow: () => ipcRenderer.invoke('window:openOnboardingWindow'),
    setTitleBarOverlay: (options: { symbolColor: string }) => ipcRenderer.send('window:setTitleBarOverlay', options),
    openVideoPlayerWindow: (videoPath: string, videoWidth?: number, videoHeight?: number) =>
      ipcRenderer.invoke('window:openVideoPlayerWindow', videoPath, videoWidth, videoHeight),
    resizeToFitVideo: (videoWidth: number, videoHeight: number) =>
      ipcRenderer.invoke('window:resizeToFitVideo', videoWidth, videoHeight),
    openImageViewerWindow: (imagePath: string, liveVideoPath?: string) =>
      ipcRenderer.invoke('window:openImageViewerWindow', imagePath, liveVideoPath),
    openChatHistoryWindow: (sessionId: string, messageId: number) =>
      ipcRenderer.invoke('window:openChatHistoryWindow', sessionId, messageId),
    openSessionChatWindow: (
      sessionId: string,
      options?: {
        source?: 'chat' | 'export'
        initialDisplayName?: string
        initialAvatarUrl?: string
        initialContactType?: 'friend' | 'group' | 'official' | 'former_friend' | 'other'
      }
    ) =>
      ipcRenderer.invoke('window:openSessionChatWindow', sessionId, options)
  },

  // 聊天
  chat: {
    connect: () => ipcRenderer.invoke('chat:connect'),
    getSessions: () => ipcRenderer.invoke('chat:getSessions'),
    getSessionStatuses: (usernames: string[]) => ipcRenderer.invoke('chat:getSessionStatuses', usernames),
    getExportTabCounts: () => ipcRenderer.invoke('chat:getExportTabCounts'),
    getContactTypeCounts: () => ipcRenderer.invoke('chat:getContactTypeCounts'),
    getSessionMessageCounts: (sessionIds: string[]) => ipcRenderer.invoke('chat:getSessionMessageCounts', sessionIds),
    enrichSessionsContactInfo: (
      usernames: string[],
      options?: { skipDisplayName?: boolean; onlyMissingAvatar?: boolean }
    ) => ipcRenderer.invoke('chat:enrichSessionsContactInfo', usernames, options),
    getMessages: (sessionId: string, offset?: number, limit?: number, startTime?: number, endTime?: number, ascending?: boolean) =>
      ipcRenderer.invoke('chat:getMessages', sessionId, offset, limit, startTime, endTime, ascending),
    getLatestMessages: (sessionId: string, limit?: number) =>
      ipcRenderer.invoke('chat:getLatestMessages', sessionId, limit),
    getNewMessages: (sessionId: string, minTime: number, limit?: number) =>
      ipcRenderer.invoke('chat:getNewMessages', sessionId, minTime, limit),
    getContact: (username: string) => ipcRenderer.invoke('chat:getContact', username),
    getContactAvatar: (username: string) => ipcRenderer.invoke('chat:getContactAvatar', username),
    resolveTransferDisplayNames: (chatroomId: string, payerUsername: string, receiverUsername: string) =>
      ipcRenderer.invoke('chat:resolveTransferDisplayNames', chatroomId, payerUsername, receiverUsername),
    getMyAvatarUrl: () => ipcRenderer.invoke('chat:getMyAvatarUrl'),
    downloadEmoji: (cdnUrl: string, md5?: string) => ipcRenderer.invoke('chat:downloadEmoji', cdnUrl, md5),
    getCachedMessages: (sessionId: string) => ipcRenderer.invoke('chat:getCachedMessages', sessionId),
    clearCurrentAccountData: (options: { clearCache?: boolean; clearExports?: boolean }) =>
      ipcRenderer.invoke('chat:clearCurrentAccountData', options),
    close: () => ipcRenderer.invoke('chat:close'),
    getSessionDetail: (sessionId: string) => ipcRenderer.invoke('chat:getSessionDetail', sessionId),
    getSessionDetailFast: (sessionId: string) => ipcRenderer.invoke('chat:getSessionDetailFast', sessionId),
    getSessionDetailExtra: (sessionId: string) => ipcRenderer.invoke('chat:getSessionDetailExtra', sessionId),
    getExportSessionStats: (
      sessionIds: string[],
      options?: {
        includeRelations?: boolean
        forceRefresh?: boolean
        allowStaleCache?: boolean
        preferAccurateSpecialTypes?: boolean
        cacheOnly?: boolean
      }
    ) => ipcRenderer.invoke('chat:getExportSessionStats', sessionIds, options),
    getGroupMyMessageCountHint: (chatroomId: string) =>
      ipcRenderer.invoke('chat:getGroupMyMessageCountHint', chatroomId),
    getImageData: (sessionId: string, msgId: string) => ipcRenderer.invoke('chat:getImageData', sessionId, msgId),
    getVoiceData: (sessionId: string, msgId: string, createTime?: number, serverId?: string | number) =>
      ipcRenderer.invoke('chat:getVoiceData', sessionId, msgId, createTime, serverId),
    getAllVoiceMessages: (sessionId: string) => ipcRenderer.invoke('chat:getAllVoiceMessages', sessionId),
    getAllImageMessages: (sessionId: string) => ipcRenderer.invoke('chat:getAllImageMessages', sessionId),
    getImageMessageDateCounts: (sessionId: string) => ipcRenderer.invoke('chat:getImageMessageDateCounts', sessionId),
    getImageMessagesByDates: (sessionId: string, dates: string[]) => ipcRenderer.invoke('chat:getImageMessagesByDates', sessionId, dates),
    getMessageDates: (sessionId: string) => ipcRenderer.invoke('chat:getMessageDates', sessionId),
    getMessageDateCounts: (sessionId: string) => ipcRenderer.invoke('chat:getMessageDateCounts', sessionId),
    resolveVoiceCache: (sessionId: string, msgId: string) => ipcRenderer.invoke('chat:resolveVoiceCache', sessionId, msgId),
    getVoiceTranscript: (sessionId: string, msgId: string, createTime?: number) => ipcRenderer.invoke('chat:getVoiceTranscript', sessionId, msgId, createTime),
    onVoiceTranscriptPartial: (callback: (payload: { msgId: string; text: string }) => void) => {
      return subscribeIpcPayload(ipcRenderer, 'chat:voiceTranscriptPartial', callback)
    },
    getContacts: () => ipcRenderer.invoke('chat:getContacts'),
    getMessage: (sessionId: string, localId: number) =>
      ipcRenderer.invoke('chat:getMessage', sessionId, localId),
    onWcdbChange: (callback: (event: unknown, data: { type: string; json: string }) => void) => {
      return subscribeIpcEvent(ipcRenderer, 'wcdb-change', callback)
    }
  },



  // 图片解密
  image: {
    decrypt: (payload: { sessionId?: string; imageMd5?: string; imageDatName?: string; force?: boolean }) =>
      ipcRenderer.invoke('image:decrypt', payload),
    resolveCache: (payload: { sessionId?: string; imageMd5?: string; imageDatName?: string }) =>
      ipcRenderer.invoke('image:resolveCache', payload),
    preload: (payloads: Array<{ sessionId?: string; imageMd5?: string; imageDatName?: string }>) =>
      ipcRenderer.invoke('image:preload', payloads),
    onUpdateAvailable: (callback: (payload: { cacheKey: string; imageMd5?: string; imageDatName?: string }) => void) => {
      return subscribeIpcPayload(ipcRenderer, 'image:updateAvailable', callback)
    },
    onCacheResolved: (callback: (payload: { cacheKey: string; imageMd5?: string; imageDatName?: string; localPath: string }) => void) => {
      return subscribeIpcPayload(ipcRenderer, 'image:cacheResolved', callback)
    }
  },

  // 视频
  video: {
    getVideoInfo: (videoMd5: string) => ipcRenderer.invoke('video:getVideoInfo', videoMd5),
    parseVideoMd5: (content: string) => ipcRenderer.invoke('video:parseVideoMd5', content)
  },

  // 数据分析
  analytics: {
    getOverallStatistics: (force?: boolean) => ipcRenderer.invoke('analytics:getOverallStatistics', force),
    getContactRankings: (limit?: number, beginTimestamp?: number, endTimestamp?: number) =>
      ipcRenderer.invoke('analytics:getContactRankings', limit, beginTimestamp, endTimestamp),
    getTimeDistribution: () => ipcRenderer.invoke('analytics:getTimeDistribution'),
    getExcludedUsernames: () => ipcRenderer.invoke('analytics:getExcludedUsernames'),
    setExcludedUsernames: (usernames: string[]) => ipcRenderer.invoke('analytics:setExcludedUsernames', usernames),
    getExcludeCandidates: () => ipcRenderer.invoke('analytics:getExcludeCandidates'),
    onProgress: (callback: (payload: { status: string; progress: number }) => void) => {
      return subscribeIpcPayload(ipcRenderer, 'analytics:progress', callback)
    }
  },

  // 缓存管理
  cache: {
    clearAnalytics: () => ipcRenderer.invoke('cache:clearAnalytics'),
    clearImages: () => ipcRenderer.invoke('cache:clearImages'),
    clearAll: () => ipcRenderer.invoke('cache:clearAll')
  },

  // 群聊分析
  groupAnalytics: {
    getGroupChats: () => ipcRenderer.invoke('groupAnalytics:getGroupChats'),
    getGroupMembers: (chatroomId: string) => ipcRenderer.invoke('groupAnalytics:getGroupMembers', chatroomId),
    getGroupMembersPanelData: (
      chatroomId: string,
      options?: { forceRefresh?: boolean; includeMessageCounts?: boolean }
    ) => ipcRenderer.invoke('groupAnalytics:getGroupMembersPanelData', chatroomId, options),
    getGroupMessageRanking: (chatroomId: string, limit?: number, startTime?: number, endTime?: number) => ipcRenderer.invoke('groupAnalytics:getGroupMessageRanking', chatroomId, limit, startTime, endTime),
    getGroupActiveHours: (chatroomId: string, startTime?: number, endTime?: number) => ipcRenderer.invoke('groupAnalytics:getGroupActiveHours', chatroomId, startTime, endTime),
    getGroupMediaStats: (chatroomId: string, startTime?: number, endTime?: number) => ipcRenderer.invoke('groupAnalytics:getGroupMediaStats', chatroomId, startTime, endTime),
    exportGroupMembers: (chatroomId: string, outputPath: string) => ipcRenderer.invoke('groupAnalytics:exportGroupMembers', chatroomId, outputPath),
    exportGroupMemberMessages: (chatroomId: string, memberUsername: string, outputPath: string, startTime?: number, endTime?: number) =>
      ipcRenderer.invoke('groupAnalytics:exportGroupMemberMessages', chatroomId, memberUsername, outputPath, startTime, endTime)
  },

  // 导出
  export: {
    getExportStats: (sessionIds: string[], options: unknown) =>
      ipcRenderer.invoke('export:getExportStats', sessionIds, options),
    exportSessions: (sessionIds: string[], outputDir: string, options: unknown) =>
      ipcRenderer.invoke('export:exportSessions', sessionIds, outputDir, options),
    exportSession: (sessionId: string, outputPath: string, options: unknown) =>
      ipcRenderer.invoke('export:exportSession', sessionId, outputPath, options),
    exportContacts: (outputDir: string, options: unknown) =>
      ipcRenderer.invoke('export:exportContacts', outputDir, options),
    onProgress: (callback: (payload: { current: number; total: number; currentSession: string; currentSessionId?: string; phase: string }) => void) => {
      return subscribeIpcPayload(ipcRenderer, 'export:progress', callback)
    }
  },

  whisper: {
    downloadModel: () =>
      ipcRenderer.invoke('whisper:downloadModel'),
    getModelStatus: () =>
      ipcRenderer.invoke('whisper:getModelStatus'),
    onDownloadProgress: (callback: (payload: { modelName: string; downloadedBytes: number; totalBytes?: number; percent?: number }) => void) => {
      return subscribeIpcPayload(ipcRenderer, 'whisper:downloadProgress', callback)
    }
  },

  // 朋友圈
  sns: {
    getTimeline: (limit: number, offset: number, usernames?: string[], keyword?: string, startTime?: number, endTime?: number) =>
      ipcRenderer.invoke('sns:getTimeline', limit, offset, usernames, keyword, startTime, endTime),
    getSnsUsernames: () => ipcRenderer.invoke('sns:getSnsUsernames'),
    getUserPostCounts: () => ipcRenderer.invoke('sns:getUserPostCounts'),
    getExportStatsFast: () => ipcRenderer.invoke('sns:getExportStatsFast'),
    getExportStats: () => ipcRenderer.invoke('sns:getExportStats'),
    getUserPostStats: (username: string) => ipcRenderer.invoke('sns:getUserPostStats', username),
    proxyImage: (payload: { url: string; key?: string | number }) => ipcRenderer.invoke('sns:proxyImage', payload),
    downloadImage: (payload: { url: string; key?: string | number }) => ipcRenderer.invoke('sns:downloadImage', payload),
    exportTimeline: (options: {
      outputDir: string
      format: 'json' | 'html' | 'arkmejson'
      usernames?: string[]
      keyword?: string
      exportImages?: boolean
      exportLivePhotos?: boolean
      exportVideos?: boolean
      startTime?: number
      endTime?: number
    }) => ipcRenderer.invoke('sns:exportTimeline', options),
    onExportProgress: (callback: (payload: { current: number; total: number; status: string }) => void) => {
      return subscribeIpcPayload(ipcRenderer, 'sns:exportProgress', callback)
    },
    selectExportDir: () => ipcRenderer.invoke('sns:selectExportDir'),
    downloadEmoji: (params: { url: string; encryptUrl?: string; aesKey?: string }) => ipcRenderer.invoke('sns:downloadEmoji', params)
  },


  // HTTP API 服务
  http: {
    start: (port?: number) => ipcRenderer.invoke('http:start', port),
    stop: () => ipcRenderer.invoke('http:stop'),
    status: () => ipcRenderer.invoke('http:status'),
    copyToken: () => ipcRenderer.invoke('http:copyToken'),
    rotateToken: () => ipcRenderer.invoke('http:rotateToken'),
    setAllowedOrigins: (origins: string[]) => ipcRenderer.invoke('http:setAllowedOrigins', origins)
  }
})
