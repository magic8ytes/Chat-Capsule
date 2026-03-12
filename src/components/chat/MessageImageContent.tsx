import type { RefObject } from 'react'
import { Image as ImageIcon, Loader2 } from 'lucide-react'
import { LivePhotoIcon } from '../LivePhotoIcon'

interface MessageImageContentProps {
  imageLoading: boolean
  imageError: boolean
  imageClicked: boolean
  imageLocalPath?: string
  imageIsThumb: boolean
  imageHasUpdate: boolean
  imageLiveVideoPath?: string
  containerRef: RefObject<HTMLDivElement | null>
  onRetryDecrypt: () => void
  onOpenImage: () => void | Promise<void>
  onLoad: () => void
  onError: () => void
}

export default function MessageImageContent({
  imageLoading,
  imageError,
  imageClicked,
  imageLocalPath,
  imageIsThumb,
  imageHasUpdate,
  imageLiveVideoPath,
  containerRef,
  onRetryDecrypt,
  onOpenImage,
  onLoad,
  onError
}: MessageImageContentProps) {
  return (
    <div ref={containerRef}>
      {imageLoading ? (
        <div className="image-loading">
          <Loader2 size={20} className="spin" />
        </div>
      ) : imageError || !imageLocalPath ? (
        <button
          className={`image-unavailable ${imageClicked ? 'clicked' : ''}`}
          onClick={onRetryDecrypt}
          disabled={imageLoading}
          type="button"
        >
          <ImageIcon size={24} />
          <span>图片未解密</span>
          <span className="image-action">{imageClicked ? '已点击…' : '点击解密'}</span>
        </button>
      ) : (
        <div className="image-message-wrapper">
          {imageIsThumb && (
            <div
              className={`media-badge thumb${imageHasUpdate ? ' pending' : ''}`}
              title={imageHasUpdate ? '当前先显示缩略图，后台仍在尝试加载原图/高清图' : '当前仅找到缩略图，未找到对应原图/高清图'}
            >
              缩略图
            </div>
          )}
          <img
            src={imageLocalPath}
            alt="图片"
            className="image-message"
            onClick={() => { void onOpenImage() }}
            onLoad={onLoad}
            onError={onError}
          />
          {imageLiveVideoPath && (
            <div className="media-badge live">
              <LivePhotoIcon size={14} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
