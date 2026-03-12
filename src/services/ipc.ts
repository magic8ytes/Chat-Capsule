import type { ElectronAPI } from '../types/electron'

function createUnavailableElectronApi(path: string): unknown {
  const fail = () => {
    throw new Error(`[Chat Capsule] Electron API bridge is unavailable: ${path}`)
  }

  return new Proxy(fail, {
    get(_target, property) {
      if (property === Symbol.toPrimitive) {
        return () => `[Unavailable ${path}]`
      }
      return createUnavailableElectronApi(`${path}.${String(property)}`)
    },
    apply() {
      fail()
    }
  })
}

export const electronApi: ElectronAPI = ((window.electronAPI || createUnavailableElectronApi('electronAPI')) as unknown) as ElectronAPI

export const config = electronApi.config
export const auth = electronApi.auth
export const dialog = electronApi.dialog
export const shell = electronApi.shell
export const app = electronApi.app
export const diagnostics = electronApi.diagnostics
export const windowControl = electronApi.window
export const chat = electronApi.chat
export const analytics = electronApi.analytics
export const cache = electronApi.cache
export const groupAnalytics = electronApi.groupAnalytics
export const exportApi = electronApi.export
export const sns = electronApi.sns
export const http = electronApi.http
export const whisper = electronApi.whisper

export const image = electronApi.image
export const video = electronApi.video
