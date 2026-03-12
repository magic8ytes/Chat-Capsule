import {
  DEFAULT_HTTP_API_PORT,
  normalizeHttpApiPort,
  normalizeOriginAllowlist,
  type HttpApiStatus,
  type HttpApiTokenView
} from '../../shared/contracts/http.ts'

export interface IpcMainHandleLike {
  handle: (channel: string, listener: (...args: unknown[]) => unknown) => void
}

interface HttpServiceLike {
  start: (port?: number) => Promise<{ success: boolean; port?: number; error?: string }>
  stop: () => Promise<void>
  isRunning: () => boolean
  getPort: () => number | null
  getDefaultMediaExportPath: () => string
  getStatus: () => HttpApiStatus
  copyTokenToClipboard: () => Promise<HttpApiTokenView>
  rotateToken: () => string
  setAllowedOrigins: (origins: string[]) => string[]
}

export interface HttpIpcContext {
  httpService: HttpServiceLike
}

export function registerHttpIpcHandlersOn(ipcMainLike: IpcMainHandleLike, { httpService }: HttpIpcContext): void {
  ipcMainLike.handle(
    'http:start',
    ((async (_event: unknown, port?: number) => {
      return httpService.start(normalizeHttpApiPort(port, DEFAULT_HTTP_API_PORT))
    }) as unknown) as (...args: unknown[]) => Promise<{ success: boolean; port?: number; error?: string }>
  )

  ipcMainLike.handle(
    'http:stop',
    (async () => {
      await httpService.stop()
      return { success: true }
    }) as (...args: unknown[]) => Promise<{ success: true }>
  )

  ipcMainLike.handle(
    'http:status',
    (async (): Promise<HttpApiStatus> => {
      return httpService.getStatus()
    }) as (...args: unknown[]) => Promise<HttpApiStatus>
  )

  ipcMainLike.handle(
    'http:copyToken',
    (async (): Promise<{ success: true } & HttpApiTokenView> => {
      const tokenView = await httpService.copyTokenToClipboard()
      return {
        success: true,
        ...tokenView
      }
    }) as (...args: unknown[]) => Promise<{ success: true } & HttpApiTokenView>
  )

  ipcMainLike.handle(
    'http:rotateToken',
    (async (): Promise<{ success: true } & HttpApiTokenView> => {
      const token = httpService.rotateToken()
      return {
        success: true,
        tokenPresent: token.length > 0,
        tokenMasked: token.length > 0 ? `${token.slice(0, 4)}…${token.slice(-4)}` : null
      }
    }) as (...args: unknown[]) => Promise<{ success: true } & HttpApiTokenView>
  )

  ipcMainLike.handle(
    'http:setAllowedOrigins',
    ((async (_event: unknown, origins: unknown) => {
      if (!Array.isArray(origins) || origins.some((item) => typeof item !== 'string')) {
        throw new Error('CORS Allowlist 参数不合法')
      }

      const normalized = httpService.setAllowedOrigins(normalizeOriginAllowlist(origins))
      return {
        success: true,
        allowedOrigins: normalized
      }
    }) as unknown) as (...args: unknown[]) => Promise<{ success: true; allowedOrigins: string[] }>
  )
}
