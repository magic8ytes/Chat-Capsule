import { execFileSync } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { MacDatabaseKeyEntry, ResolvedMacProfile } from './macProfileService'
import { escapeSqlString, getSqlcipherBinaryPath, isSqlcipherAvailable } from './sqlcipherSupport'

interface ExportMeta {
  sourcePath: string
  sourceMtimeMs: number
  sourceSize: number
  walMtimeMs: number
  walSize: number
  shmMtimeMs: number
  shmSize: number
  encKey: string
  salt: string
}

function getStatOrZero(path: string): { mtimeMs: number; size: number } {
  if (!existsSync(path)) return { mtimeMs: 0, size: 0 }
  const stat = statSync(path)
  return { mtimeMs: Math.floor(stat.mtimeMs), size: stat.size }
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

function sameMeta(left: ExportMeta, right: ExportMeta | null): boolean {
  if (!right) return false
  return left.sourcePath === right.sourcePath
    && left.sourceMtimeMs === right.sourceMtimeMs
    && left.sourceSize === right.sourceSize
    && left.walMtimeMs === right.walMtimeMs
    && left.walSize === right.walSize
    && left.shmMtimeMs === right.shmMtimeMs
    && left.shmSize === right.shmSize
    && left.encKey === right.encKey
    && left.salt === right.salt
}

class SqlcipherMacService {
  isAvailable(): boolean {
    return isSqlcipherAvailable()
  }

  canUseEncryptedStorage(profile: Pick<ResolvedMacProfile, 'dbStoragePath'>): boolean {
    return this.isAvailable() && existsSync(profile.dbStoragePath)
  }

  getSourceMode(profile: Pick<ResolvedMacProfile, 'dbStoragePath' | 'decryptedRoot'>): 'encrypted-sqlcipher' | 'decrypted-sqlite' {
    if (this.canUseEncryptedStorage(profile as Pick<ResolvedMacProfile, 'dbStoragePath'>)) {
      return 'encrypted-sqlcipher'
    }
    return 'decrypted-sqlite'
  }

  prepareReadableDb(profile: ResolvedMacProfile, relativePath: string, keyEntry: MacDatabaseKeyEntry): string {
    const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
    const destinationPath = join(profile.cachePath, 'sqlite', normalized)

    const decryptedSourcePath = join(profile.decryptedRoot, normalized)

    if (this.canUseEncryptedStorage(profile)) {
      const encryptedSourcePath = join(profile.dbStoragePath, normalized)
      if (existsSync(encryptedSourcePath)) {
        try {
          this.exportEncryptedDbIfNeeded(encryptedSourcePath, destinationPath, keyEntry)
          return destinationPath
        } catch (error) {
          if (!existsSync(decryptedSourcePath)) {
            throw error
          }
        }
      }
    }

    if (!existsSync(decryptedSourcePath)) {
      throw new Error(`未找到数据库源文件: ${normalized}`)
    }
    this.copyPlainDbIfNeeded(decryptedSourcePath, destinationPath)
    return destinationPath
  }

  private exportEncryptedDbIfNeeded(sourcePath: string, destinationPath: string, keyEntry: MacDatabaseKeyEntry): void {
    mkdirSync(dirname(destinationPath), { recursive: true })
    const nextMeta = this.buildExportMeta(sourcePath, keyEntry)
    const metaPath = `${destinationPath}.meta.json`
    const currentMeta = readJsonFile<ExportMeta>(metaPath)

    if (existsSync(destinationPath) && sameMeta(nextMeta, currentMeta)) {
      return
    }

    const binary = getSqlcipherBinaryPath()
    if (!binary) {
      throw new Error('未找到 sqlcipher 可执行文件')
    }

    const tempPath = `${destinationPath}.tmp`
    const tempMetaPath = `${metaPath}.tmp`
    for (const candidate of [tempPath, `${tempPath}-wal`, `${tempPath}-shm`, tempMetaPath]) {
      if (existsSync(candidate)) {
        try { unlinkSync(candidate) } catch {}
      }
    }

    const sql = [
      `.timeout 5000`,
      `PRAGMA key = "x'${keyEntry.enc_key}'";`,
      `PRAGMA cipher_salt = "x'${keyEntry.salt}'";`,
      `ATTACH DATABASE '${escapeSqlString(tempPath)}' AS plaintext KEY '';`,
      `SELECT sqlcipher_export('plaintext');`,
      `DETACH DATABASE plaintext;`
    ].join('\n')

    try {
      execFileSync(binary, [sourcePath], {
        input: sql,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      })

      if (!existsSync(tempPath)) {
        throw new Error(`sqlcipher 导出未生成目标文件: ${destinationPath}`)
      }

      for (const staleSidecar of [`${destinationPath}-wal`, `${destinationPath}-shm`]) {
        if (existsSync(staleSidecar)) {
          try { unlinkSync(staleSidecar) } catch {}
        }
      }

      renameSync(tempPath, destinationPath)
      writeFileSync(tempMetaPath, JSON.stringify(nextMeta, null, 2))
      renameSync(tempMetaPath, metaPath)
    } catch (error) {
      try { if (existsSync(tempPath)) unlinkSync(tempPath) } catch {}
      try { if (existsSync(tempMetaPath)) unlinkSync(tempMetaPath) } catch {}
      throw new Error(`sqlcipher 导出失败: ${String(error)}`)
    }
  }

  private copyPlainDbIfNeeded(sourcePath: string, destinationPath: string): void {
    mkdirSync(dirname(destinationPath), { recursive: true })
    const sourceStat = statSync(sourcePath)
    const destinationStat = existsSync(destinationPath) ? statSync(destinationPath) : null
    const sidecars = this.collectSidecarStats(sourcePath)
    const latestSourceMtimeMs = Math.max(
      Math.floor(sourceStat.mtimeMs),
      sidecars.wal.mtimeMs,
      sidecars.shm.mtimeMs
    )

    const needsCopy = !destinationStat
      || destinationStat.size !== sourceStat.size
      || Math.floor(destinationStat.mtimeMs) < latestSourceMtimeMs

    if (needsCopy) {
      copyFileSync(sourcePath, destinationPath)
    }

    for (const suffix of ['-wal', '-shm']) {
      const sourceSidecar = `${sourcePath}${suffix}`
      const destinationSidecar = `${destinationPath}${suffix}`
      if (!existsSync(sourceSidecar)) continue
      const sourceSidecarStat = statSync(sourceSidecar)
      const destinationSidecarStat = existsSync(destinationSidecar) ? statSync(destinationSidecar) : null
      const sidecarNeedsCopy = !destinationSidecarStat
        || destinationSidecarStat.size !== sourceSidecarStat.size
        || Math.floor(destinationSidecarStat.mtimeMs) < Math.floor(sourceSidecarStat.mtimeMs)
      if (sidecarNeedsCopy) {
        copyFileSync(sourceSidecar, destinationSidecar)
      }
    }
  }

  private buildExportMeta(sourcePath: string, keyEntry: MacDatabaseKeyEntry): ExportMeta {
    const source = getStatOrZero(sourcePath)
    const wal = getStatOrZero(`${sourcePath}-wal`)
    const shm = getStatOrZero(`${sourcePath}-shm`)
    return {
      sourcePath,
      sourceMtimeMs: source.mtimeMs,
      sourceSize: source.size,
      walMtimeMs: wal.mtimeMs,
      walSize: wal.size,
      shmMtimeMs: shm.mtimeMs,
      shmSize: shm.size,
      encKey: keyEntry.enc_key,
      salt: keyEntry.salt
    }
  }

  private collectSidecarStats(sourcePath: string): { wal: { mtimeMs: number; size: number }; shm: { mtimeMs: number; size: number } } {
    return {
      wal: getStatOrZero(`${sourcePath}-wal`),
      shm: getStatOrZero(`${sourcePath}-shm`)
    }
  }
}

export const sqlcipherMacService = new SqlcipherMacService()
