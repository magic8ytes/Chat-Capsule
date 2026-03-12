import { wcdbMacService } from './wcdbMacService'
import { assertReadonlySql } from '../../shared/contracts/sql'

/**
 * WCDB 服务 (客户端代理)
 * 统一转发到 macOS 数据库后端。
 */
export class WcdbService {
  isMacBackendActive(): boolean {
    return wcdbMacService.isAvailable()
  }

  private call<T>(type: string, payload: any = {}): Promise<T> {
    return wcdbMacService.call(type, payload) as Promise<T>
  }


  /**
   * 启用/禁用日志
   */
  setLogEnabled(enabled: boolean): void {
    wcdbMacService.setLogEnabled(enabled)
  }

  /**
   * 设置数据库监控回调
   */
  setMonitor(callback: (type: string, json: string) => void): void {
    wcdbMacService.setMonitor(callback)
  }

  /**
   * 检查服务是否就绪
   */
  isReady(): boolean {
    return wcdbMacService.isReady()
  }

  /**
   * 测试数据库连接
   */
  async testConnection(dbPath: string, hexKey: string, wxid: string): Promise<{ success: boolean; error?: string; sessionCount?: number }> {
    return this.call('testConnection', { dbPath, hexKey, wxid })
  }

  /**
   * 打开数据库
   */
  async open(dbPath: string, hexKey: string, wxid: string): Promise<boolean> {
    return this.call('open', { dbPath, hexKey, wxid })
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    return this.call('close')
  }

  /**
   * 关闭服务
   */
  shutdown(): void {
    void this.close()
  }

  /**
   * 获取数据库连接状态
   * 注意：此方法现在是异步的
   */
  async isConnected(): Promise<boolean> {
    return this.call('isConnected')
  }

  /**
   * 获取会话列表
   */
  async getSessions(): Promise<{ success: boolean; sessions?: any[]; error?: string }> {
    return this.call('getSessions')
  }

