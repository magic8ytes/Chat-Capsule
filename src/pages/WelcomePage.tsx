import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Download,
  FolderOpen,
  HardDrive,
  Minus,
  RefreshCw,
  ShieldCheck,
  Upload,
  X
} from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { usePlatformStore } from '../stores/platformStore'
import { useShallow } from 'zustand/react/shallow'
import * as configService from '../services/config'
import { app, chat, dialog, shell, windowControl } from '../services/ipc'
import { createLogger } from '../utils/logger'
import './WelcomePage.scss'

const logger = createLogger('WelcomePage')

type MacProfileSetupInfo = Awaited<ReturnType<typeof app.getMacProfileSetup>>

interface WelcomePageProps {
  standalone?: boolean
}

function WelcomePage({ standalone = false }: WelcomePageProps) {
  const navigate = useNavigate()
  const { isDbConnected, setDbConnected, setLoading } = useAppStore(useShallow((state) => ({
    isDbConnected: state.isDbConnected,
    setDbConnected: state.setDbConnected,
    setLoading: state.setLoading
  })))
  const { capabilities, loadCapabilities, loading: capabilitiesLoading } = usePlatformStore(useShallow((state) => ({
    capabilities: state.capabilities,
    loadCapabilities: state.loadCapabilities,
    loading: state.loading
  })))

  const [setupLoaded, setSetupLoaded] = useState(false)
  const [profileSetup, setProfileSetup] = useState<MacProfileSetupInfo | null>(null)
  const [error, setError] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isExportingTemplate, setIsExportingTemplate] = useState(false)
  const [isClosing, setIsClosing] = useState(false)

  const refreshSetupState = async (options?: { loadCapabilities?: boolean }) => {
    const setupPromise = app.getMacProfileSetup()
    if (options?.loadCapabilities) {
      await Promise.all([setupPromise, loadCapabilities()])
    }
    const setup = await setupPromise
    setProfileSetup(setup)
  }

  useEffect(() => {
    let active = true

    const ensureSetup = async () => {
      try {
        const setup = await app.getMacProfileSetup()
        if (active) {
          setProfileSetup(setup)
        }
      } finally {
        if (active) setSetupLoaded(true)
      }
    }

    void ensureSetup()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (isDbConnected && !standalone) {
      navigate('/home')
    }
  }, [isDbConnected, navigate, standalone])

  const macProfile = capabilities?.profile
  const isMacProfileReady = capabilities?.mode === 'mac-profile' && Boolean(macProfile?.profileLoaded)
  const rootClassName = `welcome-page${isClosing ? ' is-closing' : ''}${standalone ? ' is-standalone' : ''}`
  const showWindowControls = standalone
  const defaultProfilePath = profileSetup?.defaultProfilePath || '项目根目录/profile.json'
  const formatStatus = (value?: boolean, positiveLabel = '存在', negativeLabel = '不存在') => {
    if (value === undefined) return '未读取'
    return value ? positiveLabel : negativeLabel
  }
  const formatFlag = (value?: boolean) => formatStatus(value, '是', '否')
  const waitingProfileLabel = `等待 ${defaultProfilePath}`
  const loadingDescription = `请先导入 profile.json（默认路径：${defaultProfilePath}）。`
  const helperNote = `首次使用请先导出模板，填写后再导入 profile.json（保存到 ${defaultProfilePath}）。`
  const readyDescription = `已读取 ${macProfile?.profilePath || defaultProfilePath}，可以连接数据库。`
  const unreadyDescription = `未读取 profile.json，请先导入配置后再刷新状态。`

  const profileDiagnostics = useMemo(() => ([
    `1. 先导出模板并填写，再导入 profile.json（默认写入 ${defaultProfilePath}）`,
    '2. 检查 accountRoot 与 db_storage 对应目录是否仍然可访问',
    '3. 如果配置来自其他机器，确认 databaseKeys、图片 key 和当前数据目录匹配',
    macProfile?.error ? `4. 当前错误：${macProfile.error}` : '4. 导入后可先在设置页运行探针，再连接数据库'
  ]), [defaultProfilePath, macProfile?.error])

  const macSummaryItems = useMemo(() => ([
    { label: '运行模式', value: capabilities ? (capabilities.mode === 'mac-profile' ? 'macOS Profile' : waitingProfileLabel) : '尚未读取' },
    { label: '数据源', value: capabilities?.sourceMode || '尚未读取' },
    { label: '当前账号', value: capabilities ? (macProfile?.wxid || '未识别') : '未读取' },
    { label: '数据库 key 数量', value: capabilities ? String(macProfile?.databaseKeyCount ?? 0) : '未读取' },
    { label: 'Profile 路径', value: macProfile?.profilePath || defaultProfilePath || '未读取', code: true },
    { label: '配置目录', value: profileSetup?.profileDirectory || '未读取', code: true },
    { label: '账号目录', value: macProfile?.accountRoot || '未读取', code: true }
  ]), [capabilities, capabilities?.mode, capabilities?.sourceMode, macProfile?.wxid, macProfile?.databaseKeyCount, macProfile?.profilePath, macProfile?.accountRoot, profileSetup?.profileDirectory, waitingProfileLabel, defaultProfilePath])

  const completeSetup = () => {
    if (standalone) {
      setIsClosing(true)
      window.setTimeout(() => {
        void windowControl.completeOnboarding()
      }, 450)
      return
    }
    navigate('/home')
  }

  const handleConnect = async () => {
    if (!capabilities) {
      await refreshSetupState({ loadCapabilities: true })
    }
    const latestCapabilities = usePlatformStore.getState().capabilities
    const latestProfile = latestCapabilities?.profile
    const latestReady = latestCapabilities?.mode === 'mac-profile' && Boolean(latestProfile?.profileLoaded)
    if (!latestReady || !latestProfile) {
      setError(latestProfile?.error || '未读取到可用的 macOS 配置，请先完成 profile.json 配置并刷新状态。')
      return
    }

    setIsConnecting(true)
    setError('')
    setLoading(true, '正在连接 macOS 数据库...')
    try {
      const result = await chat.connect()
      if (!result.success) {
        setError(result.error || '连接失败')
        return
      }

      await configService.setMyWxid(latestProfile.wxid || '')
      await configService.setOnboardingDone(true)
      setDbConnected(true, latestProfile.accountRoot || latestProfile.dbStoragePath || undefined)
      window.dispatchEvent(new Event('wxid-changed'))
      completeSetup()
    } catch (connectError) {
      setError(String(connectError))
    } finally {
      setIsConnecting(false)
      setLoading(false)
    }
  }

  const handleExportProfile = async () => {
    if (!macProfile?.profileLoaded) return
    setIsExporting(true)
    setError('')
    try {
      const saveResult = await dialog.saveFile({
        title: '导出 profile.json',
        defaultPath: 'profile.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (saveResult.canceled || !saveResult.filePath) return

      const exportResult = await app.exportMacProfile(saveResult.filePath)
      if (!exportResult.success) {
        setError(exportResult.error || '导出 profile.json 失败')
      }
    } catch (exportError) {
      logger.error('导出 profile.json 失败:', exportError)
      setError(String(exportError))
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportTemplate = async () => {
    setIsExportingTemplate(true)
    setError('')
    try {
      const saveResult = await dialog.saveFile({
        title: '导出 profile.json 模板',
        defaultPath: 'profile.template.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (saveResult.canceled || !saveResult.filePath) return

      const exportResult = await app.exportMacProfileTemplate(saveResult.filePath)
      if (!exportResult.success) {
        setError(exportResult.error || '导出模板失败')
      }
    } catch (exportError) {
      logger.error('导出模板失败:', exportError)
      setError(String(exportError))
    } finally {
      setIsExportingTemplate(false)
    }
  }

  const handleImportProfile = async () => {
    setIsImporting(true)
    setError('')
    try {
      const result = await dialog.openFile({
        title: '导入 profile.json',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return

      const importResult = await app.importMacProfile(result.filePaths[0])
      if (!importResult.success) {
        setError(importResult.error || '导入 profile.json 失败')
        return
      }

      await refreshSetupState({ loadCapabilities: true })
      window.dispatchEvent(new Event('wxid-changed'))
    } catch (importError) {
      logger.error('导入 profile.json 失败:', importError)
      setError(String(importError))
    } finally {
      setIsImporting(false)
    }
  }

  const openPath = async (targetPath?: string) => {
    if (!targetPath) return
    try {
      await shell.openPath(targetPath)
    } catch (openError) {
      logger.error('打开路径失败:', openError)
    }
  }

  const handleMinimize = () => {
    windowControl.minimize()
  }

  const handleCloseWindow = () => {
    if (standalone) {
      windowControl.close()
      return
    }
    navigate('/home')
  }

  if (!setupLoaded) {
    return (
      <div className={rootClassName}>
        <div className="welcome-container">
          {showWindowControls && (
            <div className="window-controls">
              <button type="button" className="window-btn" onClick={handleMinimize} aria-label="最小化">
                <Minus size={14} />
              </button>
              <button type="button" className="window-btn is-close" onClick={handleCloseWindow} aria-label="关闭">
                <X size={14} />
              </button>
            </div>
          )}

          <div className="welcome-sidebar">
            <div className="sidebar-header">
              <img src="./logo.png" alt="Chat Capsule" className="sidebar-logo" />
              <div className="sidebar-brand">
                <span className="brand-name">Chat Capsule</span>
                <span className="brand-tag">Loading</span>
              </div>
            </div>
            <div className="sidebar-spacer" style={{ flex: 1 }} />
            <div className="sidebar-footer">
              <ShieldCheck size={14} />
              <span>正在准备配置界面</span>
            </div>
          </div>

          <div className="welcome-content">
            <div className="content-header">
              <div>
                <h2>正在准备配置</h2>
                <p className="header-desc">{loadingDescription}</p>
              </div>
            </div>
            <div className="content-body">
              <div className="mac-profile-note">{helperNote}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={rootClassName}>
      <div className="welcome-container">
        {showWindowControls && (
          <div className="window-controls">
            <button type="button" className="window-btn" onClick={handleMinimize} aria-label="最小化">
              <Minus size={14} />
            </button>
            <button type="button" className="window-btn is-close" onClick={handleCloseWindow} aria-label="关闭">
              <X size={14} />
            </button>
          </div>
        )}

        <div className="welcome-sidebar">
          <div className="sidebar-header">
            <img src="./logo.png" alt="Chat Capsule" className="sidebar-logo" />
            <div className="sidebar-brand">
              <span className="brand-name">Chat Capsule</span>
              <span className="brand-tag">macOS</span>
            </div>
          </div>

          <div className="sidebar-spacer" style={{ flex: 1 }}>
            <div className="mac-profile-note">{helperNote}</div>
          </div>

          <div className="sidebar-footer">
            <ShieldCheck size={14} />
            <span>{isMacProfileReady ? '配置已加载，可直接连接' : '请先导入 profile.json'}</span>
          </div>
        </div>

        <div className="welcome-content">
          <div className="content-header">
            <div>
              <h2>{isMacProfileReady ? '读取到本机配置' : 'macOS 配置未就绪'}</h2>
              <p className="header-desc">
                {isMacProfileReady ? readyDescription : unreadyDescription}
              </p>
            </div>
          </div>

          <div className="content-body">
            <div className="mac-summary-grid">
              {macSummaryItems.map((item) => (
                <div key={item.label} className="mac-summary-item">
                  <span className="mac-summary-label">{item.label}</span>
                  <div className={`mac-summary-value${item.code ? ' is-code' : ''}`}>{item.value}</div>
                </div>
              ))}
            </div>

            <div className="field-hint">
              校验：accountRoot {formatStatus(macProfile?.accountRootExists)} · db_storage {formatStatus(macProfile?.dbStoragePathExists)} · sqlcipher {formatStatus(macProfile?.sqlcipherAvailable, '可用', '不可用')} · 只读 {formatFlag(macProfile?.readOnly)}
            </div>

            {!isMacProfileReady && (
              <div className="mac-profile-note">
                {profileDiagnostics.map((item) => (
                  <div key={item}>{item}</div>
                ))}
              </div>
            )}

            {!isMacProfileReady && (
              <div className="manual-profile-card">
                <div className="manual-profile-header">
                  <div>
                    <h3>配置模板</h3>
                    <p>
                      没有现成 profile.json 时，请先导出模板并填写，再导入到：
                      <span className="inline-code">{profileSetup?.defaultProfilePath || 'profile.json'}</span>
                    </p>
                  </div>
                  <button
                    className="btn btn-secondary"
                    onClick={() => void handleExportTemplate()}
                    disabled={isExportingTemplate || isImporting || isExporting || isConnecting}
                  >
                    <Download size={16} /> {isExportingTemplate ? '导出中...' : '导出模板'}
                  </button>
                </div>
              </div>
            )}

            <div className="action-row">
              <button className="btn btn-secondary" onClick={() => void handleImportProfile()} disabled={isImporting || isExporting || isExportingTemplate || isConnecting}>
                <Upload size={16} /> {isImporting ? '导入中...' : '导入配置'}
              </button>
              <button className="btn btn-secondary" onClick={() => void handleExportProfile()} disabled={isImporting || isExporting || isExportingTemplate || !macProfile?.profileLoaded}>
                <Download size={16} /> {isExporting ? '导出中...' : '导出配置'}
              </button>
              <button className="btn btn-secondary" onClick={() => void openPath(profileSetup?.profileDirectory)} disabled={!profileSetup?.profileDirectory}>
                <FolderOpen size={16} /> 打开配置目录
              </button>
              <button className="btn btn-secondary" onClick={() => void openPath(macProfile?.profilePath)} disabled={!macProfile?.profileLoaded}>
                <FolderOpen size={16} /> 打开配置文件
              </button>
              <button className="btn btn-secondary" onClick={() => void openPath(macProfile?.accountRoot)} disabled={!macProfile?.accountRoot}>
                <HardDrive size={16} /> 打开账号目录
              </button>
            </div>
          </div>

          {(error || macProfile?.error) && <div className="error-message">{error || macProfile?.error}</div>}

          <div className="content-actions">
            <button className="btn btn-ghost" onClick={() => { setError(''); void refreshSetupState({ loadCapabilities: true }) }} disabled={capabilitiesLoading || isConnecting || isImporting || isExporting || isExportingTemplate}>
              <RefreshCw size={16} /> {capabilitiesLoading ? '刷新中...' : '刷新状态'}
            </button>
            <button className="btn btn-primary" onClick={() => void handleConnect()} disabled={isConnecting || isImporting || isExporting || isExportingTemplate || !isMacProfileReady}>
              {isConnecting ? '连接中...' : '连接数据库'} <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default WelcomePage
