import type { ElementType } from 'react'
import { Database, Globe, HardDrive, Info, Lock, Mic, Palette } from 'lucide-react'
import type { MacProfileProbeEntry } from '../../types/electron'

export type MacSettingsTab =
  | 'profile'
  | 'appearance'
  | 'models'
  | 'cache'
  | 'api'
  | 'security'
  | 'about'

export type MacProbeResult = {
  success: boolean
  sourceMode?: 'encrypted-sqlcipher' | 'decrypted-sqlite'
  probes: MacProfileProbeEntry[]
  probedAt: number
  error?: string
}

export type ToastState = {
  text: string
  success: boolean
}

export const macSettingsTabs: Array<{ id: MacSettingsTab; label: string; icon: ElementType }> = [
  { id: 'profile', label: 'Profile', icon: Database },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'models', label: '模型', icon: Mic },
  { id: 'cache', label: '缓存', icon: HardDrive },
  { id: 'api', label: 'API', icon: Globe },
  { id: 'security', label: '安全', icon: Lock },
  { id: 'about', label: '关于', icon: Info }
]

export const macSettingsLanguageOptions = [
  { value: 'zh', label: '中文' },
  { value: 'yue', label: '粤语' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' }
]

export function formatProbeTime(timestamp?: number): string {
  if (!timestamp) return '尚未执行'
  try {
    return new Date(timestamp).toLocaleString('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return String(timestamp)
  }
}

export function formatBytes(bytes?: number): string {
  const value = Number(bytes || 0)
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  const size = value / Math.pow(1024, index)
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

export function normalizeHttpApiOriginsInput(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  ))
}
