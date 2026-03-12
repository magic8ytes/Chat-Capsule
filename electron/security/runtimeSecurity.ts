import { app, BrowserWindow, net, protocol, session } from 'electron'
import { existsSync } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import type { ConfigService } from '../services/config'
import type { MacProfileSummary } from '../services/macProfileService'
import { getLocalMediaPathFromUrl, LOCAL_MEDIA_PROTOCOL } from '../../shared/mediaUrl'
import { createElectronLogger } from '../utils/debug'

const logger = createElectronLogger('runtimeSecurity')

let mediaProtocolRegistered = false
let mediaPrivilegesRegistered = false


function isDevelopmentRendererUrl(url: string): boolean {
  return url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:')
}

function buildContentSecurityPolicy(url: string): string {
  if (isDevelopmentRendererUrl(url)) {
    return [
      "default-src 'self' file: http://localhost:* http://127.0.0.1:*;",
      "base-uri 'self';",
      "object-src 'none';",
      "frame-src 'none';",
      "form-action 'self';",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' file: http://localhost:* http://127.0.0.1:*;",
      "style-src 'self' 'unsafe-inline' file: http://localhost:* http://127.0.0.1:*;",
      "img-src 'self' file: data: blob: weflow-media: http://localhost:* http://127.0.0.1:* https:;",
      "media-src 'self' file: data: blob: weflow-media: http://localhost:* http://127.0.0.1:* https:;",
      "font-src 'self' file: data: http://localhost:* http://127.0.0.1:*;",
      "connect-src 'self' file: ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:* https:;",
      "worker-src 'self' file: blob: http://localhost:* http://127.0.0.1:*;"
    ].join(' ')
  }

  return [
    "default-src 'self' file:;",
    "base-uri 'self';",
    "object-src 'none';",
    "frame-ancestors 'none';",
    "frame-src 'none';",
    "form-action 'self';",
    "script-src 'self' file:;",
    "style-src 'self' 'unsafe-inline' file:;",
    "img-src 'self' file: data: blob: http://127.0.0.1:* https: weflow-media:;",
    "media-src 'self' file: data: blob: http://127.0.0.1:* https: weflow-media:;",
    "font-src 'self' file: data:;",
    "connect-src 'self' file: http://127.0.0.1:* ws://127.0.0.1:* https:;",
    "worker-src 'self' file: blob:;"
  ].join(' ')
}


function createTextResponse(status: number, body: string): any {
  type ResponseConstructor = new (body?: unknown, init?: { status?: number }) => unknown
  const ResponseCtor = (globalThis as typeof globalThis & { Response?: ResponseConstructor }).Response
  if (!ResponseCtor) {
    throw new Error('Response constructor is not available in this runtime')
  }
  return new ResponseCtor(body, { status })
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedRoot = path.resolve(rootPath)
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
}

function resolveAllowedMediaRoots(
  configService: ConfigService | null,
  profileSummary: MacProfileSummary | null | undefined
): string[] {
  const roots = [
    app.isReady() ? app.getPath('temp') : null,
    process.env.TMPDIR,
    process.env.TEMP,
    process.env.TMP,
    configService?.getCacheBasePath(),
    configService?.get('cachePath'),
    configService?.get('exportPath'),
    profileSummary?.cachePath,
    profileSummary?.accountRoot,
    profileSummary?.decryptedRoot
  ]

  return Array.from(new Set(roots
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => path.resolve(item))))
}

export function registerMediaProtocolPrivileges(): void {
  if (mediaPrivilegesRegistered) return
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_MEDIA_PROTOCOL.replace(/:$/, ''),
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: false
      }
    }
  ])
  mediaPrivilegesRegistered = true
}

export async function registerMediaProtocol(options: {
  getConfigService: () => ConfigService | null
  getProfileSummary: () => MacProfileSummary | null | undefined
}): Promise<void> {
  if (mediaProtocolRegistered) return

  await protocol.handle(LOCAL_MEDIA_PROTOCOL.replace(/:$/, ''), async (request) => {
    const localPath = getLocalMediaPathFromUrl(request.url)
    if (!localPath) {
      return createTextResponse(400, 'Invalid media path')
    }

    const allowedRoots = resolveAllowedMediaRoots(options.getConfigService(), options.getProfileSummary())
    const allowed = allowedRoots.some((root) => isPathInsideRoot(localPath, root))
    if (!allowed) {
      logger.warn('Blocked media path outside allowlist', { target: localPath })
      return createTextResponse(403, 'Media path is not allowed')
    }

    if (!existsSync(localPath)) {
      return createTextResponse(404, 'Media file not found')
    }

    return net.fetch(pathToFileURL(localPath).toString())
  })

  mediaProtocolRegistered = true
}

export function configureDefaultSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  if (typeof session.defaultSession.setPermissionCheckHandler === 'function') {
    session.defaultSession.setPermissionCheckHandler(() => false)
  }

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isRendererDocument = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame'
    if (!isRendererDocument) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }

    const responseHeaders = { ...(details.responseHeaders || {}) }
    responseHeaders['Content-Security-Policy'] = [buildContentSecurityPolicy(details.url)]
    callback({ responseHeaders })
  })
}

export function applyWindowSecurity(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}
