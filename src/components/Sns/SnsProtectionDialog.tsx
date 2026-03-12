import { AlertCircle, CheckCircle, RefreshCw, Shield, ShieldOff, X } from 'lucide-react'

type TriggerMessage = { type: 'success' | 'error'; text: string }

type SnsProtectionDialogProps = {
  open: boolean
  triggerInstalled: boolean | null
  triggerLoading: boolean
  triggerMessage: TriggerMessage | null
  onClose: () => void
  onEnable: () => void | Promise<void>
  onDisable: () => void | Promise<void>
}

export function SnsProtectionDialog({
  open,
  triggerInstalled,
  triggerLoading,
  triggerMessage,
  onClose,
  onEnable,
  onDisable
}: SnsProtectionDialogProps) {
  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="sns-protect-dialog" onClick={(event) => event.stopPropagation()}>
        <button className="close-btn sns-protect-close" onClick={onClose}>
          <X size={18} />
        </button>

        <div className="sns-protect-hero">
          <div className={`sns-protect-icon-wrap ${triggerInstalled ? 'active' : ''}`}>
            {triggerLoading
              ? <RefreshCw size={28} className="spinning" />
              : triggerInstalled
                ? <Shield size={28} />
                : <ShieldOff size={28} />}
          </div>
          <div className="sns-protect-title">朋友圈防删除</div>
          <div className={`sns-protect-status-badge ${triggerInstalled ? 'on' : 'off'}`}>
            {triggerLoading ? '检查中…' : triggerInstalled ? '已启用' : '未启用'}
          </div>
        </div>

        <div className="sns-protect-desc">
          启用后，Chat Capsule 将拦截朋友圈删除操作<br />
          已同步的动态不会从本地数据库中消失<br />
          新的动态仍可正常同步。
        </div>

        {triggerMessage && (
          <div className={`sns-protect-feedback ${triggerMessage.type}`}>
            {triggerMessage.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            <span>{triggerMessage.text}</span>
          </div>
        )}

        <div className="sns-protect-actions">
          {!triggerInstalled ? (
            <button className="sns-protect-btn primary" disabled={triggerLoading} onClick={() => void onEnable()}>
              <Shield size={15} />
              启用保护
            </button>
          ) : (
            <button className="sns-protect-btn danger" disabled={triggerLoading} onClick={() => void onDisable()}>
              <ShieldOff size={15} />
              关闭保护
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
