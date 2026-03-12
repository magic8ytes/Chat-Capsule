import { AvatarImage } from './AvatarImage'

interface SidebarClearAccountDialogProps {
  accountDisplayName: string
  accountSecondaryText: string
  accountAvatarUrl?: string
  canConfirmClear: boolean
  isClearingAccountData: boolean
  shouldClearCacheData: boolean
  shouldClearExportData: boolean
  shouldClearProfileData: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  onClearCacheDataChange: (checked: boolean) => void
  onClearExportDataChange: (checked: boolean) => void
  onClearProfileDataChange: (checked: boolean) => void
}

function SidebarClearAccountDialog({
  accountDisplayName,
  accountSecondaryText,
  accountAvatarUrl,
  canConfirmClear,
  isClearingAccountData,
  shouldClearCacheData,
  shouldClearExportData,
  shouldClearProfileData,
  onClose,
  onConfirm,
  onClearCacheDataChange,
  onClearExportDataChange,
  onClearProfileDataChange
}: SidebarClearAccountDialogProps) {
  return (
    <div className="sidebar-clear-dialog-overlay" onClick={() => !isClearingAccountData && onClose()}>
      <div className="sidebar-clear-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h3>清除此账号所有数据</h3>
        <div className="sidebar-clear-account-preview">
          <div className="sidebar-clear-account-avatar">
            <AvatarImage src={accountAvatarUrl} name={accountDisplayName} alt="" loading="eager" />
          </div>
          <div className="sidebar-clear-account-meta">
            <div className="sidebar-clear-account-name">{accountDisplayName || '当前账号'}</div>
            <div className="sidebar-clear-account-id">{accountSecondaryText || 'wxid 未识别'}</div>
          </div>
        </div>
        <p>
          操作后可将该账户在 weflow 下产生的缓存、导出文件等彻底清除。
          如同时删除 profile.json，下次进入需要重新导入配置文件。
        </p>
        <div className="sidebar-clear-options">
          <label>
            <input
              type="checkbox"
              checked={shouldClearCacheData}
              onChange={(event) => onClearCacheDataChange(event.target.checked)}
              disabled={isClearingAccountData}
            />
            缓存数据
          </label>
          <label>
            <input
              type="checkbox"
              checked={shouldClearExportData}
              onChange={(event) => onClearExportDataChange(event.target.checked)}
              disabled={isClearingAccountData}
            />
            导出数据
          </label>
          <label>
            <input
              type="checkbox"
              checked={shouldClearProfileData}
              onChange={(event) => onClearProfileDataChange(event.target.checked)}
              disabled={isClearingAccountData}
            />
            删除 profile.json
          </label>
        </div>
        <div className="sidebar-clear-actions">
          <button type="button" onClick={onClose} disabled={isClearingAccountData}>取消</button>
          <button
            type="button"
            className="danger"
            disabled={!canConfirmClear || isClearingAccountData}
            onClick={onConfirm}
          >
            {isClearingAccountData ? '清除中...' : '确认清除'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SidebarClearAccountDialog
