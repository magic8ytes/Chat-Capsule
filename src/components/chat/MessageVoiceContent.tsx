import type { MouseEvent } from 'react'
import { Pause, Play } from 'lucide-react'

interface MessageVoiceContentProps {
  isVoicePlaying: boolean
  voiceLoading: boolean
  voiceError: boolean
  voiceDataUrl?: string
  voiceWaveform: number[]
  voiceCurrentTime: number
  voiceDuration: number
  durationText: string
  isSent?: boolean
  onToggle: () => void | Promise<void>
  onSeek: (event: MouseEvent<HTMLDivElement>) => void
}

export default function MessageVoiceContent({
  isVoicePlaying,
  voiceLoading,
  voiceError,
  voiceDataUrl,
  voiceWaveform,
  voiceCurrentTime,
  voiceDuration,
  durationText,
  onToggle,
  onSeek
}: MessageVoiceContentProps) {
  const showDecryptHint = !voiceDataUrl && !voiceLoading && !isVoicePlaying

  return (
    <div className="voice-stack">
      <div className={`voice-message ${isVoicePlaying ? 'playing' : ''}`} onClick={() => { void onToggle() }}>
        <button
          className="voice-play-btn"
          onClick={(event) => {
            event.stopPropagation()
            void onToggle()
          }}
          aria-label="播放语音"
          type="button"
        >
          {isVoicePlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <div className="voice-wave" onClick={onSeek}>
          {voiceDataUrl && voiceWaveform.length > 0 ? (
            <div className="voice-waveform">
              {voiceWaveform.map((amplitude, index) => {
                const progress = voiceCurrentTime / (voiceDuration || 1)
                const isPlayed = (index / voiceWaveform.length) < progress
                return (
                  <div
                    key={index}
                    className={`waveform-bar ${isPlayed ? 'played' : ''}`}
                    style={{ height: `${Math.max(20, amplitude * 100)}%` }}
                  />
                )
              })}
            </div>
          ) : (
            <div className="voice-wave-placeholder">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
        <div className="voice-info">
          <span className="voice-label">语音</span>
          {durationText && <span className="voice-duration">{durationText}</span>}
          {voiceLoading && <span className="voice-loading">解码中...</span>}
          {showDecryptHint && <span className="voice-hint">点击解密</span>}
          {voiceError && <span className="voice-error">播放失败</span>}
        </div>
      </div>
    </div>
  )
}
