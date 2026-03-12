type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function shouldLogDebug(): boolean {
  try {
    return Boolean(import.meta.env?.DEV)
  } catch {
    return false
  }
}

function emit(level: LogLevel, scope: string, args: unknown[]): void {
  if (level === 'debug' && !shouldLogDebug()) return
  const prefix = `[${scope}]`
  const payload = [prefix, ...args]
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

export function createLogger(scope: string) {
  return {
    debug: (...args: unknown[]) => emit('debug', scope, args),
    info: (...args: unknown[]) => emit('info', scope, args),
    warn: (...args: unknown[]) => emit('warn', scope, args),
    error: (...args: unknown[]) => emit('error', scope, args)
  }
}
