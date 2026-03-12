import { WcdbService, wcdbService } from './wcdbService'

type WcdbReadonlyMethodName =
  | 'getSessions'
  | 'getMessages'
  | 'getNewMessages'
  | 'getMessageCount'
  | 'getMessageCounts'
  | 'getDisplayNames'
  | 'getAvatarUrls'
  | 'getGroupMemberCount'
  | 'getGroupMemberCounts'
  | 'getGroupMembers'
  | 'getGroupNicknames'
  | 'getMessageTables'
  | 'getMessageTableStats'
  | 'getMessageDates'
  | 'getMessageMeta'
  | 'getContact'
  | 'getContactStatus'
  | 'getAggregateStats'
  | 'getAvailableYears'
  | 'getGroupStats'
  | 'openMessageCursor'
  | 'openMessageCursorLite'
  | 'fetchMessageBatch'
  | 'closeMessageCursor'
  | 'getEmoticonCdnUrl'
  | 'listMessageDbs'
  | 'listMediaDbs'
  | 'getMessageById'
  | 'getVoiceData'
  | 'getSnsTimeline'
  | 'getLogs'

export type WcdbReadonlyRepository = Pick<WcdbService, WcdbReadonlyMethodName>

export const wcdbReadonlyRepository: WcdbReadonlyRepository = {
  getSessions: wcdbService.getSessions.bind(wcdbService),
  getMessages: wcdbService.getMessages.bind(wcdbService),
  getNewMessages: wcdbService.getNewMessages.bind(wcdbService),
  getMessageCount: wcdbService.getMessageCount.bind(wcdbService),
  getMessageCounts: wcdbService.getMessageCounts.bind(wcdbService),
  getDisplayNames: wcdbService.getDisplayNames.bind(wcdbService),
  getAvatarUrls: wcdbService.getAvatarUrls.bind(wcdbService),
  getGroupMemberCount: wcdbService.getGroupMemberCount.bind(wcdbService),
  getGroupMemberCounts: wcdbService.getGroupMemberCounts.bind(wcdbService),
  getGroupMembers: wcdbService.getGroupMembers.bind(wcdbService),
  getGroupNicknames: wcdbService.getGroupNicknames.bind(wcdbService),
  getMessageTables: wcdbService.getMessageTables.bind(wcdbService),
  getMessageTableStats: wcdbService.getMessageTableStats.bind(wcdbService),
  getMessageDates: wcdbService.getMessageDates.bind(wcdbService),
  getMessageMeta: wcdbService.getMessageMeta.bind(wcdbService),
  getContact: wcdbService.getContact.bind(wcdbService),
  getContactStatus: wcdbService.getContactStatus.bind(wcdbService),
  getAggregateStats: wcdbService.getAggregateStats.bind(wcdbService),
  getAvailableYears: wcdbService.getAvailableYears.bind(wcdbService),
  getGroupStats: wcdbService.getGroupStats.bind(wcdbService),
  openMessageCursor: wcdbService.openMessageCursor.bind(wcdbService),
  openMessageCursorLite: wcdbService.openMessageCursorLite.bind(wcdbService),
  fetchMessageBatch: wcdbService.fetchMessageBatch.bind(wcdbService),
  closeMessageCursor: wcdbService.closeMessageCursor.bind(wcdbService),
  getEmoticonCdnUrl: wcdbService.getEmoticonCdnUrl.bind(wcdbService),
  listMessageDbs: wcdbService.listMessageDbs.bind(wcdbService),
  listMediaDbs: wcdbService.listMediaDbs.bind(wcdbService),
  getMessageById: wcdbService.getMessageById.bind(wcdbService),
  getVoiceData: wcdbService.getVoiceData.bind(wcdbService),
  getSnsTimeline: wcdbService.getSnsTimeline.bind(wcdbService),
  getLogs: wcdbService.getLogs.bind(wcdbService)
}
