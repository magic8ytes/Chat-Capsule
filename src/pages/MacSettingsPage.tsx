import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  AlertCircle,
  Database,
  Download,
  FolderOpen,
  HardDrive,
  Lock,
  Mic,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trash2,
  Upload
} from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { usePlatformStore } from '../stores/platformStore'
import { themes, useThemeStore, type ThemeMode } from '../stores/themeStore'
import * as configService from '../services/config'
import { app, auth, chat, dialog, electronApi, http, whisper } from '../services/ipc'
import { useShallow } from 'zustand/react/shallow'
import { createLogger } from '../utils/logger'
import './SettingsPage.scss'
import './MacSettingsPage.scss'
import { HttpApiSettingsPanel } from '../components/settings/HttpApiSettingsPanel'
import type { MacProfilePayload } from '../types/electron'
import { formatBytes, formatProbeTime, macSettingsLanguageOptions as languageOptions, macSettingsTabs as tabs, normalizeHttpApiOriginsInput, type MacProbeResult, type MacSettingsTab, type ToastState } from './settings/macSettingsSupport'

type MacProfileSetupInfo = Awaited<ReturnType<typeof app.getMacProfileSetup>>

interface ManualDatabaseKey {
  path: string
  encKey: string
  salt: string
}

function MacSettingsPage() {
  const logger = createLogger('MacSettingsPage')
  const location = useLocation()
  const { capabilities, loadCapabilities, loading } = usePlatformStore(useShallow((state) => ({
    capabilities: state.capabilities,
    loadCapabilities: state.loadCapabilities,
    loading: state.loading
  })))
  const { currentTheme, themeMode, setTheme, setThemeMode } = useThemeStore(useShallow((state) => ({
    currentTheme: state.currentTheme,
    themeMode: state.themeMode,
    setTheme: state.setTheme,
    setThemeMode: state.setThemeMode
  })))
  const { setDbConnected } = useAppStore(useShallow((state) => ({
    setDbConnected: state.setDbConnected
  })))

  const [activeTab, setActiveTab] = useState<MacSettingsTab>('profile')
  const [profileSetup, setProfileSetup] = useState<MacProfileSetupInfo | null>(null)
  const [profilePayload, setProfilePayload] = useState<MacProfilePayload | null>(null)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [profileKeysError, setProfileKeysError] = useState('')
  const [isSavingProfileKeys, setIsSavingProfileKeys] = useState(false)
  const [profileDatabaseKeys, setProfileDatabaseKeys] = useState<ManualDatabaseKey[]>([])
  const [toast, setToast] = useState<ToastState | null>(null)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [isImportingProfile, setIsImportingProfile] = useState(false)
  const [isExportingProfile, setIsExportingProfile] = useState(false)
  const [isExportingProfileTemplate, setIsExportingProfileTemplate] = useState(false)
  const allowInlineProfileEdit = false
  const [isProbing, setIsProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<MacProbeResult | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  const [logEnabled, setLogEnabled] = useState(false)
  const [whisperModelName, setWhisperModelName] = useState('base')
  const [whisperModelDir, setWhisperModelDir] = useState('')
  const [whisperModelStatus, setWhisperModelStatus] = useState<{ exists?: boolean; modelPath?: string; tokensPath?: string; sizeBytes?: number } | null>(null)
  const [isWhisperDownloading, setIsWhisperDownloading] = useState(false)
  const [whisperDownloadProgress, setWhisperDownloadProgress] = useState(0)
  const [autoTranscribeVoice, setAutoTranscribeVoice] = useState(false)
  const [transcribeLanguages, setTranscribeLanguages] = useState<string[]>(['zh'])

  const [httpApiPort, setHttpApiPort] = useState(5031)
  const [httpApiRunning, setHttpApiRunning] = useState(false)
  const [httpApiMediaExportPath, setHttpApiMediaExportPath] = useState('')
  const [httpApiTokenMasked, setHttpApiTokenMasked] = useState('')
  const [httpApiTokenPresent, setHttpApiTokenPresent] = useState(false)
  const [httpApiAllowedOrigins, setHttpApiAllowedOrigins] = useState<string[]>([])
  const [httpApiAllowedOriginsInput, setHttpApiAllowedOriginsInput] = useState('')
  const [isTogglingApi, setIsTogglingApi] = useState(false)

  const [exportPath, setExportPath] = useState('')
  const [isClearingImageCache, setIsClearingImageCache] = useState(false)
  const [isClearingAllCache, setIsClearingAllCache] = useState(false)

  const [authEnabled, setAuthEnabled] = useState(false)
  const [authUseHello, setAuthUseHello] = useState(false)
  const [helloAvailable, setHelloAvailable] = useState(false)
  const [isLockMode, setIsLockMode] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [helloPassword, setHelloPassword] = useState('')
  const [disableLockPassword, setDisableLockPassword] = useState('')
  const [showDisableLockInput, setShowDisableLockInput] = useState(false)
  const [isSettingHello, setIsSettingHello] = useState(false)

  const profile = capabilities?.profile
  const effectiveMode = themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode
  const isClearingCache = isClearingImageCache || isClearingAllCache

  const showMessage = (text: string, success: boolean) => {
    setToast({ text, success })
    window.setTimeout(() => setToast(null), 3000)
  }

  const requiredDatabasePaths = useMemo(() => ([
    'session/session.db',
    'contact/contact.db',
    'hardlink/hardlink.db',
    'head_image/head_image.db',
    'emoticon/emoticon.db',
    'sns/sns.db'
  ]), [])

  const requiredDatabaseGroups = useMemo(() => ([
    { label: 'message/message_*.db', pattern: /^message\/message_\d+\.db$/i },
    { label: 'message/biz_message_*.db', pattern: /^message\/biz_message_\d+\.db$/i },
    { label: 'message/media_*.db', pattern: /^message\/media_\d+\.db$/i }
  ]), [])

  const sampleDatabaseKeys = useMemo<ManualDatabaseKey[]>(() => ([
    { path: 'session/session.db', encKey: 'YOUR_ENC_KEY', salt: 'YOUR_SALT' },
    { path: 'contact/contact.db', encKey: 'YOUR_ENC_KEY', salt: 'YOUR_SALT' },
    { path: 'message/message_0.db', encKey: 'YOUR_ENC_KEY', salt: 'YOUR_SALT' },
    { path: 'message/biz_message_0.db', encKey: 'YOUR_ENC_KEY', salt: 'YOUR_SALT' },
    { path: 'message/media_0.db', encKey: 'YOUR_ENC_KEY', salt: 'YOUR_SALT' },
    { path: 'hardlink/hardlink.db', encKey: 'YOUR_ENC_KEY', salt: 'YOUR_SALT' },
    { path: 'head_image/head_image.db', encKey: 'YOUR_ENC_KEY', salt: 'YOUR_SALT' },
    { path: 'emoticon/emoticon.db', encKey: 'YOUR_ENC_KEY', salt: 'YOUR_SALT' },
    { path: 'sns/sns.db', encKey: 'YOUR_ENC_KEY', salt: 'YOUR_SALT' }
  ]), [])

  const normalizeDbPath = (value: string) => String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')

  const mapDatabaseKeysToList = (databaseKeys?: Record<string, { enc_key: string; salt: string; size_mb?: number }>): ManualDatabaseKey[] => {
    if (!databaseKeys || Object.keys(databaseKeys).length === 0) {
      return [
        { path: 'session/session.db', encKey: '', salt: '' },
        { path: 'contact/contact.db', encKey: '', salt: '' },
        { path: 'message/message_0.db', encKey: '', salt: '' },
        { path: 'message/biz_message_0.db', encKey: '', salt: '' },
        { path: 'message/media_0.db', encKey: '', salt: '' },
        { path: 'hardlink/hardlink.db', encKey: '', salt: '' },
        { path: 'head_image/head_image.db', encKey: '', salt: '' },
        { path: 'emoticon/emoticon.db', encKey: '', salt: '' },
        { path: 'sns/sns.db', encKey: '', salt: '' }
      ]
    }
    return Object.entries(databaseKeys)
      .map(([path, value]) => ({
        path,
        encKey: value.enc_key || '',
        salt: value.salt || ''
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  const refreshProfilePayload = async () => {
    if (!profile?.profileLoaded) {
      setProfilePayload(null)
      setProfileDatabaseKeys([])
      return
    }

    try {
      const result = await app.getMacProfile()
      if (!result.success) {
        setProfilePayload(null)
        setProfileDatabaseKeys([])
        setProfileKeysError(result.error || '读取 profile.json 失败')
        return
      }
      setProfileKeysError('')
      setProfilePayload(result.profile || null)
      setProfileDatabaseKeys(mapDatabaseKeysToList(result.profile?.databaseKeys))
    } catch (error) {
      setProfilePayload(null)
      setProfileDatabaseKeys([])
      setProfileKeysError(`读取 profile.json 失败: ${String(error)}`)
    }
  }


  const applyHttpStatus = (httpStatus: Awaited<ReturnType<typeof electronApi.http.status>>) => {
    setHttpApiRunning(httpStatus.running)
    setHttpApiPort(httpStatus.port || 5031)
    setHttpApiMediaExportPath(httpStatus.mediaExportPath || '')
    setHttpApiTokenPresent(Boolean(httpStatus.tokenPresent))
    setHttpApiTokenMasked(httpStatus.tokenMasked || '')
    const normalizedAllowedOrigins = Array.isArray(httpStatus.allowedOrigins) ? httpStatus.allowedOrigins : []
    setHttpApiAllowedOrigins(normalizedAllowedOrigins)
    setHttpApiAllowedOriginsInput(normalizedAllowedOrigins.join('\n'))
  }

  const refreshWhisperStatus = async () => {
    try {
      const result = await electronApi.whisper.getModelStatus()
      if (result.success) {
        setWhisperModelStatus({
          exists: result.exists,
          modelPath: result.modelPath,
          tokensPath: result.tokensPath,
          sizeBytes: result.sizeBytes
        })
      }
    } catch (error) {
      logger.error('读取模型状态失败:', error)
    }
  }

  const loadSettings = async () => {
    try {
      const [
        savedLogEnabled,
        savedWhisperModelName,
        savedWhisperModelDir,
        savedAutoTranscribeVoice,
        savedTranscribeLanguages,
        httpStatus,
        savedExportPath,
        savedAuthEnabled,
        savedAuthUseHello,
        savedIsLockMode,
        version,
        profileSetupInfo
      ] = await Promise.all([
        configService.getLogEnabled(),
        configService.getWhisperModelName(),
        configService.getWhisperModelDir(),
        configService.getAutoTranscribeVoice(),
        configService.getTranscribeLanguages(),
        electronApi.http.status(),
        configService.getExportPath(),
        electronApi.auth.verifyEnabled(),
        configService.getAuthUseHello(),
        electronApi.auth.isLockMode(),
        electronApi.app.getVersion(),
        electronApi.app.getMacProfileSetup()
      ])

      setLogEnabled(savedLogEnabled)
      setWhisperModelName(savedWhisperModelName || 'base')
      setWhisperModelDir(savedWhisperModelDir || '')
      setAutoTranscribeVoice(savedAutoTranscribeVoice)
      setTranscribeLanguages(savedTranscribeLanguages.length > 0 ? savedTranscribeLanguages : ['zh'])
      applyHttpStatus(httpStatus)
      setExportPath(savedExportPath || '')
      setAuthEnabled(savedAuthEnabled)
      setAuthUseHello(savedAuthUseHello)
      setIsLockMode(savedIsLockMode)
      setAppVersion(version)
      setProfileSetup(profileSetupInfo)
      await refreshWhisperStatus()
    } catch (error) {
      logger.error('加载 mac 设置失败:', error)
      showMessage(`加载设置失败: ${String(error)}`, false)
    }
  }

  useEffect(() => {
    if (!capabilities) {
      void loadCapabilities()
    }
    void loadSettings()
  }, [capabilities, loadCapabilities])

  useEffect(() => {
    void refreshProfilePayload()
  }, [profile?.profileLoaded])

  useEffect(() => {
    const initialTab = (location.state as { initialTab?: MacSettingsTab } | null)?.initialTab
    if (!initialTab) return
    if (tabs.some((tab) => tab.id === initialTab)) {
      setActiveTab(initialTab)
    }
  }, [location.state])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (window.PublicKeyCredential) {
      void PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(setHelloAvailable).catch(() => setHelloAvailable(false))
    }
  }, [])

  useEffect(() => {
    const removeListener = electronApi.whisper.onDownloadProgress((payload) => {
      if (typeof payload.percent === 'number') {
        setWhisperDownloadProgress(payload.percent)
      }
    })
    return () => removeListener?.()
  }, [])

  const openPath = async (targetPath?: string) => {
    if (!targetPath) return
    try {
      await electronApi.shell.openPath(targetPath)
    } catch (error) {
      logger.error('打开路径失败:', error)
    }
  }

  const selectDirectory = async (title: string): Promise<string | null> => {
    const result = await electronApi.dialog.openDirectory({ title, properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  }

  const handleExportProfile = async () => {
    if (!profile?.profileLoaded) {
      showMessage('当前没有可导出的 profile.json', false)
      return
    }

    setIsExportingProfile(true)
    try {
      const saveResult = await dialog.saveFile({
        title: '导出 profile.json',
        defaultPath: 'profile.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (saveResult.canceled || !saveResult.filePath) return

      const exportResult = await app.exportMacProfile(saveResult.filePath)
      if (!exportResult.success) {
        showMessage(exportResult.error || '导出 profile.json 失败', false)
        return
      }

      showMessage('profile.json 已导出', true)
    } catch (error) {
      logger.error('导出 profile.json 失败:', error)
      showMessage(`导出 profile.json 失败: ${String(error)}`, false)
    } finally {
      setIsExportingProfile(false)
    }
  }

  const handleExportProfileTemplate = async () => {
    setIsExportingProfileTemplate(true)
    try {
      const saveResult = await dialog.saveFile({
        title: '导出 profile.json 模板',
        defaultPath: 'profile.template.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (saveResult.canceled || !saveResult.filePath) return

      const exportResult = await app.exportMacProfileTemplate(saveResult.filePath)
      if (!exportResult.success) {
        showMessage(exportResult.error || '导出模板失败', false)
        return
      }

      showMessage('profile.json 模板已导出', true)
    } catch (error) {
      logger.error('导出模板失败:', error)
      showMessage(`导出模板失败: ${String(error)}`, false)
    } finally {
      setIsExportingProfileTemplate(false)
    }
  }

  const handleImportProfile = async () => {
    setIsImportingProfile(true)
    try {
      const result = await dialog.openFile({
        title: '导入 profile.json',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return

      const importResult = await app.importMacProfile(result.filePaths[0])
      if (!importResult.success) {
        showMessage(importResult.error || '导入 profile.json 失败', false)
        return
      }

      await Promise.all([loadCapabilities(), loadSettings()])
      await refreshProfilePayload()
      window.dispatchEvent(new Event('wxid-changed'))
      showMessage(`profile.json 已导入到 ${profileSetup?.defaultProfilePath || '默认配置路径'}`, true)
    } catch (error) {
      logger.error('导入 profile.json 失败:', error)
      showMessage(`导入 profile.json 失败: ${String(error)}`, false)
    } finally {
      setIsImportingProfile(false)
    }
  }

  const addProfileDatabaseKey = () => {
    setProfileDatabaseKeys((prev) => [...prev, { path: '', encKey: '', salt: '' }])
  }

  const removeProfileDatabaseKey = (index: number) => {
    setProfileDatabaseKeys((prev) => prev.filter((_, idx) => idx !== index))
  }

  const updateProfileDatabaseKey = (index: number, patch: Partial<ManualDatabaseKey>) => {
    setProfileDatabaseKeys((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)))
  }

  const handleSaveProfileDatabaseKeys = async () => {
    if (!profilePayload) {
      setProfileKeysError('未读取到 profile.json，无法保存')
      return
    }
    if (profileDatabaseKeys.length === 0) {
      setProfileKeysError('请至少填写一个 databaseKeys 项')
      return
    }

    setProfileKeysError('')

    const databaseKeys: Record<string, { enc_key: string; salt: string }> = {}
    const pathSet = new Set<string>()
    for (const entry of profileDatabaseKeys) {
      const rawPath = entry.path.trim()
      const path = normalizeDbPath(rawPath)
      const encKey = entry.encKey.trim()
      const salt = entry.salt.trim()
      if (!path || !encKey || !salt) {
        setProfileKeysError('databaseKeys 需要填写路径、enc_key 与 salt')
        return
      }
      if (rawPath.startsWith('/')) {
        setProfileKeysError('databaseKeys 路径必须是 db_storage 下的相对路径')
        return
      }
      if (pathSet.has(path)) {
        setProfileKeysError(`databaseKeys 路径重复：${path}`)
        return
      }
      pathSet.add(path)
      databaseKeys[path] = {
        enc_key: encKey,
        salt
      }
    }
    const missingRequired = requiredDatabasePaths.filter((path) => !pathSet.has(path))
    const missingGroups = requiredDatabaseGroups
      .filter((group) => !Array.from(pathSet).some((path) => group.pattern.test(path)))
      .map((group) => group.label)
    if (missingRequired.length > 0 || missingGroups.length > 0) {
      setProfileKeysError(`缺少必要数据库：${[...missingRequired, ...missingGroups].join('、')}`)
      return
    }

    setIsSavingProfileKeys(true)
    try {
      const result = await app.createMacProfile({
        ...profilePayload,
        databaseKeys
      })
      if (!result.success) {
        setProfileKeysError(result.error || '写入 profile.json 失败')
        return
      }
      showMessage(`databaseKeys 已写入 ${profileSetup?.defaultProfilePath || 'profile.json'}`, true)
      await loadCapabilities()
      await refreshProfilePayload()
    } catch (error) {
      setProfileKeysError(String(error))
    } finally {
      setIsSavingProfileKeys(false)
    }
  }

  const handleReloadAll = async () => {
    await Promise.all([loadCapabilities(), loadSettings()])
    await refreshProfilePayload()
    showMessage('已刷新配置与状态', true)
  }

  const handleReconnect = async () => {
    setIsReconnecting(true)
    try {
      await electronApi.chat.close()
      setDbConnected(false)
      const result = await electronApi.chat.connect()
      await loadCapabilities()
      if (result.success) {
        const latestCapabilities = usePlatformStore.getState().capabilities
        const dbPath = await configService.getDbPath()
        setDbConnected(true, dbPath || latestCapabilities?.profile?.accountRoot || latestCapabilities?.profile?.dbStoragePath || undefined)
        window.dispatchEvent(new Event('wxid-changed'))
        showMessage('数据库已重新连接', true)
      } else {
        showMessage(result.error || '重连失败', false)
      }
    } catch (error) {
      logger.error('重新连接失败:', error)
      showMessage(`重新连接失败: ${String(error)}`, false)
    } finally {
      setIsReconnecting(false)
    }
  }

  const handleProbe = async () => {
    setIsProbing(true)
    try {
      const result = await electronApi.app.probeMacProfile()
      setProbeResult(result)
      showMessage(result.success ? '数据库探针全部通过' : '数据库探针存在失败项', result.success)
    } catch (error) {
      logger.error('执行 mac 探针失败:', error)
      const failedResult = {
        success: false,
        probes: [],
        probedAt: Date.now(),
        error: String(error)
      }
      setProbeResult(failedResult)
      showMessage(`执行探针失败: ${String(error)}`, false)
    } finally {
      setIsProbing(false)
    }
  }

  const handleSelectWhisperModelDir = async () => {
    try {
      const dir = await selectDirectory('选择模型目录')
      if (!dir) return
      setWhisperModelDir(dir)
      await configService.setWhisperModelDir(dir)
      await refreshWhisperStatus()
      showMessage('模型目录已更新', true)
    } catch (error) {
      showMessage(`选择目录失败: ${String(error)}`, false)
    }
  }

  const handleDownloadWhisperModel = async () => {
    if (isWhisperDownloading) return
    setIsWhisperDownloading(true)
    setWhisperDownloadProgress(0)
    try {
      const result = await electronApi.whisper.downloadModel()
      if (result.success) {
        setWhisperDownloadProgress(100)
        await refreshWhisperStatus()
        showMessage('模型下载完成', true)
      } else {
        showMessage(result.error || '模型下载失败', false)
      }
    } catch (error) {
      showMessage(`模型下载失败: ${String(error)}`, false)
    } finally {
      setIsWhisperDownloading(false)
    }
  }

  const handleToggleLanguage = async (value: string) => {
    const next = transcribeLanguages.includes(value)
      ? transcribeLanguages.filter((item) => item !== value)
      : [...transcribeLanguages, value]
    const normalized = next.length > 0 ? next : ['zh']
    setTranscribeLanguages(normalized)
    await configService.setTranscribeLanguages(normalized)
  }

  const handleSelectExportPath = async () => {
    try {
      const dir = await selectDirectory('选择导出目录')
      if (!dir) return
      setExportPath(dir)
      await configService.setExportPath(dir)
      showMessage('导出目录已更新', true)
    } catch (error) {
      showMessage(`选择目录失败: ${String(error)}`, false)
    }
  }

  const handleClearImageCache = async () => {
    if (isClearingCache) return
    setIsClearingImageCache(true)
    try {
      const result = await electronApi.cache.clearImages()
      showMessage(result.success ? '已清除图片缓存' : (result.error || '清除图片缓存失败'), result.success)
    } catch (error) {
      showMessage(`清除图片缓存失败: ${String(error)}`, false)
    } finally {
      setIsClearingImageCache(false)
    }
  }

  const handleClearAllCache = async () => {
    if (isClearingCache) return
    setIsClearingAllCache(true)
    try {
      const result = await electronApi.cache.clearAll()
      showMessage(result.success ? '已清除所有缓存' : (result.error || '清除所有缓存失败'), result.success)
    } catch (error) {
      showMessage(`清除所有缓存失败: ${String(error)}`, false)
    } finally {
      setIsClearingAllCache(false)
    }
  }

  const handleToggleApi = async () => {
    if (isTogglingApi) return
    if (!httpApiRunning && !window.confirm('启动 HTTP API 后，本机其他程序可通过接口访问聊天数据。确认继续？')) {
      return
    }

    setIsTogglingApi(true)
    try {
      if (httpApiRunning) {
        await electronApi.http.stop()
        setHttpApiRunning(false)
        showMessage('API 服务已停止', true)
      } else {
        const result = await electronApi.http.start(httpApiPort)
        if (result.success) {
          setHttpApiRunning(true)
          if (result.port) setHttpApiPort(result.port)
          showMessage(`API 服务已启动，端口 ${result.port}`, true)
        } else {
          showMessage(result.error || '启动失败', false)
        }
      }
      const status = await electronApi.http.status()
      applyHttpStatus(status)
    } catch (error) {
      showMessage(`API 操作失败: ${String(error)}`, false)
    } finally {
      setIsTogglingApi(false)
    }
  }

  const handleCopyApiUrl = async () => {
    try {
      await navigator.clipboard.writeText(`http://127.0.0.1:${httpApiPort}`)
      showMessage('API 地址已复制', true)
    } catch (error) {
      showMessage(`复制失败: ${String(error)}`, false)
    }
  }

  const handleCopyApiToken = async () => {
    try {
      const result = await electronApi.http.copyToken()
      if (!result.tokenPresent) {
        showMessage('当前尚未生成 API Token，请先轮换生成', false)
        return
      }
      setHttpApiTokenPresent(result.tokenPresent)
      setHttpApiTokenMasked(result.tokenMasked || '')
      showMessage('API Token 已复制到系统剪贴板，30 秒后将尝试自动清除', true)
    } catch (error) {
      showMessage(`复制失败: ${String(error)}`, false)
    }
  }

  const handleRotateApiToken = async () => {
    if (!window.confirm('轮换 Token 后，现有调用方将立即失效。确认继续？')) {
      return
    }
    try {
      const result = await electronApi.http.rotateToken()
      if (result.success) {
        setHttpApiTokenPresent(result.tokenPresent)
        setHttpApiTokenMasked(result.tokenMasked || '')
        showMessage('API Token 已轮换，请重新复制', true)
      }
    } catch (error) {
      showMessage(`Token 轮换失败: ${String(error)}`, false)
    }
  }

  const handleSaveApiAllowedOrigins = async () => {
    try {
      const requestedOrigins = normalizeHttpApiOriginsInput(httpApiAllowedOriginsInput)
      const result = await electronApi.http.setAllowedOrigins(requestedOrigins)
      if (!result.success) {
        showMessage('CORS Allowlist 保存失败', false)
        return
      }
      setHttpApiAllowedOrigins(result.allowedOrigins)
      setHttpApiAllowedOriginsInput(result.allowedOrigins.join('\n'))

      if (requestedOrigins.length > 0 && result.allowedOrigins.length !== requestedOrigins.length) {
        showMessage('部分 CORS 来源无效，已按 http/https origin 自动过滤', false)
        return
      }

      showMessage(result.allowedOrigins.length > 0 ? 'CORS Allowlist 已保存' : 'CORS Allowlist 已清空，保持默认拒绝跨域', true)
    } catch (error) {
      showMessage(`CORS Allowlist 保存失败: ${String(error)}`, false)
    }
  }

  const handleSetupHello = async () => {
    if (!helloPassword) {
      showMessage('请输入当前密码以开启系统生物识别', false)
      return
    }

    setIsSettingHello(true)
    try {
      const challenge = new Uint8Array(32)
      window.crypto.getRandomValues(challenge)

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Chat Capsule', id: 'localhost' },
          user: { id: new Uint8Array([1]), name: 'user', displayName: 'User' },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          authenticatorSelection: { userVerification: 'required' },
          timeout: 60000
        }
      })

      if (credential) {
        await electronApi.auth.setHelloSecret(helloPassword)
        await configService.setAuthUseHello(true)
        setAuthUseHello(true)
        setHelloPassword('')
        showMessage('系统生物识别已开启', true)
      }
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === 'NotAllowedError')) {
        const message = error instanceof Error ? error.message : String(error)
        showMessage(`系统生物识别设置失败: ${message}`, false)
      }
    } finally {
      setIsSettingHello(false)
    }
  }

  const handleUpdatePassword = async () => {
    if (!newPassword || newPassword !== confirmPassword) {
      showMessage('两次密码不一致', false)
      return
    }

    try {
      if (authEnabled && isLockMode) {
        if (!oldPassword) {
          showMessage('请输入旧密码', false)
          return
        }
        const result = await electronApi.auth.changePassword(oldPassword, newPassword)
        if (!result.success) {
          showMessage(result.error || '密码更新失败', false)
          return
        }
        showMessage('密码已更新', true)
      } else {
        const result = await electronApi.auth.enableLock(newPassword)
        if (!result.success) {
          showMessage(result.error || '开启应用锁失败', false)
          return
        }
        setAuthEnabled(true)
        setIsLockMode(true)
        showMessage('应用锁已开启', true)
      }

      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error) {
      showMessage(`操作失败: ${String(error)}`, false)
    }
  }

  const handleDisableLock = async () => {
    if (!disableLockPassword) {
      showMessage('请输入当前密码', false)
      return
    }

    try {
      const result = await electronApi.auth.disableLock(disableLockPassword)
      if (!result.success) {
        showMessage(result.error || '关闭失败', false)
        return
      }
      await electronApi.auth.clearHelloSecret()
      await configService.setAuthUseHello(false)
      setAuthEnabled(false)
      setAuthUseHello(false)
      setIsLockMode(false)
      setShowDisableLockInput(false)
      setDisableLockPassword('')
      showMessage('应用锁已关闭', true)
    } catch (error) {
      showMessage(`关闭应用锁失败: ${String(error)}`, false)
    }
  }

  const profileDiagnosticItems = useMemo(() => ([
    `1. 使用模板填写后点击“导入 profile.json”，将配置写入 ${profileSetup?.defaultProfilePath || '项目根目录 profile.json'}`,
    '2. 检查 accountRoot 与 db_storage 目录是否仍然存在且有访问权限',
    '3. 如果从别的机器迁移配置，确认 databaseKeys 与当前数据目录匹配',
    profile?.error ? `4. 当前错误：${profile.error}` : '4. 导入后可先运行探针，再尝试重连数据库'
  ]), [profile?.error, profileSetup?.defaultProfilePath])

  const profileSummaryItems = useMemo(() => ([
    { label: '模式', value: capabilities?.mode === 'mac-profile' ? 'macOS Profile' : `等待 ${profileSetup?.defaultProfilePath || 'profile.json'}` },
    { label: '数据源', value: capabilities?.sourceMode || '未知' },
    { label: '当前账号', value: profile?.wxid || '未识别' },
    { label: '数据库 key 数量', value: String(profile?.databaseKeyCount ?? 0) },
    { label: 'Profile 路径', value: profile?.profilePath || profileSetup?.defaultProfilePath || '未加载', code: true },
    { label: '配置目录', value: profileSetup?.profileDirectory || '未加载', code: true },
    { label: '账号目录', value: profile?.accountRoot || '未加载', code: true },
    { label: 'db_storage', value: profile?.dbStoragePath || '未加载', code: true },
    { label: '缓存目录', value: profile?.cachePath || '未加载', code: true }
  ]), [capabilities?.mode, capabilities?.sourceMode, profile?.wxid, profile?.databaseKeyCount, profile?.profilePath, profile?.accountRoot, profile?.dbStoragePath, profile?.cachePath, profileSetup?.defaultProfilePath, profileSetup?.profileDirectory])

  const renderProfileTab = () => (
    <div className="tab-content">
      <div className="settings-section">
        <h2>macOS Profile</h2>
        <p className="section-desc">默认读取项目运行根目录 `profile.json`（可通过 `CHATCAPSULE_MAC_PROFILE_PATH` 覆盖，兼容旧的 `WEFLOW_MAC_PROFILE_PATH`）；数据库目录、缓存目录、databaseKeys 与图片 key 都从配置文件读取。</p>
      </div>

      <div className="mac-profile-grid">
        {profileSummaryItems.map((item) => (
          <div key={item.label} className="mac-profile-card">
            <span className="mac-profile-label">{item.label}</span>
            <div className={`mac-profile-value${item.code ? ' is-code' : ''}`}>{item.value}</div>
          </div>
        ))}
      </div>

      <div className="mac-inline-actions">
        <button className="btn btn-secondary" onClick={() => void handleImportProfile()} disabled={isImportingProfile || isExportingProfile || isExportingProfileTemplate || isReconnecting || isProbing}>
          <Upload size={16} /> {isImportingProfile ? '导入中...' : '导入 profile.json'}
        </button>
        <button className="btn btn-secondary" onClick={() => void handleExportProfile()} disabled={isImportingProfile || isExportingProfile || isExportingProfileTemplate || !profile?.profileLoaded}>
          <Download size={16} /> {isExportingProfile ? '导出中...' : '导出 profile.json'}
        </button>
        <button className="btn btn-secondary" onClick={() => void handleExportProfileTemplate()} disabled={isImportingProfile || isExportingProfile || isExportingProfileTemplate}>
          <Download size={16} /> {isExportingProfileTemplate ? '导出中...' : '导出模板'}
        </button>
        <button className="btn btn-secondary" onClick={() => void openPath(profileSetup?.profileDirectory)} disabled={!profileSetup?.profileDirectory}>
          <FolderOpen size={16} /> 打开配置目录
        </button>
        <button className="btn btn-secondary" onClick={() => void openPath(profile?.profilePath)} disabled={!profile?.profileLoaded}>
          <FolderOpen size={16} /> 打开 `profile.json`
        </button>
        <button className="btn btn-secondary" onClick={() => void openPath(profile?.accountRoot)} disabled={!profile?.accountRoot}>
          <FolderOpen size={16} /> 打开账号目录
        </button>
        <button className="btn btn-secondary" onClick={() => void handleReloadAll()} disabled={loading || isReconnecting || isProbing || isImportingProfile || isExportingProfile || isExportingProfileTemplate}>
          <RefreshCw size={16} /> 刷新状态
        </button>
        <button className="btn btn-primary" onClick={() => void handleReconnect()} disabled={isReconnecting || isProbing || isImportingProfile || isExportingProfile || isExportingProfileTemplate}>
          <Database size={16} /> {isReconnecting ? '重连中...' : '重连数据库'}
        </button>
        <button className="btn btn-secondary" onClick={() => void handleProbe()} disabled={isProbing || isImportingProfile || isExportingProfile || isExportingProfileTemplate || !profile?.profileLoaded}>
          <AlertCircle size={16} /> {isProbing ? '探针执行中...' : '运行探针'}
        </button>
      </div>

      <div className="mac-status-grid">
        <div className={`mac-check-card ${profile?.profileLoaded ? 'ok' : 'bad'}`}>profile.json {profile?.profileLoaded ? '已加载' : '未加载'}</div>
        <div className={`mac-check-card ${profile?.accountRootExists ? 'ok' : 'bad'}`}>accountRoot {profile?.accountRootExists ? '存在' : '不存在'}</div>
        <div className={`mac-check-card ${profile?.dbStoragePathExists ? 'ok' : 'bad'}`}>dbStoragePath {profile?.dbStoragePathExists ? '存在' : '不存在'}</div>
        <div className={`mac-check-card ${profile?.decryptedRootExists ? 'ok' : 'bad'}`}>decryptedRoot {profile?.decryptedRootExists ? '存在' : '不存在'}</div>
      </div>

      {profile?.profileLoaded ? (
        allowInlineProfileEdit ? (
          <>
            <div className="settings-section">
              <h2>databaseKeys 编辑</h2>
              <p className="section-desc">逐项维护 db 的 enc_key / salt。保存后会覆盖默认 profile.json。</p>
            </div>

            <div className="mac-profile-editor">
              <div className="mac-profile-editor-header">
                <div>
                  <strong>数据库密钥清单</strong>
                  <div className="mac-profile-editor-hint">
                    必填库：session/session.db、contact/contact.db、hardlink/hardlink.db、head_image/head_image.db、emoticon/emoticon.db、sns/sns.db，以及全部 message/message_*.db / message/biz_message_*.db / message/media_*.db。
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setProfileEditorOpen((prev) => !prev)}>
                  {profileEditorOpen ? '收起' : '展开'}
                </button>
              </div>

              {profileEditorOpen && (
                <div className="mac-profile-editor-body">
                  <div className="mac-database-key-list">
                    {profileDatabaseKeys.map((item, index) => (
                      <div className="mac-database-key-item" key={`${item.path}-${index}`}>
                        <div className="mac-database-key-row">
                          <div className="form-group">
                            <label className="field-label">db 相对路径</label>
                            <input
                              className="field-input"
                              value={item.path}
                              onChange={(event) => updateProfileDatabaseKey(index, { path: event.target.value })}
                              placeholder="session/session.db"
                            />
                          </div>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => removeProfileDatabaseKey(index)}
                            disabled={profileDatabaseKeys.length <= 1}
                          >
                            删除
                          </button>
                        </div>

                        <div className="mac-database-key-grid">
                          <div className="form-group">
                            <label className="field-label">enc_key</label>
                            <input
                              className="field-input"
                              value={item.encKey}
                              onChange={(event) => updateProfileDatabaseKey(index, { encKey: event.target.value })}
                              placeholder="请输入 enc_key"
                            />
                          </div>
                          <div className="form-group">
                            <label className="field-label">salt</label>
                            <input
                              className="field-input"
                              value={item.salt}
                              onChange={(event) => updateProfileDatabaseKey(index, { salt: event.target.value })}
                              placeholder="请输入 salt"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mac-database-key-actions">
                    <button className="btn btn-secondary btn-sm" onClick={addProfileDatabaseKey}>
                      添加数据库
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setProfileDatabaseKeys(sampleDatabaseKeys)}
                    >
                      填入示例
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => void refreshProfilePayload()}
                    >
                      重新载入
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void handleSaveProfileDatabaseKeys()}
                      disabled={isSavingProfileKeys}
                    >
                      {isSavingProfileKeys ? '保存中...' : '保存到 profile.json'}
                    </button>
                  </div>

                  {profileKeysError && <div className="error-message">{profileKeysError}</div>}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="mac-profile-note">当前版本不支持在前端编辑 databaseKeys，请使用模板填写并重新导入 profile.json。</div>
        )
      ) : (
        <div className="mac-profile-note">读取 profile.json 后可查看详情并运行探针。</div>
      )}

      {profile?.error && <div className="unavailable-notice"><AlertCircle size={16} /><p>{profile.error}</p></div>}

      {!profile?.profileLoaded && (
        <div className="mac-profile-note">
          {profileDiagnosticItems.map((item) => (
            <div key={item}>{item}</div>
          ))}
        </div>
      )}

      <div className="divider" />

      <div className="settings-section">
        <h2>数据库探针</h2>
        <p className="section-desc">最小探针会验证 `session/session.db`、`contact/contact.db`、`message/message_0.db`、`hardlink/hardlink.db` 是否能够根据单库 keyring 导出并读取。</p>
      </div>

      <div className="mac-meta-row">
        <span>最近执行：{formatProbeTime(probeResult?.probedAt)}</span>
        <span>探针结果：{probeResult ? (probeResult.success ? '全部通过' : '存在失败项') : '尚未执行'}</span>
        <span>探针源模式：{probeResult?.sourceMode || capabilities?.sourceMode || '未知'}</span>
      </div>
      {probeResult?.error && <div className="unavailable-notice"><AlertCircle size={16} /><p>{probeResult.error}</p></div>}
      <div className="mac-probe-list">
        {(probeResult?.probes || []).map((probe) => (
          <div key={probe.relativePath} className={`mac-probe-item ${probe.success ? 'ok' : 'bad'}`}>
            <div className="mac-probe-head">
              <strong>{probe.relativePath}</strong>
              <span>{probe.success ? `已验证，可读表数 ${probe.tableCount ?? 0}` : (probe.error || '验证失败')}</span>
            </div>
            <div className="mac-probe-paths">
              <code>{probe.localPath || probe.sourcePath}</code>
              <button className="btn btn-secondary btn-sm" onClick={() => void openPath(probe.localPath || probe.sourcePath)} disabled={!(probe.localPath || probe.sourcePath)}>打开</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  const renderAppearanceTab = () => (
    <div className="tab-content">
      <div className="settings-section">
        <h2>主题模式</h2>
        <p className="section-desc">这些属于应用偏好，不会改动 `profile.json`。</p>
      </div>

      <div className="mac-inline-actions">
        {[
          { value: 'light' as ThemeMode, label: '浅色', icon: Sun },
          { value: 'dark' as ThemeMode, label: '深色', icon: Moon },
          { value: 'system' as ThemeMode, label: '跟随系统', icon: Monitor }
        ].map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.value}
              className={`tab-btn ${themeMode === item.value ? 'active' : ''}`}
              onClick={() => setThemeMode(item.value)}
            >
              <Icon size={16} /> {item.label}
            </button>
          )
        })}
      </div>

      <div className="form-group">
        <label>当前生效模式</label>
        <span className="form-hint">当前界面根据主题模式与系统主题综合计算得出。</span>
        <input value={effectiveMode === 'dark' ? '深色模式' : '浅色模式'} readOnly />
      </div>

      <div className="mac-theme-grid">
        {themes.map((theme) => (
          <button
            key={theme.id}
            className={`mac-theme-card ${currentTheme === theme.id ? 'active' : ''}`}
            onClick={() => setTheme(theme.id)}
            type="button"
          >
            <div className="mac-theme-swatch" style={{ background: theme.accentColor ? `linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor})` : theme.primaryColor }} />
            <div className="mac-theme-name">{theme.name}</div>
            <div className="mac-theme-desc">{theme.description}</div>
          </button>
        ))}
      </div>
    </div>
  )

  const renderModelsTab = () => (
    <div className="tab-content">
      <div className="form-group">
        <label>日志记录</label>
        <span className="form-hint">用于排查数据库与导出问题。</span>
        <div className="log-toggle-line">
          <span className="log-status">{logEnabled ? '已开启' : '已关闭'}</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={logEnabled}
              onChange={async (event) => {
                const next = event.target.checked
                setLogEnabled(next)
                await configService.setLogEnabled(next)
              }}
            />
            <span className="switch-slider" />
          </label>
        </div>
      </div>

      <div className="divider" />

      <div className="form-group">
        <label>模型名称</label>
        <span className="form-hint">保留原有配置字段，便于后续扩展不同模型。</span>
        <select
          value={whisperModelName}
          onChange={async (event) => {
            const value = event.target.value
            setWhisperModelName(value)
            await configService.setWhisperModelName(value)
          }}
        >
          <option value="tiny">tiny</option>
          <option value="base">base</option>
          <option value="small">small</option>
          <option value="medium">medium</option>
        </select>
      </div>

      <div className="form-group">
        <label>模型目录</label>
        <span className="form-hint">用于存放语音转写模型文件。</span>
        <input value={whisperModelDir || '未设置，使用默认目录'} readOnly />
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={() => void handleSelectWhisperModelDir()}>
            <FolderOpen size={16} /> 选择目录
          </button>
          <button className="btn btn-secondary" onClick={() => void openPath(whisperModelDir || whisperModelStatus?.modelPath)}>
            <FolderOpen size={16} /> 打开目录
          </button>
        </div>
      </div>

      <div className="form-group">
        <label>模型状态</label>
        <span className="form-hint">当前会读取本地模型文件状态。</span>
        <div className="mac-status-grid compact">
          <div className={`mac-check-card ${whisperModelStatus?.exists ? 'ok' : 'bad'}`}>{whisperModelStatus?.exists ? '模型文件已就绪' : '模型文件未找到'}</div>
          <div className="mac-check-card neutral">模型大小：{formatBytes(whisperModelStatus?.sizeBytes)}</div>
        </div>
        <div className="mac-inline-actions">
          <button className="btn btn-primary" onClick={() => void handleDownloadWhisperModel()} disabled={isWhisperDownloading}>
            <Download size={16} /> {isWhisperDownloading ? `下载中 ${whisperDownloadProgress.toFixed(0)}%` : '下载内置模型'}
          </button>
          <button className="btn btn-secondary" onClick={() => void refreshWhisperStatus()}>
            <RefreshCw size={16} /> 刷新模型状态
          </button>
        </div>
      </div>

      <div className="divider" />

      <div className="form-group">
        <label>自动转写语音</label>
        <div className="log-toggle-line">
          <span className="log-status">{autoTranscribeVoice ? '已开启' : '已关闭'}</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={autoTranscribeVoice}
              onChange={async (event) => {
                const next = event.target.checked
                setAutoTranscribeVoice(next)
                await configService.setAutoTranscribeVoice(next)
              }}
            />
            <span className="switch-slider" />
          </label>
        </div>
      </div>

      <div className="form-group">
        <label>转写语言</label>
        <span className="form-hint">至少保留一种语言。</span>
        <div className="mac-chip-list selectable">
          {languageOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`mac-chip ${transcribeLanguages.includes(option.value) ? 'active' : ''}`}
              onClick={() => void handleToggleLanguage(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  const renderCacheTab = () => (
    <div className="tab-content">
      <div className="form-group">
        <label>SQLite 缓存根目录</label>
        <span className="form-hint">该目录来自 `profile.json`，应用内只读展示；如需修改，请直接编辑外部配置文件。</span>
        <input value={profile?.cachePath || '未加载'} readOnly />
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={() => void openPath(profile?.cachePath)}>
            <FolderOpen size={16} /> 打开缓存目录
          </button>
          <button className="btn btn-secondary" onClick={() => void openPath(profile?.profilePath)}>
            <FolderOpen size={16} /> 打开 `profile.json`
          </button>
        </div>
      </div>

      <div className="form-group">
        <label>默认导出目录</label>
        <span className="form-hint">导出文件写入位置，属于应用偏好，可在这里修改。</span>
        <input value={exportPath || '未设置，导出时临时选择'} readOnly />
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={() => void handleSelectExportPath()}>
            <FolderOpen size={16} /> 选择目录
          </button>
          <button className="btn btn-secondary" onClick={() => void openPath(exportPath)} disabled={!exportPath}>
            <FolderOpen size={16} /> 打开目录
          </button>
        </div>
      </div>

      <div className="divider" />

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={() => void handleClearImageCache()} disabled={isClearingCache}>
          <Trash2 size={16} /> 清除图片缓存
        </button>
        <button className="btn btn-danger" onClick={() => void handleClearAllCache()} disabled={isClearingCache}>
          <Trash2 size={16} /> 清除所有缓存
        </button>
      </div>
    </div>
  )

  const renderApiTab = () => (
    <HttpApiSettingsPanel
      httpApiRunning={httpApiRunning}
      isTogglingApi={isTogglingApi}
      httpApiPort={httpApiPort}
      httpApiTokenMasked={httpApiTokenMasked}
      httpApiTokenPresent={httpApiTokenPresent}
      httpApiAllowedOriginsInput={httpApiAllowedOriginsInput}
      httpApiAllowedOrigins={httpApiAllowedOrigins}
      httpApiMediaExportPath={httpApiMediaExportPath}
      onSetPort={setHttpApiPort}
      onToggleApi={() => void handleToggleApi()}
      onCopyApiToken={() => void handleCopyApiToken()}
      onRotateApiToken={() => void handleRotateApiToken()}
      onChangeAllowedOriginsInput={setHttpApiAllowedOriginsInput}
      onSaveApiAllowedOrigins={() => void handleSaveApiAllowedOrigins()}
      onCopyApiUrl={() => void handleCopyApiUrl()}
    />
  )

  const renderSecurityTab = () => (
    <div className="tab-content">
      <div className="form-group">
        <label>应用锁状态</label>
        <span className="form-hint">
          {isLockMode ? '已开启应用锁' : authEnabled ? '已启用旧模式，请重新设置密码完成升级' : '未开启应用锁'}
        </span>
        {authEnabled && !showDisableLockInput && (
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setShowDisableLockInput(true)}>关闭应用锁</button>
          </div>
        )}
        {showDisableLockInput && (
          <div className="mac-inline-field">
            <input
              type="password"
              placeholder="输入当前密码以关闭"
              value={disableLockPassword}
              onChange={(event) => setDisableLockPassword(event.target.value)}
            />
            <button className="btn btn-primary" onClick={() => void handleDisableLock()}>确认</button>
            <button className="btn btn-secondary" onClick={() => { setShowDisableLockInput(false); setDisableLockPassword('') }}>取消</button>
          </div>
        )}
      </div>

      <div className="divider" />

      <div className="form-group">
        <label>{isLockMode ? '修改密码' : '设置密码并开启应用锁'}</label>
        {isLockMode && (
          <input type="password" placeholder="旧密码" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} />
        )}
        <input type="password" placeholder="新密码" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        <div className="mac-inline-field">
          <input type="password" placeholder="确认新密码" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          <button className="btn btn-primary" onClick={() => void handleUpdatePassword()} disabled={!newPassword}>
            {isLockMode ? '更新' : '开启'}
          </button>
        </div>
      </div>

      <div className="divider" />

      <div className="form-group">
        <label>系统生物识别</label>
        <span className="form-hint">用于快速解锁应用。请先开启应用锁。</span>
        <div className="mac-status-grid compact">
          <div className={`mac-check-card ${helloAvailable ? 'ok' : 'bad'}`}>{helloAvailable ? '设备支持系统生物识别' : '当前设备不支持系统生物识别'}</div>
          <div className={`mac-check-card ${authUseHello ? 'ok' : 'neutral'}`}>{authUseHello ? '已启用系统生物识别' : '未启用系统生物识别'}</div>
        </div>
        {!authUseHello && authEnabled && (
          <input
            type="password"
            placeholder="输入当前密码以开启系统生物识别"
            value={helloPassword}
            onChange={(event) => setHelloPassword(event.target.value)}
          />
        )}
        <div className="btn-row">
          {authUseHello ? (
            <button
              className="btn btn-secondary"
              onClick={async () => {
                await electronApi.auth.clearHelloSecret()
                await configService.setAuthUseHello(false)
                setAuthUseHello(false)
                showMessage('系统生物识别已关闭', true)
              }}
            >
              关闭系统生物识别
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => void handleSetupHello()} disabled={!helloAvailable || !authEnabled || !helloPassword || isSettingHello}>
              {isSettingHello ? '设置中...' : '开启系统生物识别'}
            </button>
          )}
        </div>
      </div>
    </div>
  )

  const renderAboutTab = () => (
    <div className="tab-content">
      <div className="mac-about-card">
        <img src="./logo.png" alt="Chat Capsule" className="mac-about-logo" />
        <h2>Chat Capsule</h2>
        <p>基于 WeFlow 演进的非官方维护分支，面向 macOS 的本地只读聊天记录工具</p>
        <div className="form-hint">源码公开发布，遵循 `CC BY-NC-SA 4.0`；不代表上游官方版本。</div>
        <div className="mac-about-version">v{appVersion || '...'}</div>
      </div>

      <div className="mac-inline-actions wrap">
        <button className="btn btn-secondary" onClick={() => void electronApi.window.openAgreementWindow()}>用户协议</button>
      </div>
    </div>
  )

  if (!capabilities && loading) {
    return (
      <div className="settings-page">
        <div className="settings-header"><h1>设置</h1></div>
        <div className="settings-body">
          <div className="tab-content">
            <div className="settings-section">
              <h2>正在读取配置</h2>
              <p className="section-desc">正在加载 macOS profile 与应用设置。</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-page mac-settings-page-unified">
      {toast && <div className={`message-toast ${toast.success ? 'success' : 'error'}`}>{toast.text}</div>}

      <div className="settings-header">
        <div>
          <h1>设置</h1>
          <div className="mac-settings-subtitle">macOS 版本统一使用 `profile.json` + `databaseKeys`，这里只管理应用偏好与只读状态信息。</div>
        </div>
        <div className="settings-actions">
          <button className="btn btn-secondary" onClick={() => void handleReloadAll()} disabled={loading || isReconnecting || isProbing}>
            <RefreshCw size={16} /> 刷新
          </button>
        </div>
      </div>

      <div className="settings-tabs mac-settings-tabs-wrap">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button key={tab.id} className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
              <Icon size={16} /> {tab.label}
            </button>
          )
        })}
      </div>

      <div className="settings-body">
        {activeTab === 'profile' && renderProfileTab()}
        {activeTab === 'appearance' && renderAppearanceTab()}
        {activeTab === 'models' && renderModelsTab()}
        {activeTab === 'cache' && renderCacheTab()}
        {activeTab === 'api' && renderApiTab()}
        {activeTab === 'security' && renderSecurityTab()}
        {activeTab === 'about' && renderAboutTab()}
      </div>
    </div>
  )
}

export default MacSettingsPage
