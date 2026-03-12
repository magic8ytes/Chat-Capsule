import { join } from 'path'

export interface WindowRuntimePaths {
  preloadPath: string
  rendererIndexPath: string
  splashHtmlPath: string
  bundledIconPath: string
  iconCandidates: string[]
}

export function resolveWindowRuntimePaths(baseDir: string, resourcesPath: string, platform: NodeJS.Platform): WindowRuntimePaths {
  const iconCandidates = platform === 'darwin'
    ? [
        join(baseDir, '../dist/logo.png'),
        join(baseDir, '../public/logo.png'),
        join(baseDir, '../app.png')
      ]
    : [join(baseDir, '../public/icon.ico')]

  return {
    preloadPath: join(baseDir, 'preload.js'),
    rendererIndexPath: join(baseDir, '../dist/index.html'),
    splashHtmlPath: join(baseDir, '../dist/splash.html'),
    bundledIconPath: join(resourcesPath, 'icon.ico'),
    iconCandidates
  }
}
