import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = process.cwd()
const ignoreDirs = new Set([
  '.git',
  '.github',
  '.cache',
  '.claude',
  '.agents',
  'node_modules',
  'dist',
  'dist-electron',
  'release',
  'out',
  'assets',
  'public',
  'electron/assets'
])

const sensitiveJsonPatterns = [
  {
    id: 'enc_key',
    regex: /"enc_key"\s*:\s*"[0-9a-f]{32,}"/i,
    message: 'Detected hex enc_key in JSON'
  },
  {
    id: 'salt',
    regex: /"salt"\s*:\s*"[0-9a-f]{16,}"/i,
    message: 'Detected hex salt in JSON'
  },
  {
    id: 'imageAesKey',
    regex: /"imageAesKey"\s*:\s*"[0-9a-f]{16,}"/i,
    message: 'Detected hex imageAesKey in JSON'
  }
]

const failures = []

function shouldIgnoreDir(dirPath) {
  const name = dirPath.split('/').pop()
  return ignoreDirs.has(name)
}

function walk(dirPath, files) {
  const entries = readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (shouldIgnoreDir(fullPath)) continue
      walk(fullPath, files)
      continue
    }
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.json')) continue
    files.push(fullPath)
  }
}

function readSafe(filePath) {
  const stats = statSync(filePath)
  if (stats.size > 1024 * 1024) return null
  return readFileSync(filePath, 'utf8')
}

const profilePath = resolve(root, 'profile.json')
try {
  const stats = statSync(profilePath)
  if (stats.isFile()) {
    failures.push({
      file: 'profile.json',
      message: 'profile.json exists. Do not commit real profile configs.'
    })
  }
} catch (error) {
  // ignore missing file
}

const jsonFiles = []
walk(root, jsonFiles)

for (const filePath of jsonFiles) {
  const relPath = relative(root, filePath)
  if (relPath === 'profile.example.json') continue
  const content = readSafe(filePath)
  if (!content) continue
  for (const pattern of sensitiveJsonPatterns) {
    if (pattern.regex.test(content)) {
      failures.push({
        file: relPath,
        message: pattern.message
      })
      break
    }
  }
}

if (failures.length > 0) {
  console.error('Secret scan failed:')
  for (const failure of failures) {
    console.error(`- ${failure.file}: ${failure.message}`)
  }
  console.error('Remove sensitive values and retry.')
  process.exit(1)
}

console.log('Secret scan passed.')
