import { memo } from 'react'
import { FolderOpen, X } from 'lucide-react'
import { shell } from '../../services/ipc'
import {
  formatDurationMs,
  getTaskPerformanceStageTotals,
  getTaskPerformanceTopSessions,
  getTaskStatusLabel,
  isTextBatchTask,
  type ExportTask
} from './exportTaskUtils'

interface TaskCenterModalProps {
  isOpen: boolean
  tasks: ExportTask[]
  taskRunningCount: number
  taskQueuedCount: number
  expandedPerfTaskId: string | null
  nowTick: number
  onClose: () => void
  onTogglePerfTask: (taskId: string) => void
}

const TaskCenterModal = memo(function TaskCenterModal({
  isOpen,
  tasks,
  taskRunningCount,
  taskQueuedCount,
  expandedPerfTaskId,
  nowTick,
  onClose,
  onTogglePerfTask
}: TaskCenterModalProps) {
  if (!isOpen) return null

  return (
    <div
      className="task-center-modal-overlay"
      onClick={onClose}
    >
      <div
        className="task-center-modal"
        role="dialog"
        aria-modal="true"
        aria-label="任务中心"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="task-center-modal-header">
          <div className="task-center-modal-title">
            <h3>任务中心</h3>
            <span>进行中 {taskRunningCount} · 排队 {taskQueuedCount} · 总计 {tasks.length}</span>
          </div>
          <button
            className="close-icon-btn"
            type="button"
            onClick={onClose}
            aria-label="关闭任务中心"
          >
            <X size={16} />
          </button>
        </div>
        <div className="task-center-modal-body">
          {tasks.length === 0 ? (
            <div className="task-empty">暂无任务。点击会话导出或卡片导出后会在这里创建任务。</div>
          ) : (
            <div className="task-list">
              {tasks.map(task => {
                const canShowPerfDetail = isTextBatchTask(task) && Boolean(task.performance)
                const isPerfExpanded = expandedPerfTaskId === task.id
                const stageTotals = canShowPerfDetail
                  ? getTaskPerformanceStageTotals(task.performance, nowTick)
                  : null
                const stageTotalMs = stageTotals
                  ? stageTotals.collect + stageTotals.build + stageTotals.write + stageTotals.other
                  : 0
                const topSessions = isPerfExpanded
                  ? getTaskPerformanceTopSessions(task.performance, nowTick, 5)
                  : []
                const normalizedProgressTotal = task.progress.total > 0 ? task.progress.total : 0
                const normalizedProgressCurrent = normalizedProgressTotal > 0
                  ? Math.max(0, Math.min(normalizedProgressTotal, task.progress.current))
                  : 0
                const completedSessionTotal = normalizedProgressTotal > 0
                  ? normalizedProgressTotal
                  : task.payload.sessionIds.length
                const completedSessionCount = Math.min(
                  completedSessionTotal,
                  (task.settledSessionIds || []).length
                )
                const currentSessionRatio = task.progress.phaseTotal > 0
                  ? Math.max(0, Math.min(1, task.progress.phaseProgress / task.progress.phaseTotal))
                  : null
                return (
                  <div key={task.id} className={`task-card ${task.status}`}>
                    <div className="task-main">
                      <div className="task-title">{task.title}</div>
                      <div className="task-meta">
                        <span className={`task-status ${task.status}`}>{getTaskStatusLabel(task)}</span>
                        <span>{new Date(task.createdAt).toLocaleString('zh-CN')}</span>
                      </div>
                      {task.status === 'running' && (
                        <>
                          <div className="task-progress-bar">
                            <div
                              className="task-progress-fill"
                              style={{ width: `${normalizedProgressTotal > 0 ? (normalizedProgressCurrent / normalizedProgressTotal) * 100 : 0}%` }}
                            />
                          </div>
                          <div className="task-progress-text">
                            {completedSessionTotal > 0
                              ? `已完成 ${completedSessionCount} / ${completedSessionTotal}`
                              : '处理中'}
                            {task.status === 'running' && currentSessionRatio !== null
                              ? `（当前会话 ${Math.round(currentSessionRatio * 100)}%）`
                              : ''}
                            {task.progress.phaseLabel ? ` · ${task.progress.phaseLabel}` : ''}
                          </div>
                        </>
                      )}
                      {canShowPerfDetail && stageTotals && (
                        <div className="task-perf-summary">
                          <span>累计耗时 {formatDurationMs(stageTotalMs)}</span>
                          {task.progress.total > 0 && (
                            <span>平均/会话 {formatDurationMs(Math.floor(stageTotalMs / Math.max(1, task.progress.total)))}</span>
                          )}
                        </div>
                      )}
                      {canShowPerfDetail && isPerfExpanded && stageTotals && (
                        <div className="task-perf-panel">
                          <div className="task-perf-title">阶段耗时分布</div>
                          {[
                            { key: 'collect' as const, label: '收集消息' },
                            { key: 'build' as const, label: '构建消息' },
                            { key: 'write' as const, label: '写入文件' },
                            { key: 'other' as const, label: '其他' }
                          ].map(item => {
                            const value = stageTotals[item.key]
                            const ratio = stageTotalMs > 0 ? Math.min(100, (value / stageTotalMs) * 100) : 0
                            return (
                              <div className="task-perf-row" key={item.key}>
                                <div className="task-perf-row-head">
                                  <span>{item.label}</span>
                                  <span>{formatDurationMs(value)}</span>
                                </div>
                                <div className="task-perf-row-track">
                                  <div className="task-perf-row-fill" style={{ width: `${ratio}%` }} />
                                </div>
                              </div>
                            )
                          })}
                          <div className="task-perf-title">最慢会话 Top5</div>
                          {topSessions.length === 0 ? (
                            <div className="task-perf-empty">暂无会话耗时数据</div>
                          ) : (
                            <div className="task-perf-session-list">
                              {topSessions.map((session, index) => (
                                <div className="task-perf-session-item" key={session.sessionId}>
                                  <span className="task-perf-session-rank">
                                    {index + 1}. {session.sessionName || session.sessionId}
                                    {!session.finishedAt ? '（进行中）' : ''}
                                  </span>
                                  <span className="task-perf-session-time">{formatDurationMs(session.liveElapsedMs)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {task.status === 'error' && <div className="task-error">{task.error || '任务失败'}</div>}
                    </div>
                    <div className="task-actions">
                      {canShowPerfDetail && (
                        <button
                          className={`task-action-btn ${isPerfExpanded ? 'primary' : ''}`}
                          type="button"
                          onClick={() => onTogglePerfTask(task.id)}
                        >
                          {isPerfExpanded ? '收起详情' : '性能详情'}
                        </button>
                      )}
                      <button className="task-action-btn" onClick={() => task.payload.outputDir && void shell.openPath(task.payload.outputDir)}>
                        <FolderOpen size={14} /> 目录
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

export default TaskCenterModal
