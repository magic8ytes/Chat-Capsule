import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import { ExportDateRangeDialog } from './ExportDateRangeDialog'
import type { ExportDateRangeSelection } from '../../utils/exportDateRange'

type TaskScope = 'single' | 'multi' | 'content' | 'sns'
type ContentType = 'text' | 'voice' | 'image' | 'video' | 'emoji'
type DisplayNamePreference = 'group-nickname' | 'remark' | 'nickname'
type SnsTimelineExportFormat = 'json' | 'html' | 'arkmejson'

interface ExportDialogStateLike {
  open: boolean
  scope: TaskScope
  contentType?: ContentType
  sessionIds: string[]
  sessionNames: string[]
  title: string
}

interface FormatOption {
  value: string
  label: string
  desc: string
}

interface DisplayNameOption {
  value: DisplayNamePreference
  label: string
  desc: string
}

interface TextDialogOptions {
  format: string
  exportImages: boolean
  exportVoices: boolean
  exportVideos: boolean
  exportEmojis: boolean
  exportVoiceAsText: boolean
  displayNamePreference: DisplayNamePreference
}

interface SnsDialogOptions {
  format: SnsTimelineExportFormat
  exportImages: boolean
  exportLivePhotos: boolean
  exportVideos: boolean
}

interface ExportTaskDialogProps {
  dialog: ExportDialogStateLike
  canCreateTask: boolean
  scopeLabel: string
  scopeCountLabel: string
  avatarExportStatusLabel: string
  activeDialogFormatLabel: string
  contentTextDialogSummary: string
  timeRangeSummaryLabel: string
  isTimeRangeDialogOpen: boolean
  timeRangeSelection: ExportDateRangeSelection
  formatCandidateOptions: FormatOption[]
  displayNameOptions: DisplayNameOption[]
  isSessionScopeDialog: boolean
  isContentScopeDialog: boolean
  isContentTextDialog: boolean
  useCollapsedSessionFormatSelector: boolean
  shouldShowFormatSection: boolean
  shouldShowMediaSection: boolean
  shouldShowDisplayNameSection: boolean
  textOptions: TextDialogOptions
  snsOptions: SnsDialogOptions
  onClose: () => void
  onCreateTask: () => void
  onOpenTimeRangeDialog: () => void
  onCloseTimeRangeDialog: () => void
  onConfirmTimeRange: (nextSelection: ExportDateRangeSelection) => void
  onTextFormatChange: (value: string) => void
  onSnsFormatChange: (value: SnsTimelineExportFormat) => void
  onTextMediaToggle: (key: 'exportImages' | 'exportVoices' | 'exportVideos' | 'exportEmojis', checked: boolean) => void
  onSnsMediaToggle: (key: 'exportImages' | 'exportLivePhotos' | 'exportVideos', checked: boolean) => void
  onToggleVoiceAsText: () => void
  onDisplayNamePreferenceChange: (value: DisplayNamePreference) => void
}

