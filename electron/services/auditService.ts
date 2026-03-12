import { app } from 'electron'
import { appendFile, mkdir } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { homedir } from 'os'
import { AUDIT_REDACTED_VALUE, redactAuditValue } from '../../shared/contracts/audit'
import { createElectronLogger } from '../utils/debug'

export type AuditSeverity = 'info' | 'warn' | 'error'

export interface AuditEvent {
  event: string
  severity?: AuditSeverity
  data?: Record<string, unknown>
}

const logger = createElectronLogger('AuditService')

function resolveAuditUserDataPath(): string {
  const injected = String(process.env.CHATCAPSULE_USER_DATA_PATH || process.env.WEFLOW_USER_DATA_PATH || '').trim()
  if (injected) return injected

  try {
    if (app.isReady()) {
      return app.getPath('userData')
    }
  } catch {
    // ignore and fallback below
  }

  return join(process.env.HOME || homedir(), 'Library', 'Application Support', 'ChatCapsule')
}

export function summarizePathForAudit(targetPath: string): { pathTail: string; parentTail?: string } {
  const normalized = String(targetPath || '').trim()
  if (!normalized) {
    return { pathTail: AUDIT_REDACTED_VALUE }
  }

  const pathTail = basename(normalized) || normalized
  const parentName = basename(dirname(normalized))
  return {
    pathTail,
    parentTail: parentName && parentName !== pathTail ? parentName : undefined
  }
}

class AuditService {
  private readonly securityMode = 'strict-local-readonly'
  private writeQueue: Promise<void> = Promise.resolve()

  getLogPath(): string {
    return join(resolveAuditUserDataPath(), 'logs', 'security-audit.log')
  }

  private enqueueWrite(entry: Record<string, unknown>): void {
    this.writeQueue = this.writeQueue
      .then(async () => {
        const logPath = this.getLogPath()
        await mkdir(dirname(logPath), { recursive: true })
        await appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8')
      })
      .catch((error) => {
        logger.warn('写入安全审计日志失败:', error)
      })
  }

  record(event: AuditEvent): void {
    const entry = {
      ts: new Date().toISOString(),
      securityMode: this.securityMode,
      severity: event.severity || 'info',
      event: String(event.event || '').trim() || 'unknown',
      data: redactAuditValue(event.data || {})
    }

    this.enqueueWrite(entry)

    const payload = ['[audit]', entry.event, entry.data]
    if (entry.severity === 'error') {
      logger.error(...payload)
    } else if (entry.severity === 'warn') {
      logger.warn(...payload)
    } else {
      logger.info(...payload)
    }
  }
}

export const auditService = new AuditService()
