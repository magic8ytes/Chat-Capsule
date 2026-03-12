import { create } from 'zustand'
import type { AppCapabilities } from '../types/platform'
import { app } from '../services/ipc'
import { createLogger } from '../utils/logger'

const logger = createLogger('platformStore')

interface PlatformState {
  capabilities: AppCapabilities | null
  loading: boolean
  loadCapabilities: () => Promise<void>
}

export const usePlatformStore = create<PlatformState>((set, get) => ({
  capabilities: null,
  loading: false,
  loadCapabilities: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const capabilities = await app.getCapabilities()
      set({ capabilities, loading: false })
    } catch (error) {
      logger.error('加载平台能力失败:', error)
      set({ loading: false })
    }
  }
}))
