import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import {
  EXPORT_DATE_RANGE_PRESETS,
  WEEKDAY_SHORT_LABELS,
  addMonths,
  buildCalendarCells,
  cloneExportDateRangeSelection,
  createDateRangeByPreset,
  createDefaultDateRange,
  formatCalendarMonthTitle,
  formatDateInputValue,
  isSameDay,
  parseDateInputValue,
  startOfDay,
  endOfDay,
  toMonthStart,
  type ExportDateRangePreset,
  type ExportDateRangeSelection
} from '../../utils/exportDateRange'
import './ExportDateRangeDialog.scss'

interface ExportDateRangeDialogProps {
  open: boolean
  value: ExportDateRangeSelection
  title?: string
  onClose: () => void
  onConfirm: (value: ExportDateRangeSelection) => void
}

interface ExportDateRangeDialogDraft extends ExportDateRangeSelection {
  startPanelMonth: Date
  endPanelMonth: Date
}

const buildDialogDraft = (value: ExportDateRangeSelection): ExportDateRangeDialogDraft => ({
  ...cloneExportDateRangeSelection(value),
  startPanelMonth: toMonthStart(value.dateRange.start),
  endPanelMonth: toMonthStart(value.dateRange.end)
})

export function ExportDateRangeDialog({
  open,
  value,
  title = '时间范围设置',
  onClose,
  onConfirm
}: ExportDateRangeDialogProps) {
  const [draft, setDraft] = useState<ExportDateRangeDialogDraft>(() => buildDialogDraft(value))
  const [dateInput, setDateInput] = useState({
    start: formatDateInputValue(value.dateRange.start),
    end: formatDateInputValue(value.dateRange.end)
  })
  const [dateInputError, setDateInputError] = useState({ start: false, end: false })

  useEffect(() => {
    if (!open) return
    const nextDraft = buildDialogDraft(value)
    setDraft(nextDraft)
    setDateInput({
      start: formatDateInputValue(nextDraft.dateRange.start),
      end: formatDateInputValue(nextDraft.dateRange.end)
    })
    setDateInputError({ start: false, end: false })
  }, [open, value])

  useEffect(() => {
    if (!open) return
    setDateInput({
      start: formatDateInputValue(draft.dateRange.start),
      end: formatDateInputValue(draft.dateRange.end)
    })
    setDateInputError({ start: false, end: false })
  }, [draft.dateRange.end.getTime(), draft.dateRange.start.getTime(), open])

  const applyPreset = useCallback((preset: Exclude<ExportDateRangePreset, 'custom'>) => {
    if (preset === 'all') {
      const previewRange = createDefaultDateRange()
      setDraft(prev => ({
        ...prev,
        preset,
        useAllTime: true,
        dateRange: previewRange,
        startPanelMonth: toMonthStart(previewRange.start),
        endPanelMonth: toMonthStart(previewRange.end)
      }))
      return
    }

    const range = createDateRangeByPreset(preset)
    setDraft(prev => ({
      ...prev,
      preset,
      useAllTime: false,
      dateRange: range,
      startPanelMonth: toMonthStart(range.start),
      endPanelMonth: toMonthStart(range.end)
    }))
  }, [])

  const updateDraftStart = useCallback((targetDate: Date) => {
    const start = startOfDay(targetDate)
    setDraft(prev => {
      const nextEnd = prev.dateRange.end < start ? endOfDay(start) : prev.dateRange.end
      return {
        ...prev,
        preset: 'custom',
        useAllTime: false,
        dateRange: {
          start,
          end: nextEnd
        },
        startPanelMonth: toMonthStart(start),
        endPanelMonth: toMonthStart(nextEnd)
      }
    })
  }, [])

  const updateDraftEnd = useCallback((targetDate: Date) => {
    const end = endOfDay(targetDate)
    setDraft(prev => {
      const nextStart = prev.useAllTime ? startOfDay(targetDate) : prev.dateRange.start
      const nextEnd = end < nextStart ? endOfDay(nextStart) : end
      return {
        ...prev,
        preset: 'custom',
        useAllTime: false,
        dateRange: {
          start: nextStart,
          end: nextEnd
        },
        startPanelMonth: toMonthStart(nextStart),
        endPanelMonth: toMonthStart(nextEnd)
      }
    })
  }, [])

  const commitStartFromInput = useCallback(() => {
    const parsed = parseDateInputValue(dateInput.start)
    if (!parsed) {
      setDateInputError(prev => ({ ...prev, start: true }))
      return
    }
    setDateInputError(prev => ({ ...prev, start: false }))
    updateDraftStart(parsed)
  }, [dateInput.start, updateDraftStart])

  const commitEndFromInput = useCallback(() => {
    const parsed = parseDateInputValue(dateInput.end)
    if (!parsed) {
      setDateInputError(prev => ({ ...prev, end: true }))
      return
    }
    setDateInputError(prev => ({ ...prev, end: false }))
    updateDraftEnd(parsed)
  }, [dateInput.end, updateDraftEnd])

  const shiftPanelMonth = useCallback((panel: 'start' | 'end', delta: number) => {
    setDraft(prev => (
      panel === 'start'
        ? { ...prev, startPanelMonth: addMonths(prev.startPanelMonth, delta) }
        : { ...prev, endPanelMonth: addMonths(prev.endPanelMonth, delta) }
    ))
  }, [])

  const isRangeModeActive = !draft.useAllTime
  const modeText = isRangeModeActive
    ? '当前导出模式：按时间范围导出'
    : '当前导出模式：全部时间导出（选择下方日期将切换为按时间范围导出）'

  const isPresetActive = useCallback((preset: ExportDateRangePreset): boolean => {
    if (preset === 'all') return draft.useAllTime
    return !draft.useAllTime && draft.preset === preset
  }, [draft])

  const startPanelCells = useMemo(() => buildCalendarCells(draft.startPanelMonth), [draft.startPanelMonth])
  const endPanelCells = useMemo(() => buildCalendarCells(draft.endPanelMonth), [draft.endPanelMonth])

  if (!open) return null

  return createPortal(
    <div className="export-date-range-dialog-overlay" onClick={onClose}>
      <div className="export-date-range-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="export-date-range-dialog-header">
          <h4>{title}</h4>
          <button
            type="button"
            className="export-date-range-dialog-close-btn"
            onClick={onClose}
            aria-label="关闭时间范围设置"
          >
            <X size={14} />
          </button>
        </div>

        <div className="export-date-range-preset-list">
          {EXPORT_DATE_RANGE_PRESETS.map((preset) => {
            const active = isPresetActive(preset.value)
            return (
              <button
                key={preset.value}
                type="button"
                className={`export-date-range-preset-item ${active ? 'active' : ''}`}
                onClick={() => applyPreset(preset.value)}
              >
                <span>{preset.label}</span>
                {active && <Check size={14} />}
              </button>
            )
          })}
        </div>

        <div className={`export-date-range-mode-banner ${isRangeModeActive ? 'range' : 'all'}`}>
          {modeText}
        </div>

        <div className="export-date-range-calendar-grid">
          <section className="export-date-range-calendar-panel">
            <div className="export-date-range-calendar-panel-header">
              <div className="export-date-range-calendar-date-label">
                <span>起始日期</span>
                <input
                  type="text"
                  className={`export-date-range-date-input ${dateInputError.start ? 'invalid' : ''}`}
                  value={dateInput.start}
                  placeholder="YYYY-MM-DD"
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setDateInput(prev => ({ ...prev, start: nextValue }))
                    if (dateInputError.start) {
                      setDateInputError(prev => ({ ...prev, start: false }))
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    commitStartFromInput()
                  }}
                  onBlur={commitStartFromInput}
                />
              </div>
              <div className="export-date-range-calendar-nav">
                <button type="button" onClick={() => shiftPanelMonth('start', -1)} aria-label="上个月">‹</button>
                <span>{formatCalendarMonthTitle(draft.startPanelMonth)}</span>
                <button type="button" onClick={() => shiftPanelMonth('start', 1)} aria-label="下个月">›</button>
              </div>
            </div>
            <div className="export-date-range-calendar-weekdays">
              {WEEKDAY_SHORT_LABELS.map(label => (
                <span key={`start-weekday-${label}`}>{label}</span>
              ))}
            </div>
            <div className="export-date-range-calendar-days">
              {startPanelCells.map((cell) => {
                const selected = !draft.useAllTime && isSameDay(cell.date, draft.dateRange.start)
                return (
                  <button
                    key={`start-${cell.date.getTime()}`}
                    type="button"
                    className={`export-date-range-calendar-day ${cell.inCurrentMonth ? '' : 'outside'} ${selected ? 'selected' : ''}`}
                    onClick={() => updateDraftStart(cell.date)}
                  >
                    {cell.date.getDate()}
                  </button>
                )
              })}
            </div>
          </section>

          <section className="export-date-range-calendar-panel">
            <div className="export-date-range-calendar-panel-header">
              <div className="export-date-range-calendar-date-label">
                <span>截止日期</span>
                <input
                  type="text"
                  className={`export-date-range-date-input ${dateInputError.end ? 'invalid' : ''}`}
                  value={dateInput.end}
                  placeholder="YYYY-MM-DD"
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setDateInput(prev => ({ ...prev, end: nextValue }))
                    if (dateInputError.end) {
                      setDateInputError(prev => ({ ...prev, end: false }))
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    commitEndFromInput()
                  }}
                  onBlur={commitEndFromInput}
                />
              </div>
              <div className="export-date-range-calendar-nav">
                <button type="button" onClick={() => shiftPanelMonth('end', -1)} aria-label="上个月">‹</button>
                <span>{formatCalendarMonthTitle(draft.endPanelMonth)}</span>
                <button type="button" onClick={() => shiftPanelMonth('end', 1)} aria-label="下个月">›</button>
              </div>
            </div>
            <div className="export-date-range-calendar-weekdays">
              {WEEKDAY_SHORT_LABELS.map(label => (
                <span key={`end-weekday-${label}`}>{label}</span>
              ))}
            </div>
            <div className="export-date-range-calendar-days">
              {endPanelCells.map((cell) => {
                const selected = !draft.useAllTime && isSameDay(cell.date, draft.dateRange.end)
                return (
                  <button
                    key={`end-${cell.date.getTime()}`}
                    type="button"
                    className={`export-date-range-calendar-day ${cell.inCurrentMonth ? '' : 'outside'} ${selected ? 'selected' : ''}`}
                    onClick={() => updateDraftEnd(cell.date)}
                  >
                    {cell.date.getDate()}
                  </button>
                )
              })}
            </div>
          </section>
        </div>

        <div className="export-date-range-dialog-actions">
          <button type="button" className="export-date-range-dialog-btn secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="export-date-range-dialog-btn primary"
            onClick={() => onConfirm(cloneExportDateRangeSelection(draft))}
          >
            确认
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
