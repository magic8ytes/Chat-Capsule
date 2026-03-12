export function cleanAccountDirName(dirName: string): string {
  let name = dirName.trim().replace(/^"+|"+$/g, '').replace(/[\\/]+$/g, '')
  if (name.endsWith('.db')) {
    name = name.slice(0, -3)
  }
  return name
}

export function isValidAvatarUrl(avatarUrl?: string): avatarUrl is string {
  if (!avatarUrl) return false
  const value = String(avatarUrl).trim()
  if (!value) return false
  if (value === 'NULL' || value === 'null' || value === 'undefined') return false
  return true
}

export function createWavBuffer(pcmData: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const pcmLength = pcmData.length
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcmLength, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcmLength, 40)
  return Buffer.concat([header, pcmData])
}


export interface StableMessageIdentity {
  serverId: number
  localId: number
  createTime: number
  sortSeq: number
}

export function buildMessageStableKey(message: StableMessageIdentity): string {
  return `${message.serverId}-${message.localId}-${message.createTime}-${message.sortSeq}`
}

export function dedupeMessagesByStableKey<T extends StableMessageIdentity>(messages: T[]): T[] {
  const seen = new Set<string>()
  return messages.filter((message) => {
    const key = buildMessageStableKey(message)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function normalizeUnixSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return value > 10000000000 ? Math.floor(value / 1000) : value
}

export function normalizeYmdDateFilters(dates?: string[]): string[] {
  return Array.from(new Set((dates || [])
    .map((date) => String(date || '').trim())
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))))
}
