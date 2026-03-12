import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = process.cwd()
const codeRoots = ['electron', 'src', 'shared']
const failures = []
const directConfigIpcPattern = /\bconfig\.(get|set)\(/
const forbiddenConfigClearPattern = /\bconfig\.clear\(/

const generalRules = [
  {
    id: 'no-websecurity-false',
    description: '禁止关闭 Electron webSecurity',
    regex: /webSecurity\s*:\s*false/
  },
  {
    id: 'no-insecure-tls-bypass',
    description: '禁止关闭 TLS 校验',
    regex: /rejectUnauthorized\s*:\s*false/
  },
  {
    id: 'no-raw-html-render',
    description: '禁止使用 dangerouslySetInnerHTML 渲染不可信内容',
    regex: /dangerouslySetInnerHTML/
  },
  {
    id: 'no-certificate-error-bypass',
    description: '禁止放行证书错误',
    regex: /certificate-error/
  }
]

const exposureRules = [
  {
    id: 'no-config-clear-exposure',
    description: '禁止向渲染层暴露全量配置清空能力',
    regex: /config:clear/
  },
  {
    id: 'no-raw-sql-exposure',
    description: '禁止向渲染层暴露原始 SQL 执行能力',
    regex: /\bexecQuery\s*:/
  },
  {
    id: 'no-message-update-exposure',
    description: '禁止向渲染层暴露消息修改能力',
    regex: /\bupdateMessage\s*:/
  },
  {
    id: 'no-message-delete-exposure',
    description: '禁止向渲染层暴露消息删除能力',
    regex: /\bdeleteMessage\s*:/
  },
  {
    id: 'no-sns-trigger-install-exposure',
    description: '禁止向渲染层暴露 SNS 防删触发器安装能力',
    regex: /\binstallBlockDeleteTrigger\s*:/
  },
  {
    id: 'no-sns-trigger-uninstall-exposure',
    description: '禁止向渲染层暴露 SNS 防删触发器卸载能力',
    regex: /\buninstallBlockDeleteTrigger\s*:/
  },
  {
    id: 'no-sns-trigger-check-exposure',
    description: '禁止向渲染层暴露 SNS 防删触发器探测能力',
    regex: /\bcheckBlockDeleteTrigger\s*:/
  },
  {
    id: 'no-sns-delete-exposure',
    description: '禁止向渲染层暴露 SNS 删除能力',
    regex: /\bdeleteSnsPost\s*:/
  }
]

const ipcRules = [
  {
    id: 'no-config-clear-ipc',
    description: '禁止注册全量配置清空 IPC',
    regex: /config:clear/
  },
  {
    id: 'no-raw-sql-ipc',
    description: '禁止注册原始 SQL IPC',
    regex: /chat:execQuery/
  },
  {
    id: 'no-message-update-ipc',
    description: '禁止注册消息修改 IPC',
    regex: /chat:updateMessage/
  },
  {
    id: 'no-message-delete-ipc',
    description: '禁止注册消息删除 IPC',
    regex: /chat:deleteMessage/
  },
  {
    id: 'no-sns-trigger-install-ipc',
    description: '禁止注册 SNS 防删触发器安装 IPC',
    regex: /sns:installBlockDeleteTrigger/
  },
  {
    id: 'no-sns-trigger-uninstall-ipc',
    description: '禁止注册 SNS 防删触发器卸载 IPC',
    regex: /sns:uninstallBlockDeleteTrigger/
  },
  {
    id: 'no-sns-trigger-check-ipc',
    description: '禁止注册 SNS 防删触发器探测 IPC',
    regex: /sns:checkBlockDeleteTrigger/
  },
  {
    id: 'no-sns-delete-ipc',
    description: '禁止注册 SNS 删除 IPC',
    regex: /sns:deleteSnsPost/
  }
]

function walk(dirPath) {
  const entries = readdirSync(dirPath)
  const files = []
  for (const entry of entries) {
    const fullPath = join(dirPath, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      files.push(...walk(fullPath))
      continue
    }
    if (/\.(ts|tsx|js|jsx|d\.ts)$/.test(entry)) {
      files.push(fullPath)
    }
  }
  return files
}

function pushMatches(filePath, content, rules) {
  const lines = content.split(/\r?\n/)
  for (const rule of rules) {
    for (let index = 0; index < lines.length; index += 1) {
      if (rule.regex.test(lines[index])) {
        failures.push({
          file: relative(root, filePath),
          line: index + 1,
          id: rule.id,
          description: rule.description,
          snippet: lines[index].trim()
        })
      }
    }
  }
}

for (const codeRoot of codeRoots) {
  const absoluteRoot = resolve(root, codeRoot)
  for (const filePath of walk(absoluteRoot)) {
    const content = readFileSync(filePath, 'utf8')
    pushMatches(filePath, content, generalRules)
  }
}

for (const filePath of [
  resolve(root, 'electron/preload.ts'),
  resolve(root, 'src/types/electron.d.ts')
]) {
  const content = readFileSync(filePath, 'utf8')
  pushMatches(filePath, content, exposureRules)
}

for (const filePath of walk(resolve(root, 'electron/ipc'))) {
  const content = readFileSync(filePath, 'utf8')
  pushMatches(filePath, content, ipcRules)
}

for (const filePath of walk(resolve(root, 'src'))) {
  const relativePath = relative(root, filePath)
  if (relativePath === 'src/services/config.ts') continue
  const content = readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (forbiddenConfigClearPattern.test(lines[index])) {
      failures.push({
        file: relativePath,
        line: index + 1,
        id: 'no-config-clear-call',
        description: '禁止在渲染层保留 config.clear 调用能力',
        snippet: lines[index].trim()
      })
      continue
    }
    if (!directConfigIpcPattern.test(lines[index])) continue
    failures.push({
      file: relativePath,
      line: index + 1,
      id: 'no-direct-config-ipc',
      description: '禁止在页面或组件中直接调用底层 config IPC，请统一走 src/services/config.ts',
      snippet: lines[index].trim()
    })
  }
}

if (failures.length > 0) {
  console.error('[security-lint] 检测到不允许的高风险模式:')
  for (const failure of failures) {
    console.error(`- ${failure.id} ${failure.file}:${failure.line} :: ${failure.description}`)
    console.error(`  ${failure.snippet}`)
  }
  process.exit(1)
}

console.log('[security-lint] ok')
