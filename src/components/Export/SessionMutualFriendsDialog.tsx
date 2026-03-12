import { X } from 'lucide-react'
import { AvatarImage } from '../AvatarImage'

type SessionMutualFriendDirection = 'incoming' | 'outgoing' | 'bidirectional'
type SessionMutualFriendBehavior = 'likes' | 'comments' | 'both'

interface SessionMutualFriendItemLike {
  name: string
  incomingLikeCount: number
  incomingCommentCount: number
  outgoingLikeCount: number
  outgoingCommentCount: number
  totalCount: number
  latestTime: number
  direction: SessionMutualFriendDirection
  behavior: SessionMutualFriendBehavior
}

interface SessionMutualFriendsMetricLike {
  count: number
  items: SessionMutualFriendItemLike[]
  loadedPosts: number
  totalPosts: number | null
}

interface SessionMutualFriendsDialogTargetLike {
  username: string
  displayName: string
  avatarUrl?: string
}

interface SessionMutualFriendsDialogProps {
  target: SessionMutualFriendsDialogTargetLike | null
  metric: SessionMutualFriendsMetricLike | null
  search: string
  filteredItems: SessionMutualFriendItemLike[]
  onSearchChange: (value: string) => void
  onClose: () => void
  formatYmdDateFromSeconds: (value: number) => string
  getDirectionLabel: (direction: SessionMutualFriendDirection) => string
  describeRelation: (item: SessionMutualFriendItemLike, targetDisplayName: string) => string
}

export default function SessionMutualFriendsDialog({
  target,
  metric,
  search,
  filteredItems,
  onSearchChange,
  onClose,
  formatYmdDateFromSeconds,
  getDirectionLabel,
  describeRelation
}: SessionMutualFriendsDialogProps) {
  if (!target || !metric) return null

  return (
    <div className="session-mutual-friends-overlay" onClick={onClose}>
      <div
        className="session-mutual-friends-modal"
        role="dialog"
        aria-modal="true"
        aria-label="共同好友"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-mutual-friends-header">
          <div className="session-mutual-friends-header-main">
            <div className="session-mutual-friends-avatar">
              <AvatarImage src={target.avatarUrl} name={target.displayName} alt="" loading="eager" />
            </div>
            <div className="session-mutual-friends-meta">
              <h4>{target.displayName} 的共同好友</h4>
              <div className="session-mutual-friends-stats">
                共 {metric.count.toLocaleString('zh-CN')} 人
                {metric.totalPosts !== null
                  ? ` · 已统计 ${metric.loadedPosts.toLocaleString('zh-CN')} / ${metric.totalPosts.toLocaleString('zh-CN')} 条朋友圈`
                  : ` · 已统计 ${metric.loadedPosts.toLocaleString('zh-CN')} 条朋友圈`}
              </div>
            </div>
          </div>
          <button
            className="session-mutual-friends-close"
            type="button"
            onClick={onClose}
            aria-label="关闭共同好友弹窗"
          >
            <X size={16} />
          </button>
        </div>

        <div className="session-mutual-friends-tip">
          打开桌面端微信，进入到这个人的朋友圈中，刷ta 的朋友圈，刷的越多这里的数据聚合越多
        </div>

        <div className="session-mutual-friends-toolbar">
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索共同好友"
            aria-label="搜索共同好友"
          />
        </div>

        <div className="session-mutual-friends-body">
          {filteredItems.length === 0 ? (
            <div className="session-mutual-friends-empty">
              {search.trim() ? '没有匹配的共同好友' : '暂无共同好友数据'}
            </div>
          ) : (
            <div className="session-mutual-friends-list">
              {filteredItems.map((item, index) => {
                const relationText = describeRelation(item, target.displayName)
                return (
                  <div className="session-mutual-friends-row" key={`${target.username}-${item.name}`}>
                    <span className="session-mutual-friends-rank">{index + 1}</span>
                    <span className="session-mutual-friends-name" title={item.name}>{item.name}</span>
                    <span className={`session-mutual-friends-source ${item.direction}`}>
                      {getDirectionLabel(item.direction)}
                    </span>
                    <span className="session-mutual-friends-count">{item.totalCount.toLocaleString('zh-CN')}</span>
                    <span className="session-mutual-friends-latest">{formatYmdDateFromSeconds(item.latestTime)}</span>
                    <span className="session-mutual-friends-desc" title={relationText}>{relationText}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
