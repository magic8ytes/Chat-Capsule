import { CheckSquare, Loader2, Square } from 'lucide-react'
import type { ContactInfo } from '../../types/models'
import { AvatarImage } from '../AvatarImage'

export type ExportContactMetricState =
  | { state: 'value'; text: string }
  | { state: 'loading' }
  | { state: 'na'; text: '--' }

interface ExportContactRowProps {
  contact: ContactInfo
  checked: boolean
  canExport: boolean
  isRunning: boolean
  isQueued: boolean
  hasRecentExport: boolean
  recentExportTime: string
  messageCountState: ExportContactMetricState
  emojiMetric: ExportContactMetricState
  voiceMetric: ExportContactMetricState
  imageMetric: ExportContactMetricState
  videoMetric: ExportContactMetricState
  shouldShowSnsColumn: boolean
  shouldShowMutualFriendsColumn: boolean
  supportsSnsTimeline: boolean
  isSnsCountLoading: boolean
  hasSnsCount: boolean
  snsCount: number
  isMutualFriendsLoading: boolean
  hasMutualFriendsMetric: boolean
  mutualFriendsCount: number
  detailActive: boolean
  openChatLabel: string
  onToggleSelect: () => void
  onOpenChat: () => void
  onOpenSns: () => void
  onOpenMutualFriends: () => void
  onOpenSingleExport: () => void
  onOpenSessionDetail: () => void
}

function renderMetric(metric: ExportContactMetricState, loadingLabel: string) {
  if (metric.state === 'loading') {
    return <Loader2 size={12} className="spin row-media-metric-icon" aria-label={loadingLabel} />
  }

  return metric.text
}

export default function ExportContactRow({
  contact,
  checked,
  canExport,
  isRunning,
  isQueued,
  hasRecentExport,
  recentExportTime,
  messageCountState,
  emojiMetric,
  voiceMetric,
  imageMetric,
  videoMetric,
  shouldShowSnsColumn,
  shouldShowMutualFriendsColumn,
  supportsSnsTimeline,
  isSnsCountLoading,
  hasSnsCount,
  snsCount,
  isMutualFriendsLoading,
  hasMutualFriendsMetric,
  mutualFriendsCount,
  detailActive,
  openChatLabel,
  onToggleSelect,
  onOpenChat,
  onOpenSns,
  onOpenMutualFriends,
  onOpenSingleExport,
  onOpenSessionDetail
}: ExportContactRowProps) {
  const displayName = contact.displayName || contact.username

  return (
    <div className={`contact-row ${checked ? 'selected' : ''}`}>
      <div className="contact-item">
        <div className="row-select-cell">
          <button
            className={`select-icon-btn ${checked ? 'checked' : ''}`}
            type="button"
            disabled={!canExport}
            onClick={onToggleSelect}
            title={canExport ? (checked ? '取消选择' : '选择会话') : '该联系人暂无会话记录'}
          >
            {checked ? <CheckSquare size={16} /> : <Square size={16} />}
          </button>
        </div>
        <div className="contact-avatar">
          <AvatarImage src={contact.avatarUrl} name={displayName} alt="" loading="lazy" />
        </div>
        <div className="contact-info">
          <div className="contact-name">{displayName}</div>
          <div className="contact-remark">{contact.alias || contact.username}</div>
        </div>
        <div className="row-message-count">
          <div className="row-message-stats">
            <strong className={`row-message-count-value ${messageCountState.state === 'value' ? '' : 'muted'}`}>
              {renderMetric(messageCountState, '统计加载中')}
            </strong>
          </div>
          {canExport && (
            <button
              type="button"
              className="row-open-chat-link"
              title="在新窗口打开该会话"
              onClick={onOpenChat}
            >
              {openChatLabel}
            </button>
          )}
        </div>
        <div className="row-media-metric">
          <strong className="row-media-metric-value">{renderMetric(emojiMetric, '统计加载中')}</strong>
        </div>
        <div className="row-media-metric">
          <strong className="row-media-metric-value">{renderMetric(voiceMetric, '统计加载中')}</strong>
        </div>
        <div className="row-media-metric">
          <strong className="row-media-metric-value">{renderMetric(imageMetric, '统计加载中')}</strong>
        </div>
        <div className="row-media-metric">
          <strong className="row-media-metric-value">{renderMetric(videoMetric, '统计加载中')}</strong>
        </div>
        {shouldShowSnsColumn && (
          <div className="row-media-metric">
            {supportsSnsTimeline ? (
              <button
                type="button"
                className={`row-sns-metric-btn ${isSnsCountLoading ? 'loading' : ''}`}
                title={`查看 ${displayName} 的朋友圈`}
                onClick={onOpenSns}
              >
                {isSnsCountLoading
                  ? <Loader2 size={12} className="spin row-media-metric-icon" aria-label="朋友圈统计加载中" />
                  : hasSnsCount
                    ? `${snsCount.toLocaleString('zh-CN')} 条`
                    : '--'}
              </button>
            ) : (
              <strong className="row-media-metric-value">--</strong>
            )}
          </div>
        )}
        {shouldShowMutualFriendsColumn && (
          <div className="row-media-metric">
            {supportsSnsTimeline ? (
              <button
                type="button"
                className={`row-sns-metric-btn row-mutual-friends-btn ${isMutualFriendsLoading ? 'loading' : ''} ${hasMutualFriendsMetric ? 'ready' : ''}`}
                title={`查看 ${displayName} 的共同好友`}
                onClick={onOpenMutualFriends}
                disabled={!hasMutualFriendsMetric}
              >
                {isMutualFriendsLoading
                  ? <Loader2 size={12} className="spin row-media-metric-icon" aria-label="共同好友统计加载中" />
                  : hasMutualFriendsMetric
                    ? mutualFriendsCount.toLocaleString('zh-CN')
                    : '--'}
              </button>
            ) : (
              <strong className="row-media-metric-value">--</strong>
            )}
          </div>
        )}
        <div className="row-action-cell">
          <div className={`row-action-main ${hasRecentExport ? '' : 'single-line'}`.trim()}>
            <div className={`row-export-action-stack ${hasRecentExport ? '' : 'single-line'}`.trim()}>
              <button
                type="button"
                className={`row-export-link ${isRunning ? 'state-running' : ''} ${!canExport ? 'state-disabled' : ''}`}
                disabled={!canExport || isRunning}
                onClick={onOpenSingleExport}
              >
                {!canExport ? '暂无会话' : isRunning ? '导出中...' : isQueued ? '排队中' : '单会话导出'}
              </button>
              {hasRecentExport && <span className="row-export-time">{recentExportTime}</span>}
            </div>
            <button
              className={`row-detail-btn ${detailActive ? 'active' : ''}`}
              onClick={onOpenSessionDetail}
            >
              详情
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