export default function ExportTaskDialog({
  dialog,
  canCreateTask,
  scopeLabel,
  scopeCountLabel,
  avatarExportStatusLabel,
  activeDialogFormatLabel,
  contentTextDialogSummary,
  timeRangeSummaryLabel,
  isTimeRangeDialogOpen,
  timeRangeSelection,
  formatCandidateOptions,
  displayNameOptions,
  isSessionScopeDialog,
  isContentScopeDialog,
  isContentTextDialog,
  useCollapsedSessionFormatSelector,
  shouldShowFormatSection,
  shouldShowMediaSection,
  shouldShowDisplayNameSection,
  textOptions,
  snsOptions,
  onClose,
  onCreateTask,
  onOpenTimeRangeDialog,
  onCloseTimeRangeDialog,
  onConfirmTimeRange,
  onTextFormatChange,
  onSnsFormatChange,
  onTextMediaToggle,
  onSnsMediaToggle,
  onToggleVoiceAsText,
  onDisplayNamePreferenceChange
}: ExportTaskDialogProps) {
  const [showSessionFormatSelect, setShowSessionFormatSelect] = useState(false)
  const sessionFormatDropdownRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!showSessionFormatSelect) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (sessionFormatDropdownRef.current && !sessionFormatDropdownRef.current.contains(target)) {
        setShowSessionFormatSelect(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [showSessionFormatSelect])

  useEffect(() => {
    if (!dialog.open) {
      setShowSessionFormatSelect(false)
    }
  }, [dialog.open])

  if (!dialog.open) return null

  return createPortal(
    <div className="export-dialog-overlay" onClick={onClose}>
      <div className="export-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div className="dialog-header-copy">
            <h3>{dialog.title}</h3>
            {isContentTextDialog && (
              <div className="dialog-header-note">{contentTextDialogSummary}</div>
            )}
          </div>
          <button className="close-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="dialog-body">
          {dialog.scope !== 'single' && (
            <div className="dialog-section">
              <h4>导出范围</h4>
              <div className="scope-tag-row">
                <span className="scope-tag">{scopeLabel}</span>
                <span className="scope-count">{scopeCountLabel}</span>
              </div>
              <div className="scope-list">
                {dialog.sessionNames.slice(0, 20).map(name => (
                  <span key={name} className="scope-item">{name}</span>
                ))}
                {dialog.sessionNames.length > 20 && <span className="scope-item">... 还有 {dialog.sessionNames.length - 20} 个</span>}
              </div>
            </div>
          )}

          {shouldShowFormatSection && (
            <div className="dialog-section">
              {useCollapsedSessionFormatSelector ? (
                <div className="section-header-action">
                  <h4>对话文本导出格式选择</h4>
                  <div className="dialog-format-select" ref={sessionFormatDropdownRef}>
                    <button
                      type="button"
                      className={`time-range-trigger dialog-format-trigger ${showSessionFormatSelect ? 'open' : ''}`}
                      onClick={() => setShowSessionFormatSelect(prev => !prev)}
                    >
                      <span className="dialog-format-trigger-label">{activeDialogFormatLabel}</span>
                      <span className="time-range-arrow">&gt;</span>
                    </button>
                    {showSessionFormatSelect && (
                      <div className="dialog-format-dropdown">
                        {formatCandidateOptions.map(option => (
                          <button
                            key={option.value}
                            type="button"
                            className={`dialog-format-option ${(dialog.scope === 'sns' ? snsOptions.format : textOptions.format) === option.value ? 'active' : ''}`}
                            onClick={() => {
                              if (dialog.scope === 'sns') {
                                onSnsFormatChange(option.value as SnsTimelineExportFormat)
                              } else {
                                onTextFormatChange(option.value)
                              }
                              setShowSessionFormatSelect(false)
                            }}
                          >
                            <span className="option-label">{option.label}</span>
                            <span className="option-desc">{option.desc}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <h4>{dialog.scope === 'sns' ? '朋友圈导出格式选择' : '对话文本导出格式选择'}</h4>
              )}
              {!isContentScopeDialog && dialog.scope !== 'sns' && (
                <div className="format-note">{avatarExportStatusLabel}</div>
              )}
              {isContentTextDialog && (
                <div className="format-note">{avatarExportStatusLabel}</div>
              )}
              {!useCollapsedSessionFormatSelector && (
                <div className="format-grid">
                  {formatCandidateOptions.map(option => (
                    <button
                      key={option.value}
                      className={`format-card ${dialog.scope === 'sns'
                        ? (snsOptions.format === option.value ? 'active' : '')
                        : (textOptions.format === option.value ? 'active' : '')}`}
                      onClick={() => {
                        if (dialog.scope === 'sns') {
                          onSnsFormatChange(option.value as SnsTimelineExportFormat)
                        } else {
                          onTextFormatChange(option.value)
                        }
                      }}
                    >
                      <div className="format-label">{option.label}</div>
                      <div className="format-desc">{option.desc}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="dialog-section">
            <div className="section-header-action">
              <h4>时间范围</h4>
              <button type="button" className="time-range-trigger" onClick={onOpenTimeRangeDialog}>
                <span>{timeRangeSummaryLabel}</span>
                <span className="time-range-arrow">&gt;</span>
              </button>
            </div>
          </div>

          {shouldShowMediaSection && (
            <div className="dialog-section">
              <h4>{dialog.scope === 'sns' ? '媒体文件（可多选）' : '媒体内容'}</h4>
              <div className="media-check-grid">
                {dialog.scope === 'sns' ? (
                  <>
                    <label><input type="checkbox" checked={snsOptions.exportImages} onChange={event => onSnsMediaToggle('exportImages', event.target.checked)} /> 图片</label>
                    <label><input type="checkbox" checked={snsOptions.exportLivePhotos} onChange={event => onSnsMediaToggle('exportLivePhotos', event.target.checked)} /> 实况图</label>
                    <label><input type="checkbox" checked={snsOptions.exportVideos} onChange={event => onSnsMediaToggle('exportVideos', event.target.checked)} /> 视频</label>
                  </>
                ) : (
                  <>
                    <label><input type="checkbox" checked={textOptions.exportImages} onChange={event => onTextMediaToggle('exportImages', event.target.checked)} /> 图片</label>
                    <label><input type="checkbox" checked={textOptions.exportVoices} onChange={event => onTextMediaToggle('exportVoices', event.target.checked)} /> 语音</label>
                    <label><input type="checkbox" checked={textOptions.exportVideos} onChange={event => onTextMediaToggle('exportVideos', event.target.checked)} /> 视频</label>
                    <label><input type="checkbox" checked={textOptions.exportEmojis} onChange={event => onTextMediaToggle('exportEmojis', event.target.checked)} /> 表情包</label>
                  </>
                )}
              </div>
              {dialog.scope === 'sns' && (
                <div className="format-note">全不勾选时仅导出文本信息，不导出媒体文件。</div>
              )}
            </div>
          )}

          {isSessionScopeDialog && (
            <div className="dialog-section">
              <div className="dialog-switch-row">
                <div className="dialog-switch-copy">
                  <h4>语音转文字</h4>
                  <div className="format-note">默认状态跟随更多导出设置中的语音转文字开关。</div>
                </div>
                <button
                  type="button"
                  className={`dialog-switch ${textOptions.exportVoiceAsText ? 'on' : ''}`}
                  aria-pressed={textOptions.exportVoiceAsText}
                  aria-label="切换语音转文字"
                  onClick={onToggleVoiceAsText}
                >
                  <span className="dialog-switch-thumb" />
                </button>
              </div>
            </div>
          )}

          {shouldShowDisplayNameSection && (
            <div className="dialog-section">
              <h4>发送者名称显示</h4>
              <div className="display-name-options" role="radiogroup" aria-label="发送者名称显示">
                {displayNameOptions.map(option => {
                  const isActive = textOptions.displayNamePreference === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      className={`display-name-item ${isActive ? 'active' : ''}`}
                      onClick={() => onDisplayNamePreferenceChange(option.value)}
                    >
                      <span>{option.label}</span>
                      <small>{option.desc}</small>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="dialog-actions">
          <button className="secondary-btn" onClick={onClose}>取消</button>
          <button className="primary-btn" onClick={onCreateTask} disabled={!canCreateTask}>
            <Download size={14} /> 创建导出任务
          </button>
        </div>

        <ExportDateRangeDialog
          open={isTimeRangeDialogOpen}
          value={timeRangeSelection}
          onClose={onCloseTimeRangeDialog}
          onConfirm={onConfirmTimeRange}
        />
      </div>
    </div>,
    document.body
  )
}
