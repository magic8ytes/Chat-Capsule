import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

const electronEntries = [
  {
    entry: 'electron/main.ts',
    vite: {
      build: {
        outDir: 'dist-electron',
        rollupOptions: {
          external: [
            'better-sqlite3',
            'fsevents',
            'whisper-node',
            'shelljs',
            'exceljs',
            'node-llama-cpp'
          ]
        }
      }
    }
  },
  {
    entry: 'electron/imageSearchWorker.ts',
    vite: {
      build: {
        outDir: 'dist-electron',
        rollupOptions: {
          output: {
            entryFileNames: 'imageSearchWorker.js',
            inlineDynamicImports: true
          }
        }
      }
    }
  },
  {
    entry: 'electron/transcribeWorker.ts',
    vite: {
      build: {
        outDir: 'dist-electron',
        rollupOptions: {
          external: [
            'sherpa-onnx-node'
          ],
          output: {
            entryFileNames: 'transcribeWorker.js',
            inlineDynamicImports: true
          }
        }
      }
    }
  },
  {
    entry: 'electron/preload.ts',
    onstart(options: { reload: () => void }) {
      options.reload()
    },
    vite: {
      build: {
        outDir: 'dist-electron'
      }
    }
  }
]

function rendererManualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined

  if (id.includes('echarts-for-react')) return 'vendor-echarts-react'
  if (id.includes('/node_modules/zrender/') || id.includes('/node_modules/echarts/')) return 'vendor-echarts'

  if (id.includes('react-virtuoso')) return 'vendor-virtuoso'
  if (id.includes('html2canvas')) return 'vendor-html2canvas'
  if (id.includes('react-markdown') || id.includes('remark-gfm')) return 'vendor-markdown'
  return undefined
}

export default defineConfig(({ mode }) => {
  const isRendererOnlyBuild = mode === 'web'

  return {
    base: './',
    server: {
      port: 3000,
      strictPort: false
    },
    build: {
      commonjsOptions: {
        ignoreDynamicRequires: true
      },
      rollupOptions: {
        output: {
          manualChunks: rendererManualChunks
        }
      }
    },
    optimizeDeps: {
      exclude: []
    },
    plugins: isRendererOnlyBuild
      ? [react()]
      : [react(), electron(electronEntries), renderer()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    }
  }
})
