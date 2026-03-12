import { Aperture, Calendar, Check, ClipboardList, Copy, Database, Hash, Loader2, MessageSquare, X } from 'lucide-react'
import type { ExportSessionRecordEntry } from '../../services/config'
import { AvatarImage } from '../AvatarImage'

interface SessionMessageTableLike {
  dbName: string
  tableName: string
  count: number
}

interface SessionDetailLike {
  wxid: string
  displayName: string
  remark?: string
  nickName?: string
  alias?: string
  avatarUrl?: string
  messageCount: number
  voiceMessages?: number
  imageMessages?: number
  videoMessages?: number
  emojiMessages?: number
  transferMessages?: number
  redPacketMessages?: number
  callMessages?: number
  privateMutualGroups?: number
  groupMemberCount?: number
  groupMyMessages?: number
  groupActiveSpeakers?: number
  groupMutualFriends?: number
  relationStatsLoaded?: boolean
  statsUpdatedAt?: number
  statsStale?: boolean
  firstMessageTime?: number
  latestMessageTime?: number
  messageTables: SessionMessageTableLike[]
}

interface SessionDetailPanelProps {
  open: boolean
  sessionDetail: SessionDetailLike | null
  isLoadingSessionDetail: boolean
  isLoadingSessionDetailExtra: boolean
  isRefreshingSessionDetailStats: boolean
  isLoadingSessionRelationStats: boolean
  copiedDetailField: string | null
  currentSessionExportRecords: ExportSessionRecordEntry[]
  sessionDetailSupportsSnsTimeline: boolean
  sessionDetailSnsCountLabel: string
  onClose: () => void
  onCopyDetailField: (text: string, field: string) => void
  onOpenSessionSnsTimeline: () => void
  onOpenPath: (path: string) => void
  onLoadSessionRelationStats: () => void
  formatPathBrief: (path: string) => string
  formatYmdHmDateTime: (value: number) => string
  formatYmdDateFromSeconds: (value: number) => string
}

function renderNumericValue(value: number | undefined, loading: boolean): string {
  if (Number.isFinite(value)) {
    return (value as number).toLocaleString()
  }
  return loading ? '统计中...' : '—'
}

