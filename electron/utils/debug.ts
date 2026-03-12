import { app } from 'electron'
import { appendFile, mkdir } from 'fs/promises'
import path from 'path'

type ElectronLogLevel = 'debug' | 'info' | 'warn' | 'error'

let runtimeLogFilePath: string | null = null
let runtimeLogInitPromise: Promise<string | null> | null = null

export const isElectronDebugEnabled = (): boolean => {
  if (process.env.CHATCAPSULE_DEBUG === '1' || process.env.WEFLOW_DEBUG === '1') return true
  try {
    return !app.isPackaged
  } catch {
    return process.env.NODE_ENV !== 'production'
  }
}

function serializeLogArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack
    }
  }

  if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean' || arg == null) {
    return arg
  }

  try {
    return JSON.parse(JSON.stringify(arg))
  } catch {
    return String(arg)
  }
}

async function ensureRuntimeLogFilePath(): Promise<string | null> {
  if (runtimeLogFilePath) return runtimeLogFilePath
  if (runtimeLogInitPromise) return runtimeLogInitPromise

  runtimeLogInitPromise = (async () => {
    try {
      if (!app.isReady()) return null
      const logsDir = path.join(app.getPath('userData'), 'logs')
      await mkdir(logsDir, { recursive: true })
      runtimeLogFilePath = path.join(logsDir, 'electron-runtime.log')
      return runtimeLogFilePath
    } catch {
      return null
    } finally {
      runtimeLogInitPromise = null
    }
  })()

  return runtimeLogInitPromise
}

function persistElectronLog(level: ElectronLogLevel, scope: string | null, args: unknown[]): void {
  void ensureRuntimeLogFilePath().then((logFilePath) => {
    if (!logFilePath) return

    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      scope,
      args: args.map(serializeLogArg)
    }) + '\n'

    return appendFile(logFilePath, line).catch(() => {})
  })
}

function emitElectronLog(level: ElectronLogLevel, scope: string | null, args: unknown[]): void {
  if (level === 'debug' && !isElectronDebugEnabled()) {
    return
  }

  const payload = scope ? [`[${scope}]`, ...args] : args
  persistElectronLog(level, scope, args)

  switch (level) {
    case 'debug':
    case 'info':
      console.log(...payload)
      break
    case 'warn':
      console.warn(...payload)
      break
    case 'error':
      console.error(...payload)
      break
  }
}

export const debugLog = (...args: unknown[]): void => {
  emitElectronLog('debug', null, args)
}

export const debugWarn = (...args: unknown[]): void => {
  emitElectronLog('warn', null, args)
}

export function createElectronLogger(scope: string) {
  return {
    debug: (...args: unknown[]) => emitElectronLog('debug', scope, args),
    info: (...args: unknown[]) => emitElectronLog('info', scope, args),
    warn: (...args: unknown[]) => emitElectronLog('warn', scope, args),
    error: (...args: unknown[]) => emitElectronLog('error', scope, args)
  }
}
