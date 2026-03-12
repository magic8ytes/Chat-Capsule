import { Calendar, Check, Copy, Database, Hash, Loader2, MessageSquare, X } from 'lucide-react'

interface SessionDetailLike {
  wxid: string
  remark?: string
  nickName?: string
  alias?: string
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
  messageTables: { dbName: string; tableName: string; count: number }[]
}

interface SessionDetailPanelProps {
  open: boolean
  sessionDetail: SessionDetailLike | null
  isLoadingDetail: boolean
  isLoadingDetailExtra: boolean
  isRefreshingDetailStats: boolean
  isLoadingRelationStats: boolean
  copiedField: string | null
  onCopyField: (text: string, field: string) => void
  onLoadRelationStats: () => void
  onClose: () => void
  formatStatsDateTime: (timestamp?: number) => string
  formatMessageDate: (timestamp?: number) => string
}

function renderMetric(value: number | undefined, loading: boolean): string {
  return Number.isFinite(value) ? (value as number).toLocaleString() : (loading ? '统计中...' : '—')
}

export default function SessionDetailPanel({
  open,
  sessionDetail,
  isLoadingDetail,
  isLoadingDetailExtra,
  isRefreshingDetailStats,
  isLoadingRelationStats,
  copiedField,
  onCopyField,
  onLoadRelationStats,
  onClose,
  formatStatsDateTime,
  formatMessageDate
}: SessionDetailPanelProps) {
  if (!open) return null

  const renderRelationTrigger = () => (
    <button
      className="detail-inline-btn"
      onClick={onLoadRelationStats}
      disabled={isLoadingRelationStats || isLoadingDetailExtra}
    >
      {isLoadingRelationStats ? '加载中...' : '点击加载'}
    </button>
  )

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <h4>会话详情</h4>
        <button className="close-btn" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {isLoadingDetail && !sessionDetail ? (
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
              <button className="copy-btn" title="复制" onClick={() => onCopyField(sessionDetail.wxid, 'wxid')}>
                {copiedField === 'wxid' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
            {sessionDetail.remark && (
              <div className="detail-item">
                <span className="label">备注</span>
                <span className="value">{sessionDetail.remark}</span>
                <button className="copy-btn" title="复制" onClick={() => onCopyField(sessionDetail.remark!, 'remark')}>
                  {copiedField === 'remark' ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            )}
            {sessionDetail.nickName && (
              <div className="detail-item">
                <span className="label">昵称</span>
                <span className="value">{sessionDetail.nickName}</span>
                <button className="copy-btn" title="复制" onClick={() => onCopyField(sessionDetail.nickName!, 'nickName')}>
                  {copiedField === 'nickName' ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            )}
            {sessionDetail.alias && (
              <div className="detail-item">
                <span className="label">微信号</span>
                <span className="value">{sessionDetail.alias}</span>
                <button className="copy-btn" title="复制" onClick={() => onCopyField(sessionDetail.alias!, 'alias')}>
                  {copiedField === 'alias' ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            )}
          </div>

          <div className="detail-section">
            <div className="section-title">
              <MessageSquare size={14} />
              <span>消息统计（导出口径）</span>
            </div>
            <div className="detail-stats-meta">
              {isRefreshingDetailStats
                ? '统计刷新中...'
                : sessionDetail.statsUpdatedAt
                  ? `${sessionDetail.statsStale ? '缓存于' : '更新于'} ${formatStatsDateTime(sessionDetail.statsUpdatedAt)}${sessionDetail.statsStale ? '（将后台刷新）' : ''}`
                  : (isLoadingDetailExtra ? '统计加载中...' : '暂无统计缓存')}
            </div>
            <div className="detail-item">
              <span className="label">消息总数</span>
              <span className="value highlight">{renderMetric(sessionDetail.messageCount, isLoadingDetail || isLoadingDetailExtra)}</span>
            </div>
            <div className="detail-item">
              <span className="label">语音</span>
              <span className="value">{renderMetric(sessionDetail.voiceMessages, isLoadingDetailExtra)}</span>
            </div>
            <div className="detail-item">
              <span className="label">图片</span>
              <span className="value">{renderMetric(sessionDetail.imageMessages, isLoadingDetailExtra)}</span>
            </div>
            <div className="detail-item">
              <span className="label">视频</span>
              <span className="value">{renderMetric(sessionDetail.videoMessages, isLoadingDetailExtra)}</span>
            </div>
            <div className="detail-item">
              <span className="label">表情包</span>
              <span className="value">{renderMetric(sessionDetail.emojiMessages, isLoadingDetailExtra)}</span>
            </div>
            <div className="detail-item">
              <span className="label">转账消息数</span>
              <span className="value">{renderMetric(sessionDetail.transferMessages, isLoadingDetailExtra)}</span>
            </div>
            <div className="detail-item">
              <span className="label">红包消息数</span>
              <span className="value">{renderMetric(sessionDetail.redPacketMessages, isLoadingDetailExtra)}</span>
            </div>
            <div className="detail-item">
              <span className="label">通话消息数</span>
              <span className="value">{renderMetric(sessionDetail.callMessages, isLoadingDetailExtra)}</span>
            </div>
            {sessionDetail.wxid.includes('@chatroom') ? (
              <>
                <div className="detail-item">
                  <span className="label">我发的消息数</span>
                  <span className="value">{renderMetric(sessionDetail.groupMyMessages, isLoadingDetailExtra)}</span>
                </div>
                <div className="detail-item">
                  <span className="label">群人数</span>
                  <span className="value">{renderMetric(sessionDetail.groupMemberCount, isLoadingDetailExtra)}</span>
                </div>
                <div className="detail-item">
                  <span className="label">群发言人数</span>
                  <span className="value">{renderMetric(sessionDetail.groupActiveSpeakers, isLoadingDetailExtra)}</span>
                </div>
                <div className="detail-item">
                  <span className="label">群共同好友数</span>
                  <span className="value">
                    {sessionDetail.relationStatsLoaded
                      ? (Number.isFinite(sessionDetail.groupMutualFriends)
                        ? (sessionDetail.groupMutualFriends as number).toLocaleString()
                        : '—')
                      : renderRelationTrigger()}
                  </span>
                </div>
              </>
            ) : (
              <div className="detail-item">
                <span className="label">共同群聊数</span>
                <span className="value">
                  {sessionDetail.relationStatsLoaded
                    ? (Number.isFinite(sessionDetail.privateMutualGroups)
                      ? (sessionDetail.privateMutualGroups as number).toLocaleString()
                      : '—')
                    : renderRelationTrigger()}
                </span>
              </div>
            )}
            <div className="detail-item">
              <Calendar size={14} />
              <span className="label">首条消息</span>
              <span className="value">
                {sessionDetail.firstMessageTime
                  ? formatMessageDate(sessionDetail.firstMessageTime)
                  : (isLoadingDetailExtra ? '统计中...' : '—')}
              </span>
            </div>
            <div className="detail-item">
              <Calendar size={14} />
              <span className="label">最新消息</span>
              <span className="value">
                {sessionDetail.latestMessageTime
                  ? formatMessageDate(sessionDetail.latestMessageTime)
                  : (isLoadingDetailExtra ? '统计中...' : '—')}
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
                  <div key={index} className="table-item">
                    <span className="db-name">{table.dbName}</span>
                    <span className="table-count">{table.count.toLocaleString()} 条</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="detail-table-placeholder">
                {isLoadingDetailExtra ? '统计中...' : '暂无统计数据'}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="detail-empty">暂无详情</div>
      )}
    </div>
  )
}
