import { BrowserWindow, ipcMain } from 'electron'
import type { ConfigService } from '../services/config'

interface AuthResult {
  success: boolean
  error?: string
}

interface WcdbServiceLike {
  verifyUser: (message: string, hwnd?: string) => Promise<AuthResult>
}

interface AuthIpcContext {
  getConfigService: () => ConfigService | null
  getMainWindow: () => BrowserWindow | null
  wcdbService: WcdbServiceLike
}

const getConfigUnavailableResult = (): AuthResult => ({
  success: false,
  error: '配置服务未初始化'
})

export function registerAuthIpcHandlers({ getConfigService, getMainWindow, wcdbService }: AuthIpcContext): void {
  ipcMain.handle('auth:hello', async (event, message?: string) => {
    const currentMainWindow = getMainWindow()
    const targetWin = (currentMainWindow && !currentMainWindow.isDestroyed())
      ? currentMainWindow
      : (BrowserWindow.fromWebContents(event.sender) || undefined)

    const hwndBuffer = targetWin?.getNativeWindowHandle()
    const hwndStr = hwndBuffer ? BigInt('0x' + hwndBuffer.toString('hex')).toString() : undefined
    const result = await wcdbService.verifyUser(message || '请验证您的身份以解锁 Chat Capsule', hwndStr)
    const configService = getConfigService()

    if (result?.success && configService) {
      const secret = configService.getHelloSecret()
      if (secret && configService.isLockMode()) {
        configService.unlock(secret)
      }
    }

    return result
  })

  ipcMain.handle('auth:verifyEnabled', async () => {
    return getConfigService()?.verifyAuthEnabled() ?? false
  })

  ipcMain.handle('auth:unlock', async (_event, password: string) => {
    const configService = getConfigService()
    if (!configService) return getConfigUnavailableResult()
    return configService.unlock(password)
  })

  ipcMain.handle('auth:enableLock', async (_event, password: string) => {
    const configService = getConfigService()
    if (!configService) return getConfigUnavailableResult()
    return configService.enableLock(password)
  })

  ipcMain.handle('auth:disableLock', async (_event, password: string) => {
    const configService = getConfigService()
    if (!configService) return getConfigUnavailableResult()
    return configService.disableLock(password)
  })

  ipcMain.handle('auth:changePassword', async (_event, oldPassword: string, newPassword: string) => {
    const configService = getConfigService()
    if (!configService) return getConfigUnavailableResult()
    return configService.changePassword(oldPassword, newPassword)
  })

  ipcMain.handle('auth:setHelloSecret', async (_event, password: string) => {
    const configService = getConfigService()
    if (!configService) return { success: false }
    configService.setHelloSecret(password)
    return { success: true }
  })

  ipcMain.handle('auth:clearHelloSecret', async () => {
    const configService = getConfigService()
    if (!configService) return { success: false }
    configService.clearHelloSecret()
    return { success: true }
  })

  ipcMain.handle('auth:isLockMode', async () => {
    return getConfigService()?.isLockMode() ?? false
  })
}
