import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './styles/main.scss'

const rootElement = document.getElementById('app')
let reactRoot: ReactDOM.Root | null = null

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function createStartupErrorMarkup(title: string, detail: string): string {
  return `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;background:#111827;color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="max-width:560px;padding:24px 28px;border:1px solid rgba(255,255,255,0.12);border-radius:16px;background:rgba(17,24,39,0.92);box-shadow:0 20px 60px rgba(0,0,0,0.35);">
        <h1 style="margin:0 0 12px;font-size:22px;">${escapeHtml(title)}</h1>
        <p style="margin:0 0 12px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(detail)}</p>
        <p style="margin:0;line-height:1.6;opacity:0.8;">请关闭当前窗口后重新打开最新构建产物；若仍出现该提示，主进程日志里现在会记录 preload / load / render 失败原因。</p>
      </div>
    </div>
  `
}

function renderStartupError(title: string, detail: string): void {
  if (!rootElement) return
  try {
    reactRoot?.unmount()
  } catch {
    // noop
  }
  rootElement.innerHTML = createStartupErrorMarkup(title, detail)
}

function formatErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return String(error)
  }
}

function reportRendererFailure(source: string, error: unknown, extra?: Record<string, unknown>): string {
  const detail = formatErrorDetail(error)
  const payload = {
    type: 'renderer-startup-error',
    source,
    detail,
    stack: error instanceof Error ? error.stack : undefined,
    ...extra
  }

  console.error(`[Chat Capsule] ${source}`, payload)

  return detail
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { detail: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { detail: null }
  }

  static getDerivedStateFromError(error: unknown) {
    return { detail: formatErrorDetail(error) }
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo): void {
    const detail = reportRendererFailure('App render failed', error, {
      componentStack: errorInfo.componentStack
    })
    this.setState({ detail })
  }

  render() {
    if (this.state.detail) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24, background: '#111827', color: '#f9fafb', fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
          <div style={{ maxWidth: 560, padding: '24px 28px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, background: 'rgba(17,24,39,0.92)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
            <h1 style={{ margin: '0 0 12px', fontSize: 22 }}>Chat Capsule 前端运行失败</h1>
            <p style={{ margin: '0 0 12px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{this.state.detail}</p>
            <p style={{ margin: 0, lineHeight: 1.6, opacity: 0.8 }}>请重新打开应用；若仍复现，请把这段错误信息发给我继续收口。</p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

if (!rootElement) {
  throw new Error('Chat Capsule root container (#app) is missing')
}

window.addEventListener('error', (event) => {
  const detail = reportRendererFailure('window error', event.error || event.message, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  })
  renderStartupError('Chat Capsule 前端运行失败', detail)
})

window.addEventListener('unhandledrejection', (event) => {
  const detail = reportRendererFailure('window unhandledrejection', event.reason)
  renderStartupError('Chat Capsule 前端运行失败', detail)
})

if (!window.electronAPI) {
  console.error('[Chat Capsule] electronAPI preload bridge is unavailable')
  renderStartupError(
    'Chat Capsule 启动失败',
    '未检测到 Electron preload 注入的 window.electronAPI，这通常意味着窗口沙箱或 preload 装载异常。'
  )
} else {
  import('./App').then(({ default: App }) => {
    reactRoot = ReactDOM.createRoot(rootElement)
    reactRoot.render(
      <React.StrictMode>
        <AppErrorBoundary>
          <HashRouter>
            <App />
          </HashRouter>
        </AppErrorBoundary>
      </React.StrictMode>
    )
  }).catch((error: unknown) => {
    const detail = reportRendererFailure('App bootstrap failed', error)
    renderStartupError('Chat Capsule 前端启动失败', detail)
  })
}
