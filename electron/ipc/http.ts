import { ipcMain } from 'electron'
import { registerHttpIpcHandlersOn, type HttpIpcContext } from './httpHandlers.ts'

export function registerHttpIpcHandlers(context: HttpIpcContext): void {
  registerHttpIpcHandlersOn(ipcMain, context)
}
