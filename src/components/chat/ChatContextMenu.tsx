import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import type { Message } from '../../types/models'

interface ChatContextMenuProps {
  contextMenu: { x: number; y: number; message: Message } | null
  onClose: () => void
  onViewInfo: (message: Message) => void
}

export default function ChatContextMenu({
  contextMenu,
  onClose,
  onViewInfo
}: ChatContextMenuProps) {
  if (!contextMenu) return null

  return createPortal(
    <>
      <div
        className="context-menu-overlay"
        onClick={onClose}
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 }}
      />
      <div
        className="context-menu"
        style={{
          position: 'fixed',
          top: contextMenu.y,
          left: contextMenu.x,
          zIndex: 9999
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="menu-item" onClick={() => onViewInfo(contextMenu.message)}>
          <Info size={16} />
          <span>查看消息信息</span>
        </div>
      </div>
    </>,
    document.body
  )
}