  /**
   * 获取消息列表
   */
  async getMessages(sessionId: string, limit: number, offset: number): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    return this.call('getMessages', { sessionId, limit, offset })
  }

  /**
   * 获取新消息（增量刷新）
   */
  async getNewMessages(sessionId: string, minTime: number, limit: number = 1000): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    return this.call('getNewMessages', { sessionId, minTime, limit })
  }

  /**
   * 获取消息总数
   */
  async getMessageCount(sessionId: string): Promise<{ success: boolean; count?: number; error?: string }> {
    return this.call('getMessageCount', { sessionId })
  }

  async getMessageCounts(sessionIds: string[]): Promise<{ success: boolean; counts?: Record<string, number>; error?: string }> {
    return this.call('getMessageCounts', { sessionIds })
  }

  /**
   * 获取联系人昵称
   */
  async getDisplayNames(usernames: string[]): Promise<{ success: boolean; map?: Record<string, string>; error?: string }> {
    return this.call('getDisplayNames', { usernames })
  }

  /**
   * 获取头像 URL
   */
  async getAvatarUrls(usernames: string[]): Promise<{ success: boolean; map?: Record<string, string>; error?: string }> {
    return this.call('getAvatarUrls', { usernames })
  }

  /**
   * 获取群成员数量
   */
  async getGroupMemberCount(chatroomId: string): Promise<{ success: boolean; count?: number; error?: string }> {
    return this.call('getGroupMemberCount', { chatroomId })
  }

  /**
   * 批量获取群成员数量
   */
  async getGroupMemberCounts(chatroomIds: string[]): Promise<{ success: boolean; map?: Record<string, number>; error?: string }> {
    return this.call('getGroupMemberCounts', { chatroomIds })
  }

  /**
   * 获取群成员列表
   */
  async getGroupMembers(chatroomId: string): Promise<{ success: boolean; members?: any[]; error?: string }> {
    return this.call('getGroupMembers', { chatroomId })
  }

  // 获取群成员群名片昵称
  async getGroupNicknames(chatroomId: string): Promise<{ success: boolean; nicknames?: Record<string, string>; error?: string }> {
    return this.call('getGroupNicknames', { chatroomId })
  }

  /**
   * 获取消息表列表
   */
  async getMessageTables(sessionId: string): Promise<{ success: boolean; tables?: any[]; error?: string }> {
    return this.call('getMessageTables', { sessionId })
  }

  /**
   * 获取消息表统计
   */
  async getMessageTableStats(sessionId: string): Promise<{ success: boolean; tables?: any[]; error?: string }> {
    return this.call('getMessageTableStats', { sessionId })
  }

  async getMessageDates(sessionId: string): Promise<{ success: boolean; dates?: string[]; error?: string }> {
    return this.call('getMessageDates', { sessionId })
  }

  /**
   * 获取消息元数据
   */
  async getMessageMeta(dbPath: string, tableName: string, limit: number, offset: number): Promise<{ success: boolean; rows?: any[]; error?: string }> {
    return this.call('getMessageMeta', { dbPath, tableName, limit, offset })
  }

  /**
   * 获取联系人详情
   */
  async getContact(username: string): Promise<{ success: boolean; contact?: any; error?: string }> {
    return this.call('getContact', { username })
  }

  /**
   * 批量获取联系人 extra_buffer 状态（isFolded/isMuted）
   */
  async getContactStatus(usernames: string[]): Promise<{ success: boolean; map?: Record<string, { isFolded: boolean; isMuted: boolean }>; error?: string }> {
    return this.call('getContactStatus', { usernames })
  }

  /**
   * 获取聚合统计数据
   */
  async getAggregateStats(sessionIds: string[], beginTimestamp: number = 0, endTimestamp: number = 0): Promise<{ success: boolean; data?: any; error?: string }> {
    return this.call('getAggregateStats', { sessionIds, beginTimestamp, endTimestamp })
  }

  /**
   * 获取可用年份
   */
  async getAvailableYears(sessionIds: string[]): Promise<{ success: boolean; data?: number[]; error?: string }> {
    return this.call('getAvailableYears', { sessionIds })
  }

  /**
   * 获取群聊统计
   */
  async getGroupStats(chatroomId: string, beginTimestamp: number = 0, endTimestamp: number = 0): Promise<{ success: boolean; data?: any; error?: string }> {
    return this.call('getGroupStats', { chatroomId, beginTimestamp, endTimestamp })
  }

  /**
   * 打开消息游标
   */
  async openMessageCursor(sessionId: string, batchSize: number, ascending: boolean, beginTimestamp: number, endTimestamp: number): Promise<{ success: boolean; cursor?: number; error?: string }> {
    return this.call('openMessageCursor', { sessionId, batchSize, ascending, beginTimestamp, endTimestamp })
  }

  /**
   * 打开轻量级消息游标
   */
  async openMessageCursorLite(sessionId: string, batchSize: number, ascending: boolean, beginTimestamp: number, endTimestamp: number): Promise<{ success: boolean; cursor?: number; error?: string }> {
    return this.call('openMessageCursorLite', { sessionId, batchSize, ascending, beginTimestamp, endTimestamp })
  }

  /**
   * 获取下一批消息
   */
  async fetchMessageBatch(cursor: number): Promise<{ success: boolean; rows?: any[]; hasMore?: boolean; error?: string }> {
    return this.call('fetchMessageBatch', { cursor })
  }

  /**
   * 关闭消息游标
   */
  async closeMessageCursor(cursor: number): Promise<{ success: boolean; error?: string }> {
    return this.call('closeMessageCursor', { cursor })
  }

  /**
   * 执行只读 SQL 查询（支持参数化查询）
   */
  async execQuery(kind: string, path: string | null, sql: string, params: unknown[] = []): Promise<{ success: boolean; rows?: any[]; error?: string }> {
    const readonlySql = assertReadonlySql(sql)
    return this.call('execQuery', { kind, path, sql: readonlySql, params })
  }

  /**
   * 获取表情包 CDN URL
   */
  async getEmoticonCdnUrl(dbPath: string, md5: string): Promise<{ success: boolean; url?: string; error?: string }> {
    return this.call('getEmoticonCdnUrl', { dbPath, md5 })
  }

  /**
   * 列出消息数据库
   */
  async listMessageDbs(): Promise<{ success: boolean; data?: string[]; error?: string }> {
    return this.call('listMessageDbs')
  }

  /**
   * 列出媒体数据库
   */
  async listMediaDbs(): Promise<{ success: boolean; data?: string[]; error?: string }> {
    return this.call('listMediaDbs')
  }

  /**
   * 根据 ID 获取消息
   */
  async getMessageById(sessionId: string, localId: number): Promise<{ success: boolean; message?: any; error?: string }> {
    return this.call('getMessageById', { sessionId, localId })
  }

  /**
   * 获取语音数据
   */
  async getVoiceData(sessionId: string, createTime: number, candidates: string[], localId: number = 0, svrId: string | number = 0): Promise<{ success: boolean; hex?: string; error?: string }> {
    return this.call('getVoiceData', { sessionId, createTime, candidates, localId, svrId })
  }

  /**
   * 获取朋友圈
   */
  async getSnsTimeline(limit: number, offset: number, usernames?: string[], keyword?: string, startTime?: number, endTime?: number): Promise<{ success: boolean; timeline?: any[]; error?: string }> {
    return this.call('getSnsTimeline', { limit, offset, usernames, keyword, startTime, endTime })
  }

  /**
   * 获取底层数据库后端日志
   */
  async getLogs(): Promise<{ success: boolean; logs?: string[]; error?: string }> {
    return this.call('getLogs')
  }

  /**
   * 验证系统生物识别
   */
  async verifyUser(message: string, hwnd?: string): Promise<{ success: boolean; error?: string }> {
    return this.call('verifyUser', { message, hwnd })
  }





}

export const wcdbService = new WcdbService()
