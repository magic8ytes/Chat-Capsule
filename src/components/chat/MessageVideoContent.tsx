import type { RefObject } from 'react'
import { Loader2, Play } from 'lucide-react'

interface VideoInfo {
  videoUrl?: string
  coverUrl?: string
  thumbUrl?: string
  exists: boolean
}

interface MessageVideoContentProps {
  isVideoVisible: boolean
  videoLoading: boolean
  videoClicked: boolean
  videoInfo: VideoInfo | null
  containerRef: RefObject<HTMLElement | null>
  onRetryLoad: () => void
  onPlay: () => void | Promise<void>
}

export default function MessageVideoContent({
  isVideoVisible,
  videoLoading,
  videoClicked,
  videoInfo,
  containerRef,
  onRetryLoad,
  onPlay
}: MessageVideoContentProps) {
  if (!isVideoVisible) {
    return (
      <div className="video-placeholder" ref={containerRef as RefObject<HTMLDivElement>}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="23 7 16 12 23 17 23 7"></polygon>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
        </svg>
      </div>
    )
  }

  if (videoLoading) {
    return (
      <div className="video-loading" ref={containerRef as RefObject<HTMLDivElement>}>
        <Loader2 size={20} className="spin" />
      </div>
    )
  }

  if (!videoInfo?.exists || !videoInfo.videoUrl) {
    return (
      <button
        className={`video-unavailable ${videoClicked ? 'clicked' : ''}`}
        ref={containerRef as RefObject<HTMLButtonElement>}
        onClick={onRetryLoad}
        type="button"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="23 7 16 12 23 17 23 7"></polygon>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
        </svg>
        <span>视频未找到</span>
        <span className="video-action">{videoClicked ? '已点击…' : '点击重试'}</span>
      </button>
    )
  }

  const thumbSrc = videoInfo.thumbUrl || videoInfo.coverUrl
  return (
    <div className="video-thumb-wrapper" ref={containerRef as RefObject<HTMLDivElement>} onClick={() => { void onPlay() }}>
      {thumbSrc ? (
        <img src={thumbSrc} alt="视频缩略图" className="video-thumb" />
      ) : (
        <div className="video-thumb-placeholder">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="23 7 16 12 23 17 23 7"></polygon>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
        </div>
      )}
      <div className="video-play-button">
        <Play size={32} fill="white" />
      </div>
    </div>
  )
}
