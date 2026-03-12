import { create } from 'zustand'
export interface AppState {
  isDbConnected: boolean
  dbPath: string | null
  myWxid: string | null
  isLoading: boolean
  loadingText: string
  isLocked: boolean
  setDbConnected: (connected: boolean, path?: string) => void
  setMyWxid: (wxid: string) => void
  setLoading: (loading: boolean, text?: string) => void
  setLocked: (locked: boolean) => void
  reset: () => void
}

export const useAppStore = create<AppState>((set) => ({
  isDbConnected: false,
  dbPath: null,
  myWxid: null,
  isLoading: false,
  loadingText: '',
  isLocked: false,
  setDbConnected: (connected, path) => set({
    isDbConnected: connected,
    dbPath: path ?? null
  }),
  setMyWxid: (wxid) => set({ myWxid: wxid }),
  setLoading: (loading, text) => set({
    isLoading: loading,
    loadingText: text ?? ''
  }),
  setLocked: (locked) => set({ isLocked: locked }),
  reset: () => set({
    isDbConnected: false,
    dbPath: null,
    myWxid: null,
    isLoading: false,
    loadingText: '',
    isLocked: false
  })
}))
