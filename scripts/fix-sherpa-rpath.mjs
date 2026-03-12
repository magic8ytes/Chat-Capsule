import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

function log(message) {
  process.stdout.write(`${message}\n`)
}

if (process.platform !== 'darwin') {
  log('[fix-sherpa-rpath] skipped (not macOS)')
  process.exit(0)
}

const modulePath = path.resolve('node_modules/sherpa-onnx-darwin-arm64/sherpa-onnx.node')
if (!existsSync(modulePath)) {
  log(`[fix-sherpa-rpath] not found: ${modulePath}`)
  process.exit(0)
}

function hasLoaderPathRpath() {
  try {
    const output = execFileSync('otool', ['-l', modulePath], { encoding: 'utf8' })
    return output.includes('LC_RPATH') && output.includes('@loader_path')
  } catch (error) {
    log(`[fix-sherpa-rpath] otool failed: ${String(error)}`)
    return false
  }
}

if (hasLoaderPathRpath()) {
  log('[fix-sherpa-rpath] @loader_path already present, skipping')
  process.exit(0)
}

try {
  execFileSync('install_name_tool', ['-add_rpath', '@loader_path', modulePath])
  log('[fix-sherpa-rpath] added @loader_path rpath')
} catch (error) {
  log(`[fix-sherpa-rpath] install_name_tool failed: ${String(error)}`)
  process.exit(1)
}
