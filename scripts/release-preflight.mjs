import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const packageJsonPath = resolve(root, 'package.json')
const workflowPath = resolve(root, '.github/workflows/release.yml')
const builderConfigPath = resolve(root, 'electron-builder.config.mjs')

function fail(message) {
  console.error(`[release-preflight] ${message}`)
  process.exit(1)
}

if (!existsSync(packageJsonPath)) fail('缺少 package.json')
if (!existsSync(workflowPath)) fail('缺少 .github/workflows/release.yml')
if (!existsSync(builderConfigPath)) fail('缺少 electron-builder.config.mjs')

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const workflow = readFileSync(workflowPath, 'utf8')
const builderConfig = readFileSync(builderConfigPath, 'utf8')
const scripts = packageJson.scripts || {}

if (!scripts['pack:mac']) fail('缺少 pack:mac 脚本')
if (!scripts['lint']) fail('缺少 lint 脚本')
if (!scripts['validate:ci']) fail('缺少 validate:ci 脚本')
if (!scripts['validate:release']) fail('缺少 validate:release 脚本')
if (!String(packageJson.license || '').trim()) fail('缺少 license 字段')
if (!String(packageJson.homepage || '').includes('github.com/')) fail('homepage 未指向 GitHub 仓库')
if (!String(scripts['pack:mac']).includes('electron-builder.config.mjs')) fail('pack:mac 未使用 electron-builder.config.mjs')
if (!/target:\s*\[\s*'dmg'\s*,\s*'zip'\s*\]/.test(builderConfig) && !/target:\s*\[\s*'zip'\s*,\s*'dmg'\s*\]/.test(builderConfig)) fail('mac 构建目标未同时包含 dmg 和 zip')
if (!/runs-on:\s*macos-latest/.test(workflow)) fail('release workflow 未切换到 macos-latest')
if (!String(scripts['validate:ci']).includes('npm run lint')) fail('validate:ci 未包含 lint')
if (!/npm run validate:ci/.test(workflow)) fail('release workflow 未执行 validate:ci')
if (!/electron-builder --config electron-builder\.config\.mjs --mac dmg zip --publish always/.test(workflow)) fail('release workflow 未使用 dmg + zip 独立 builder 配置发布')

console.log('[release-preflight] ok')
