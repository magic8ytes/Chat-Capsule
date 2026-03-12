import { AlertTriangle, ClipboardList, RefreshCw } from 'lucide-react'

type ContactsLoadIssue = {
  title: string
  message: string
  reason: string
}

type ContactsLoadIssueCardProps = {
  loadIssue: ContactsLoadIssue
  showDiagnostics: boolean
  diagnosticsText: string
  onRetry: () => void | Promise<void>
  onToggleDiagnostics: () => void
  onCopyDiagnostics: () => void | Promise<void>
}

export function ContactsLoadIssueCard({
  loadIssue,
  showDiagnostics,
  diagnosticsText,
  onRetry,
  onToggleDiagnostics,
  onCopyDiagnostics
}: ContactsLoadIssueCardProps) {
  return (
    <div className="load-issue-state">
      <div className="issue-card">
        <div className="issue-title">
          <AlertTriangle size={18} />
          <span>{loadIssue.title}</span>
        </div>
        <p className="issue-message">{loadIssue.message}</p>
        <p className="issue-reason">{loadIssue.reason}</p>
        <ul className="issue-hints">
          <li>可能原因1：数据库当前仍在执行高开销查询（例如导出页后台统计）。</li>
          <li>可能原因2：contact.db 数据量较大，首次查询时间过长。</li>
          <li>可能原因3：数据库连接状态异常或 IPC 调用卡住。</li>
        </ul>
        <div className="issue-actions">
          <button className="issue-btn primary" onClick={() => void onRetry()}>
            <RefreshCw size={14} />
            <span>重试加载</span>
          </button>
          <button className="issue-btn" onClick={onToggleDiagnostics}>
            <ClipboardList size={14} />
            <span>{showDiagnostics ? '收起诊断详情' : '查看诊断详情'}</span>
          </button>
          <button className="issue-btn" onClick={() => void onCopyDiagnostics()}>
            <span>复制诊断信息</span>
          </button>
        </div>
        {showDiagnostics && (
          <pre className="issue-diagnostics">{diagnosticsText}</pre>
        )}
      </div>
    </div>
  )
}
