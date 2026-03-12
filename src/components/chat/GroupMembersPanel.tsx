import { Crown, Loader2, Search, UserCheck, X } from 'lucide-react'
import { Avatar } from '../Avatar'

interface GroupPanelMemberLike {
  username: string
  displayName: string
  avatarUrl?: string
  alias?: string
  isOwner?: boolean
  isFriend: boolean
  messageCount: number
  messageCountStatus: 'loading' | 'ready' | 'failed'
}

interface GroupMembersPanelProps {
  open: boolean
  totalCount: number
  searchKeyword: string
  onSearchKeywordChange: (value: string) => void
  isRefreshing: boolean
  error: string | null
  allMembersCount: number
  filteredMembers: GroupPanelMemberLike[]
  isLoading: boolean
  loadingHint?: string
  onClose: () => void
}

export default function GroupMembersPanel({
  open,
  totalCount,
  searchKeyword,
  onSearchKeywordChange,
  isRefreshing,
  error,
  allMembersCount,
  filteredMembers,
  isLoading,
  loadingHint,
  onClose
}: GroupMembersPanelProps) {
  if (!open) return null

  return (
    <div className="detail-panel group-members-panel">
      <div className="detail-header">
        <h4>群成员</h4>
        <button className="close-btn" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="group-members-toolbar">
        <span className="group-members-count">共 {totalCount} 人</span>
        <div className="group-members-search">
          <Search size={14} />
          <input
            type="text"
            value={searchKeyword}
            onChange={(event) => onSearchKeywordChange(event.target.value)}
            placeholder="搜索成员"
          />
        </div>
      </div>

      {isRefreshing && (
        <div className="group-members-status" role="status" aria-live="polite">
          <Loader2 size={14} className="spin" />
          <span>正在统计成员发言数...</span>
        </div>
      )}
      {error && allMembersCount > 0 && (
        <div className="group-members-status warning" role="status" aria-live="polite">
          <span>{error}</span>
        </div>
      )}

      {isLoading ? (
        <div className="detail-loading">
          <Loader2 size={20} className="spin" />
          <span>{loadingHint || '加载群成员中...'}</span>
        </div>
      ) : error && allMembersCount === 0 ? (
        <div className="detail-empty">{error}</div>
      ) : filteredMembers.length === 0 ? (
        <div className="detail-empty">{searchKeyword.trim() ? '暂无匹配成员' : '暂无群成员数据'}</div>
      ) : (
        <div className="group-members-list">
          {filteredMembers.map((member) => (
            <div key={member.username} className="group-member-item">
              <div className="group-member-main">
                <Avatar
                  src={member.avatarUrl}
                  name={member.displayName || member.username}
                  size={34}
                  className="group-member-avatar"
                />
                <div className="group-member-meta">
                  <div className="group-member-name-row">
                    <span className="group-member-name" title={member.displayName || member.username}>
                      {member.displayName || member.username}
                    </span>
                    <div className="group-member-badges">
                      {member.isOwner && (
                        <span className="member-flag owner" title="群主">
                          <Crown size={12} />
                        </span>
                      )}
                      {member.isFriend && (
                        <span className="member-flag friend" title="好友">
                          <UserCheck size={12} />
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="group-member-id" title={member.alias || member.username}>
                    {member.alias || member.username}
                  </span>
                </div>
              </div>
              <span className={`group-member-count ${member.messageCountStatus}`}>
                {member.messageCountStatus === 'loading'
                  ? '统计中'
                  : member.messageCountStatus === 'failed'
                    ? '统计失败'
                    : `${member.messageCount.toLocaleString()} 条`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
