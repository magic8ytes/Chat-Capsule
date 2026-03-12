import { memo, useMemo } from 'react'
import { BellOff, FolderClosed } from 'lucide-react'
import type { ChatSession } from '../../types/models'
import { Avatar } from '../Avatar'

interface ChatSessionItemProps {
  session: ChatSession
  isActive: boolean
  unreadCount: number
  onSelect: (session: ChatSession) => void
  formatTime: (timestamp: number) => string
}

export const ChatSessionItem = memo(function ChatSessionItem({
  session,
  isActive,
  unreadCount,
  onSelect,
  formatTime
}: ChatSessionItemProps) {
  const timeText = useMemo(
    () => formatTime(session.lastTimestamp || session.sortTimestamp),
    [formatTime, session.lastTimestamp, session.sortTimestamp]
  )

  const isFoldEntry = session.username.toLowerCase().includes('placeholder_foldgroup')

  if (isFoldEntry) {
    return (
      <div className="session-item fold-entry" onClick={() => onSelect(session)}>
        <div className="fold-entry-avatar">
          <FolderClosed size={22} />
        </div>
        <div className="session-info">
          <div className="session-top">
            <span className="session-name">折叠的群聊</span>
          </div>
          <div className="session-bottom">
            <span className="session-summary">{session.summary || ''}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`session-item ${isActive ? 'active' : ''} ${session.isMuted ? 'muted' : ''}`}
      onClick={() => onSelect(session)}
    >
      <Avatar
        src={session.avatarUrl}
        name={session.displayName || session.username}
        size={48}
        className={session.username.includes('@chatroom') ? 'group' : ''}
      />
      <div className="session-info">
        <div className="session-top">
          <span className="session-name">{session.displayName || session.username}</span>
          <span className="session-time">{timeText}</span>
        </div>
        <div className="session-bottom">
          <span className="session-summary">{session.summary || '暂无消息'}</span>
          <div className="session-badges">
            {session.isMuted && <BellOff size={12} className="mute-icon" />}
            {unreadCount > 0 && (
              <span className={`unread-badge ${session.isMuted ? 'muted' : ''}`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}, (prevProps, nextProps) => (
  prevProps.session.username === nextProps.session.username &&
  prevProps.session.displayName === nextProps.session.displayName &&
  prevProps.session.avatarUrl === nextProps.session.avatarUrl &&
  prevProps.session.summary === nextProps.session.summary &&
  prevProps.session.unreadCount === nextProps.session.unreadCount &&
  prevProps.unreadCount === nextProps.unreadCount &&
  prevProps.session.lastTimestamp === nextProps.session.lastTimestamp &&
  prevProps.session.sortTimestamp === nextProps.session.sortTimestamp &&
  prevProps.session.isMuted === nextProps.session.isMuted &&
  prevProps.isActive === nextProps.isActive
))
