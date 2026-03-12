import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))

function parseGitHubRepository(input) {
  const normalized = String(input || '').trim()
  if (!normalized) return null

  const match = normalized.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i)
  if (!match) return null

  return {
    owner: match[1],
    repo: match[2]
  }
}

const repositoryFromEnv = parseGitHubRepository(process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}` : '')
const repositoryField = typeof packageJson.repository === 'string'
  ? packageJson.repository
  : packageJson.repository?.url
const repositoryFromPackage = parseGitHubRepository(repositoryField)
const publishTarget = repositoryFromEnv || repositoryFromPackage

const config = {
  appId: 'io.github.magic8ytes.chatcapsule',
  productName: 'Chat Capsule',
  artifactName: 'Chat-Capsule-${version}-${os}-${arch}.${ext}',
  directories: {
    output: 'release'
  },
  extraResources: [
    {
      from: 'public/icon.ico',
      to: 'icon.ico'
    },
    {
      from: 'electron/assets/wasm/',
      to: 'assets/wasm/'
    }
  ],
  files: [
    'dist/**/*',
    'dist-electron/**/*'
  ],
  asarUnpack: [
    'node_modules/silk-wasm/**/*',
    'node_modules/sherpa-onnx-node/**/*',
    'node_modules/ffmpeg-static/**/*'
  ],
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.utilities',
    icon: 'public/logo.png'
  },
  dmg: {
    writeUpdateInfo: true
  }
}

if (publishTarget) {
  config.publish = {
    provider: 'github',
    owner: publishTarget.owner,
    repo: publishTarget.repo,
    releaseType: 'release'
  }
}

export default config