export default function SessionDetailPanel({
  open,
  sessionDetail,
  isLoadingSessionDetail,
  isLoadingSessionDetailExtra,
  isRefreshingSessionDetailStats,
  isLoadingSessionRelationStats,
  copiedDetailField,
  currentSessionExportRecords,
  sessionDetailSupportsSnsTimeline,
  sessionDetailSnsCountLabel,
  onClose,
  onCopyDetailField,
  onOpenSessionSnsTimeline,
  onOpenPath,
  onLoadSessionRelationStats,
  formatPathBrief,
  formatYmdHmDateTime,
  formatYmdDateFromSeconds
}: SessionDetailPanelProps) {
  if (!open) return null

  const relationAction = (
    <button
      className="detail-inline-btn"
      onClick={() => { onLoadSessionRelationStats() }}
      disabled={isLoadingSessionRelationStats || isLoadingSessionDetailExtra}
    >
      {isLoadingSessionRelationStats ? '加载中...' : '点击加载'}
    </button>
  )

  return (
    <div className="export-session-detail-overlay" onClick={onClose}>
      <aside
        className="export-session-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-label="会话详情"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="detail-header">
          <div className="detail-header-main">
            <div className="detail-header-avatar">
              <AvatarImage src={sessionDetail?.avatarUrl} name={sessionDetail?.displayName || sessionDetail?.wxid || ''} alt="" loading="eager" />
            </div>
            <div className="detail-header-meta">
              <h4>{sessionDetail?.displayName || '会话详情'}</h4>
              <div className="detail-header-id">{sessionDetail?.wxid || ''}</div>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {isLoadingSessionDetail && !sessionDetail ? (
          <div className="detail-loading">
            <Loader2 size={20} className="spin" />
            <span>加载中...</span>
          </div>
        ) : sessionDetail ? (
          <div className="detail-content">
            <div className="detail-section">
              <div className="detail-item">
                <Hash size={14} />
                <span className="label">微信ID</span>
                <span className="value">{sessionDetail.wxid}</span>
                <button className="copy-btn" title="复制" onClick={() => onCopyDetailField(sessionDetail.wxid, 'wxid')}>
                  {copiedDetailField === 'wxid' ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
              {sessionDetail.remark && (
                <div className="detail-item">
                  <span className="label">备注</span>
                  <span className="value">{sessionDetail.remark}</span>
                  <button className="copy-btn" title="复制" onClick={() => onCopyDetailField(sessionDetail.remark || '', 'remark')}>
                    {copiedDetailField === 'remark' ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              )}
              {sessionDetail.nickName && (
                <div className="detail-item">
                  <span className="label">昵称</span>
                  <span className="value">{sessionDetail.nickName}</span>
                  <button className="copy-btn" title="复制" onClick={() => onCopyDetailField(sessionDetail.nickName || '', 'nickName')}>
                    {copiedDetailField === 'nickName' ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              )}
              {sessionDetail.alias && (
                <div className="detail-item">
                  <span className="label">微信号</span>
                  <span className="value">{sessionDetail.alias}</span>
                  <button className="copy-btn" title="复制" onClick={() => onCopyDetailField(sessionDetail.alias || '', 'alias')}>
                    {copiedDetailField === 'alias' ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              )}
              {sessionDetailSupportsSnsTimeline && (
                <div className="detail-item">
                  <Aperture size={14} />
                  <span className="label">朋友圈</span>
                  <span className="value">
                    <button
                      className="detail-inline-btn detail-sns-entry-btn"
                      type="button"
                      onClick={onOpenSessionSnsTimeline}
                    >
                      {sessionDetailSnsCountLabel}
                    </button>
                  </span>
                </div>
              )}
            </div>

            <div className="detail-section">
              <div className="section-title">
                <ClipboardList size={14} />
                <span>导出记录（最近 20 条）</span>
              </div>
              {currentSessionExportRecords.length === 0 ? (
                <div className="detail-record-empty">暂无导出记录</div>
              ) : (
                <div className="detail-record-list">
                  {currentSessionExportRecords.map((record, index) => (
                    <div className="detail-record-item" key={`${record.exportTime}-${record.content}-${index}`}>
                      <div className="record-row">
                        <span className="label">导出时间</span>
                        <span className="value">{formatYmdHmDateTime(record.exportTime)}</span>
                      </div>
                      <div className="record-row">
                        <span className="label">导出内容</span>
                        <span className="value">{record.content}</span>
                      </div>
                      <div className="record-row">
                        <span className="label">导出目录</span>
                        <span className="value path" title={record.outputDir}>{formatPathBrief(record.outputDir)}</span>
                        <button className="detail-inline-btn" type="button" onClick={() => onOpenPath(record.outputDir)}>
                          打开
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="detail-section">
              <div className="section-title">
                <MessageSquare size={14} />
                <span>消息统计（导出口径）</span>
              </div>
              <div className="detail-stats-meta">
                {isRefreshingSessionDetailStats
                  ? '统计刷新中...'
                  : sessionDetail.statsUpdatedAt
                    ? `${sessionDetail.statsStale ? '缓存于' : '更新于'} ${formatYmdHmDateTime(sessionDetail.statsUpdatedAt)}${sessionDetail.statsStale ? '（将后台刷新）' : ''}`
                    : (isLoadingSessionDetailExtra ? '统计加载中...' : '暂无统计缓存')}
              </div>
              <div className="detail-item">
                <span className="label">消息总数</span>
                <span className="value highlight">
                  {Number.isFinite(sessionDetail.messageCount)
                    ? sessionDetail.messageCount.toLocaleString()
                    : ((isLoadingSessionDetail || isLoadingSessionDetailExtra) ? '统计中...' : '—')}
                </span>
              </div>
              <div className="detail-item"><span className="label">语音</span><span className="value">{renderNumericValue(sessionDetail.voiceMessages, isLoadingSessionDetailExtra)}</span></div>
              <div className="detail-item"><span className="label">图片</span><span className="value">{renderNumericValue(sessionDetail.imageMessages, isLoadingSessionDetailExtra)}</span></div>
              <div className="detail-item"><span className="label">视频</span><span className="value">{renderNumericValue(sessionDetail.videoMessages, isLoadingSessionDetailExtra)}</span></div>
              <div className="detail-item"><span className="label">表情包</span><span className="value">{renderNumericValue(sessionDetail.emojiMessages, isLoadingSessionDetailExtra)}</span></div>
              <div className="detail-item"><span className="label">转账消息数</span><span className="value">{renderNumericValue(sessionDetail.transferMessages, isLoadingSessionDetailExtra)}</span></div>
              <div className="detail-item"><span className="label">红包消息数</span><span className="value">{renderNumericValue(sessionDetail.redPacketMessages, isLoadingSessionDetailExtra)}</span></div>
              <div className="detail-item"><span className="label">通话消息数</span><span className="value">{renderNumericValue(sessionDetail.callMessages, isLoadingSessionDetailExtra)}</span></div>
              {sessionDetail.wxid.includes('@chatroom') ? (
                <>
                  <div className="detail-item"><span className="label">我发的消息数</span><span className="value">{renderNumericValue(sessionDetail.groupMyMessages, isLoadingSessionDetailExtra)}</span></div>
                  <div className="detail-item"><span className="label">群人数</span><span className="value">{renderNumericValue(sessionDetail.groupMemberCount, isLoadingSessionDetailExtra)}</span></div>
                  <div className="detail-item"><span className="label">群发言人数</span><span className="value">{renderNumericValue(sessionDetail.groupActiveSpeakers, isLoadingSessionDetailExtra)}</span></div>
                  <div className="detail-item">
                    <span className="label">群共同好友数</span>
                    <span className="value">
                      {sessionDetail.relationStatsLoaded
                        ? (Number.isFinite(sessionDetail.groupMutualFriends) ? (sessionDetail.groupMutualFriends as number).toLocaleString() : '—')
                        : relationAction}
                    </span>
                  </div>
                </>
              ) : (
                <div className="detail-item">
                  <span className="label">共同群聊数</span>
                  <span className="value">
                    {sessionDetail.relationStatsLoaded
                      ? (Number.isFinite(sessionDetail.privateMutualGroups) ? (sessionDetail.privateMutualGroups as number).toLocaleString() : '—')
                      : relationAction}
                  </span>
                </div>
              )}
              <div className="detail-item">
                <Calendar size={14} />
                <span className="label">首条消息</span>
                <span className="value">
                  {sessionDetail.firstMessageTime
                    ? formatYmdDateFromSeconds(sessionDetail.firstMessageTime)
                    : (isLoadingSessionDetailExtra ? '统计中...' : '—')}
                </span>
              </div>
              <div className="detail-item">
                <Calendar size={14} />
                <span className="label">最新消息</span>
                <span className="value">
                  {sessionDetail.latestMessageTime
                    ? formatYmdDateFromSeconds(sessionDetail.latestMessageTime)
                    : (isLoadingSessionDetailExtra ? '统计中...' : '—')}
                </span>
              </div>
            </div>

            <div className="detail-section">
              <div className="section-title">
                <Database size={14} />
                <span>数据库分布</span>
              </div>
              {Array.isArray(sessionDetail.messageTables) && sessionDetail.messageTables.length > 0 ? (
                <div className="table-list">
                  {sessionDetail.messageTables.map((table, index) => (
                    <div key={`${table.dbName}-${table.tableName}-${index}`} className="table-item">
                      <span className="db-name">{table.dbName}</span>
                      <span className="table-count">{table.count.toLocaleString()} 条</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="detail-table-placeholder">
                  {isLoadingSessionDetailExtra ? '统计中...' : '暂无统计数据'}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="detail-empty">暂无详情</div>
        )}
      </aside>
    </div>
  )
}
