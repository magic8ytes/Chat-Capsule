import { join, dirname, basename } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import * as crypto from 'crypto'
import Database from 'better-sqlite3'

export type HardlinkState = {
  db: Database.Database
  imageTable?: string
  dirTable?: string
}

interface MediaDatResolverContext {
  getConfigValue: (key: string) => unknown
  cleanAccountDirName: (dirName: string) => string
  hardlinkCache: Map<string, HardlinkState>
}

export function resolveAccountDir(dbPath: string, wxid: string): string | null {
  const normalized = dbPath.replace(/[\\/]+$/, '')

  if (basename(normalized).toLowerCase() === 'db_storage') {
    return dirname(normalized)
  }
  const dir = dirname(normalized)
  if (basename(dir).toLowerCase() === 'db_storage') {
    return dirname(dir)
  }

  const accountDirWithWxid = join(normalized, wxid)
  if (existsSync(accountDirWithWxid)) {
    return accountDirWithWxid
  }

  return normalized
}

function recursiveSearch(dir: string, pattern: string, maxDepth: number): string | null {
  if (maxDepth < 0) return null
  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const stats = statSync(fullPath)
      if (stats.isFile()) {
        const lowerEntry = entry.toLowerCase()
        if (lowerEntry.includes(pattern) && lowerEntry.endsWith('.dat')) {
          const baseLower = lowerEntry.slice(0, -4)
          if (!hasImageVariantSuffix(baseLower)) continue
          return fullPath
        }
      }
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const stats = statSync(fullPath)
      if (stats.isDirectory()) {
        const found = recursiveSearch(fullPath, pattern, maxDepth - 1)
        if (found) return found
      }
    }
  } catch {
    return null
  }
  return null
}

function looksLikeMd5(value: string): boolean {
  return /^[a-fA-F0-9]{16,32}$/.test(value)
}

function normalizeDatBase(name: string): string {
  let base = name.toLowerCase()
  if (base.endsWith('.dat') || base.endsWith('.jpg')) {
    base = base.slice(0, -4)
  }
  while (/[._][a-z]$/.test(base)) {
    base = base.slice(0, -2)
  }
  return base
}

function hasXVariant(baseLower: string): boolean {
  return /[._][a-z]$/.test(baseLower)
}

function getHardlinkState(accountDir: string, hardlinkPath: string, hardlinkCache: Map<string, HardlinkState>): HardlinkState {
  const cached = hardlinkCache.get(accountDir)
  if (cached) return cached

  const db = new Database(hardlinkPath, { readonly: true, fileMustExist: true })
  const imageRow = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'image_hardlink_info%' ORDER BY name DESC LIMIT 1")
    .get() as { name?: string } | undefined
  const dirRow = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'dir2id%' LIMIT 1")
    .get() as { name?: string } | undefined
  const state: HardlinkState = {
    db,
    imageTable: imageRow?.name as string | undefined,
    dirTable: dirRow?.name as string | undefined
  }
  hardlinkCache.set(accountDir, state)
  return state
}

function resolveHardlinkPath(
  accountDir: string,
  md5: string,
  sessionId: string | undefined,
  context: MediaDatResolverContext
): string | null {
  try {
    const cachePath = String(context.getConfigValue('cachePath') || '').trim()
    const wxid = String(context.getConfigValue('myWxid') || '').trim()
    const cleanedWxid = wxid ? context.cleanAccountDirName(wxid) : ''
    const hardlinkPath = [
      join(accountDir, 'hardlink.db'),
      join(accountDir, 'db_storage', 'hardlink', 'hardlink.db'),
      cachePath ? join(cachePath, 'sqlite', 'hardlink', 'hardlink.db') : '',
      cachePath && cleanedWxid ? join(cachePath, cleanedWxid, 'hardlink.db') : ''
    ].find((candidate) => candidate && existsSync(candidate))
    if (!hardlinkPath || !existsSync(hardlinkPath)) return null

    const state = getHardlinkState(accountDir, hardlinkPath, context.hardlinkCache)
    if (!state.imageTable) return null

    const row = state.db
      .prepare(`SELECT dir1, dir2, file_name FROM ${state.imageTable} WHERE md5 = ? LIMIT 1`)
      .get(md5) as { dir1?: string; dir2?: string; file_name?: string } | undefined

    if (!row) return null
    const dir1 = row.dir1 as string | undefined
    const dir2 = row.dir2 as string | undefined
    const fileName = row.file_name as string | undefined
    if (!dir1 || !dir2 || !fileName) return null
    const lowerFileName = fileName.toLowerCase()
    if (lowerFileName.endsWith('.dat')) {
      const baseLower = lowerFileName.slice(0, -4)
      if (!hasXVariant(baseLower)) return null
    }

    let dirName = dir2
    if (state.dirTable && sessionId) {
      try {
        const dirRow = state.db
          .prepare(`SELECT dir_name FROM ${state.dirTable} WHERE dir_id = ? AND username = ? LIMIT 1`)
          .get(dir2, sessionId) as { dir_name?: string } | undefined
        if (dirRow?.dir_name) dirName = dirRow.dir_name as string
      } catch {
        return null
      }
    }

    const fullPath = join(accountDir, dir1, dirName, fileName)
    if (existsSync(fullPath)) return fullPath

    const withDat = `${fullPath}.dat`
    if (existsSync(withDat)) return withDat
  } catch {
    return null
  }
  return null
}

