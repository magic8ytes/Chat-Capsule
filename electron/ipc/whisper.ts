import { ipcMain } from 'electron'
import type { VoiceTranscribeService } from '../services/voiceTranscribeService'

interface WhisperIpcContext {
  voiceTranscribeService: VoiceTranscribeService
}

export function registerWhisperIpcHandlers({ voiceTranscribeService }: WhisperIpcContext): void {
  ipcMain.handle('whisper:getModelStatus', async () => {
    return voiceTranscribeService.getModelStatus()
  })

  ipcMain.handle('whisper:downloadModel', async (event) => {
    return voiceTranscribeService.downloadModel((progress) => {
      event.sender.send('whisper:downloadProgress', progress)
    })
  })
}
