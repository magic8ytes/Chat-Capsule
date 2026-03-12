import { X } from 'lucide-react'

type SnsDebugDialogProps = {
  debugPost: unknown | null
  onClose: () => void
}

export function SnsDebugDialog({ debugPost, onClose }: SnsDebugDialogProps) {
  if (!debugPost) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="debug-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="debug-dialog-header">
          <h3>原始数据</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="debug-dialog-body">
          <pre className="json-code">{JSON.stringify(debugPost, null, 2)}</pre>
        </div>
      </div>
    </div>
  )
}
