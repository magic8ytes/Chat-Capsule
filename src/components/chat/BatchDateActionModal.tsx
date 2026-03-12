import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'

interface BatchDateActionModalProps {
  open: boolean
  icon: ReactNode
  title: string
  description: string
  dates: string[]
  countsByDate: Map<string, number>
  countLabel: (count: number) => string
  selectedDates: Set<string>
  onClose: () => void
  onSelectAll: () => void
  onClearAll: () => void
  onToggleDate: (date: string) => void
  formatDateLabel: (date: string) => string
  summaryRows: ReactNode
  warningText: string
  confirmText: string
  confirmIcon?: ReactNode
  onConfirm: () => void
}

export default function BatchDateActionModal({
  open,
  icon,
  title,
  description,
  dates,
  countsByDate,
  countLabel,
  selectedDates,
  onClose,
  onSelectAll,
  onClearAll,
  onToggleDate,
  formatDateLabel,
  summaryRows,
  warningText,
  confirmText,
  confirmIcon,
  onConfirm
}: BatchDateActionModalProps) {
  if (!open) return null

  return createPortal(
    <div className="batch-modal-overlay" onClick={onClose}>
      <div className="batch-modal-content batch-confirm-modal" onClick={(event) => event.stopPropagation()}>
        <div className="batch-modal-header">
          {icon}
          <h3>{title}</h3>
        </div>
        <div className="batch-modal-body">
          <p>{description}</p>
          {dates.length > 0 && (
            <div className="batch-dates-list-wrap">
              <div className="batch-dates-actions">
                <button type="button" className="batch-dates-btn" onClick={onSelectAll}>全选</button>
                <button type="button" className="batch-dates-btn" onClick={onClearAll}>取消全选</button>
              </div>
              <ul className="batch-dates-list">
                {dates.map((dateStr) => {
                  const count = countsByDate.get(dateStr) ?? 0
                  const checked = selectedDates.has(dateStr)
                  return (
                    <li key={dateStr}>
                      <label className="batch-date-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleDate(dateStr)}
                        />
                        <span className="batch-date-label">{formatDateLabel(dateStr)}</span>
                        <span className="batch-date-count">{countLabel(count)}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          <div className="batch-info">{summaryRows}</div>
          <div className="batch-warning">
            <AlertCircle size={16} />
            <span>{warningText}</span>
          </div>
        </div>
        <div className="batch-modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={onConfirm}>
            {confirmIcon}
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
