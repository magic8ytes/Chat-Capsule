import { Copy, RefreshCw } from 'lucide-react'

type HttpApiSettingsPanelProps = {
  httpApiRunning: boolean
  isTogglingApi: boolean
  httpApiPort: number
  httpApiTokenMasked: string
  httpApiTokenPresent: boolean
  httpApiAllowedOriginsInput: string
  httpApiAllowedOrigins: string[]
  httpApiMediaExportPath: string
  onSetPort: (nextPort: number) => void
  onToggleApi: () => void | Promise<void>
  onCopyApiToken: () => void | Promise<void>
  onRotateApiToken: () => void | Promise<void>
  onChangeAllowedOriginsInput: (value: string) => void
  onSaveApiAllowedOrigins: () => void | Promise<void>
  onCopyApiUrl: () => void | Promise<void>
}

export function HttpApiSettingsPanel({
  httpApiRunning,
  isTogglingApi,
  httpApiPort,
  httpApiTokenMasked,
  httpApiTokenPresent,
  httpApiAllowedOriginsInput,
  httpApiAllowedOrigins,
  httpApiMediaExportPath,
  onSetPort,
  onToggleApi,
  onCopyApiToken,
  onRotateApiToken,
  onChangeAllowedOriginsInput,
  onSaveApiAllowedOrigins,
  onCopyApiUrl
}: HttpApiSettingsPanelProps) {
  return (
    <div className="tab-content">
      <div className="form-group">
        <label>HTTP API 服务</label>
        <span className="form-hint">启用后仅监听 `127.0.0.1`，除健康检查外其余接口均要求本地 Token。</span>
        <div className="log-toggle-line">
          <span className="log-status">{httpApiRunning ? '运行中' : '已停止'}</span>
          <label className="switch">
            <input type="checkbox" checked={httpApiRunning} onChange={() => void onToggleApi()} disabled={isTogglingApi} />
            <span className="switch-slider" />
          </label>
        </div>
      </div>

      <div className="form-group">
        <label>服务端口</label>
        <input
          type="number"
          value={httpApiPort}
          onChange={(event) => onSetPort(parseInt(event.target.value, 10) || 5031)}
          disabled={httpApiRunning}
          min={1024}
          max={65535}
        />
      </div>

      <div className="form-group">
        <label>访问 Token</label>
        <div className="mac-inline-field">
          <input value={httpApiTokenMasked || (httpApiTokenPresent ? '已生成，请复制到剪贴板使用' : '未初始化')} readOnly />
          <button className="btn btn-secondary" onClick={() => void onCopyApiToken()} disabled={!httpApiTokenPresent}>
            <Copy size={16} /> 复制
          </button>
          <button className="btn btn-secondary" onClick={() => void onRotateApiToken()}>
            <RefreshCw size={16} /> 轮换
          </button>
        </div>
        <span className="form-hint">Token 仅保留掩码展示；复制动作在主进程完成，调用时仅支持 `Authorization: Bearer &lt;token&gt;` 或 `x-chat-capsule-token` 请求头。</span>
      </div>

      <div className="form-group">
        <label>CORS Allowlist</label>
        <span className="form-hint">仅允许显式 `http/https origin`，每行一个；留空表示默认拒绝跨域，不支持 `*`。</span>
        <textarea
          className="mac-textarea"
          value={httpApiAllowedOriginsInput}
          onChange={(event) => onChangeAllowedOriginsInput(event.target.value)}
          placeholder={['https://localhost:3000', 'http://127.0.0.1:8787'].join('\n')}
        />
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => void onSaveApiAllowedOrigins()}>
            保存 Allowlist
          </button>
        </div>
        <span className="form-hint">当前生效：{httpApiAllowedOrigins.length > 0 ? httpApiAllowedOrigins.join(', ') : '未配置，默认不开放跨域'}</span>
      </div>

      {httpApiRunning && (
        <>
          <div className="form-group">
            <label>API 地址</label>
            <div className="mac-inline-field">
              <input value={`http://127.0.0.1:${httpApiPort}`} readOnly />
              <button className="btn btn-secondary" onClick={() => void onCopyApiUrl()}>
                <Copy size={16} /> 复制
              </button>
            </div>
          </div>
          <div className="form-group">
            <label>默认媒体导出目录</label>
            <input value={httpApiMediaExportPath || '未获取到目录'} readOnly />
          </div>
        </>
      )}
    </div>
  )
}
