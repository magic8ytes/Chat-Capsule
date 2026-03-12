import { Loader2, X } from 'lucide-react'

interface LoadStageSummaryLike {
  total: number
  loaded: number
  statusLabel: string
  startedAt?: number
  finishedAt?: number
}

interface SessionLoadDetailRowLike {
  tab: string
  label: string
  messageCount: LoadStageSummaryLike
  mediaMetrics: LoadStageSummaryLike
  snsPostCounts: LoadStageSummaryLike
  mutualFriends: LoadStageSummaryLike
}

interface SessionLoadDetailModalProps {
  open: boolean
  updatedAt: number
  rows: SessionLoadDetailRowLike[]
  pulseMap: Record<string, { at: number; delta: number }>
  formatLoadDetailTime: (value?: number) => string
  formatLoadDetailPulseTime: (value?: number) => string
  onClose: () => void
}

interface StageSectionConfig {
  key: 'messageCount' | 'mediaMetrics' | 'snsPostCounts' | 'mutualFriends'
  title: string
  rowKeyPrefix: string
  filter?: (row: SessionLoadDetailRowLike) => boolean
  pulseUnit: '条' | '个'
}

const stageSections: StageSectionConfig[] = [
  { key: 'messageCount', title: '总消息数', rowKeyPrefix: 'message', pulseUnit: '条' },
  { key: 'mediaMetrics', title: '多媒体统计（表情包/图片/视频/语音）', rowKeyPrefix: 'media', pulseUnit: '条' },
  {
    key: 'snsPostCounts',
    title: '朋友圈条数统计',
    rowKeyPrefix: 'sns-count',
    filter: (row) => row.tab === 'private' || row.tab === 'former_friend',
    pulseUnit: '条'
  },
  {
    key: 'mutualFriends',
    title: '共同好友统计',
    rowKeyPrefix: 'mutual-friends',
    filter: (row) => row.tab === 'private' || row.tab === 'former_friend',
    pulseUnit: '个'
  }
]

export default function SessionLoadDetailModal({
  open,
  updatedAt,
  rows,
  pulseMap,
  formatLoadDetailTime,
  formatLoadDetailPulseTime,
  onClose
}: SessionLoadDetailModalProps) {
  if (!open) return null

  return (
    <div className="session-load-detail-overlay" onClick={onClose}>
      <div
        className="session-load-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label="数据加载详情"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-load-detail-header">
          <div>
            <h4>数据加载详情</h4>
            <p>
              更新时间：
              {updatedAt > 0 ? new Date(updatedAt).toLocaleString('zh-CN') : '暂无'}
            </p>
          </div>
          <button
            className="session-load-detail-close"
            type="button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="session-load-detail-body">
          {stageSections.map((section) => {
            const sectionRows = section.filter ? rows.filter(section.filter) : rows
            return (
              <section className="session-load-detail-block" key={section.key}>
                <h5>{section.title}</h5>
                <div className="session-load-detail-table">
                  <div className="session-load-detail-row header">
                    <span>会话类型</span>
                    <span>加载状态</span>
                    <span>开始时间</span>
                    <span>完成时间</span>
                  </div>
                  {sectionRows.map((row) => {
                    const summary = row[section.key]
                    const pulse = pulseMap[`${section.key}:${row.tab}`]
                    const isLoading = summary.statusLabel.startsWith('加载中')
                    return (
                      <div className="session-load-detail-row" key={`${section.rowKeyPrefix}-${row.tab}`}>
                        <span>{row.label}</span>
                        <span className="session-load-detail-status-cell">
                          <span>{summary.statusLabel}</span>
                          {isLoading && (
                            <Loader2 size={12} className="spin session-load-detail-status-icon" aria-label="加载中" />
                          )}
                          {isLoading && pulse && pulse.delta > 0 && (
                            <span className="session-load-detail-progress-pulse">
                              {formatLoadDetailPulseTime(pulse.at)} +{pulse.delta}{section.pulseUnit}
                            </span>
                          )}
                        </span>
                        <span>{formatLoadDetailTime(summary.startedAt)}</span>
                        <span>{formatLoadDetailTime(summary.finishedAt)}</span>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