export async function findDatFile(
  accountDir: string,
  baseName: string,
  sessionId: string | undefined,
  context: MediaDatResolverContext
): Promise<string | null> {
  const normalized = normalizeDatBase(baseName)
  if (looksLikeMd5(normalized)) {
    const hardlinkPath = resolveHardlinkPath(accountDir, normalized, sessionId, context)
    if (hardlinkPath) return hardlinkPath
  }

  const searchPaths = [
    join(accountDir, 'FileStorage', 'Image'),
    join(accountDir, 'FileStorage', 'Image2'),
    join(accountDir, 'FileStorage', 'MsgImg'),
    join(accountDir, 'FileStorage', 'Video')
  ]

  for (const searchPath of searchPaths) {
    if (!existsSync(searchPath)) continue
    const found = recursiveSearch(searchPath, baseName.toLowerCase(), 3)
    if (found) return found
  }
  return null
}

export function getDatVersion(data: Buffer): number {
  if (data.length < 6) return 0
  const sigV1 = Buffer.from([0x07, 0x08, 0x56, 0x31, 0x08, 0x07])
  const sigV2 = Buffer.from([0x07, 0x08, 0x56, 0x32, 0x08, 0x07])
  if (data.subarray(0, 6).equals(sigV1)) return 1
  if (data.subarray(0, 6).equals(sigV2)) return 2
  return 0
}

export function decryptDatV3(data: Buffer, xorKey: number): Buffer {
  const result = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ xorKey
  }
  return result
}

function strictRemovePadding(data: Buffer): Buffer {
  if (!data.length) {
    throw new Error('解密结果为空，填充非法')
  }
  const paddingLength = data[data.length - 1]
  if (paddingLength === 0 || paddingLength > 16 || paddingLength > data.length) {
    throw new Error('PKCS7 填充长度非法')
  }
  for (let i = data.length - paddingLength; i < data.length; i++) {
    if (data[i] !== paddingLength) {
      throw new Error('PKCS7 填充内容非法')
    }
  }
  return data.subarray(0, data.length - paddingLength)
}

function bytesToInt32(bytes: Buffer): number {
  if (bytes.length !== 4) {
    throw new Error('需要4个字节')
  }
  return bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)
}

function hasImageVariantSuffix(baseLower: string): boolean {
  const suffixes = ['.b', '.h', '.t', '.c', '.w', '.l', '_b', '_h', '_t', '_c', '_w', '_l']
  return suffixes.some((suffix) => baseLower.endsWith(suffix))
}

export function asciiKey16(keyString: string): Buffer {
  if (keyString.length < 16) {
    throw new Error('AES密钥至少需要16个字符')
  }
  return Buffer.from(keyString, 'ascii').subarray(0, 16)
}

export function parseXorKey(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const cleanHex = String(value ?? '').toLowerCase().replace(/^0x/, '')
  if (!cleanHex) {
    throw new Error('十六进制字符串不能为空')
  }
  const hex = cleanHex.length >= 2 ? cleanHex.substring(0, 2) : cleanHex
  const parsed = parseInt(hex, 16)
  if (Number.isNaN(parsed)) {
    throw new Error('十六进制字符串不能为空')
  }
  return parsed
}

export function decryptDatV4(data: Buffer, xorKey: number, aesKey: Buffer): Buffer {
  if (data.length < 0x0f) {
    throw new Error('文件太小，无法解析')
  }

  const header = data.subarray(0, 0x0f)
  const payload = data.subarray(0x0f)
  const aesSize = bytesToInt32(header.subarray(6, 10))
  const xorSize = bytesToInt32(header.subarray(10, 14))

  const remainder = ((aesSize % 16) + 16) % 16
  const alignedAesSize = aesSize + (16 - remainder)
  if (alignedAesSize > payload.length) {
    throw new Error('文件格式异常：AES 数据长度超过文件实际长度')
  }

  const aesData = payload.subarray(0, alignedAesSize)
  let unpadded: Buffer = Buffer.alloc(0)
  if (aesData.length > 0) {
    const decipher = crypto.createDecipheriv('aes-128-ecb', aesKey, Buffer.alloc(0))
    decipher.setAutoPadding(false)
    const decrypted = Buffer.concat([decipher.update(aesData), decipher.final()])
    unpadded = strictRemovePadding(decrypted) as Buffer
  }

  const remaining = payload.subarray(alignedAesSize)
  if (xorSize < 0 || xorSize > remaining.length) {
    throw new Error('文件格式异常：XOR 数据长度不合法')
  }

  let rawData: Buffer = Buffer.alloc(0)
  let xoredData: Buffer = Buffer.alloc(0)
  if (xorSize > 0) {
    const rawLength = remaining.length - xorSize
    if (rawLength < 0) {
      throw new Error('文件格式异常：原始数据长度小于XOR长度')
    }
    rawData = remaining.subarray(0, rawLength) as Buffer
    const xorData = remaining.subarray(rawLength)
    xoredData = Buffer.alloc(xorData.length)
    for (let i = 0; i < xorData.length; i++) {
      xoredData[i] = xorData[i] ^ xorKey
    }
  } else {
    rawData = remaining as Buffer
  }

  return Buffer.concat([unpadded, rawData, xoredData])
}
