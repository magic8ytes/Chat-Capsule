import { useEffect, useMemo, useState } from 'react'
import { toSafeMediaUrl } from '../utils/mediaUrl'

interface AvatarImageProps {
  src?: string | null
  name?: string | null
  alt?: string
  loading?: 'eager' | 'lazy'
  referrerPolicy?: React.ImgHTMLAttributes<HTMLImageElement>['referrerPolicy']
  className?: string
}

function getAvatarLetter(name?: string | null): string {
  const normalized = String(name || '').trim()
  if (!normalized) return '?'
  return [...normalized][0] || '?'
}

export function AvatarImage({
  src,
  name,
  alt = '',
  loading = 'lazy',
  referrerPolicy = 'no-referrer',
  className
}: AvatarImageProps) {
  const normalizedSrc = useMemo(() => toSafeMediaUrl(src), [src])
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [normalizedSrc])

  if (normalizedSrc && !imageFailed) {
    return (
      <img
        src={normalizedSrc}
        alt={alt}
        loading={loading}
        referrerPolicy={referrerPolicy}
        className={className}
        onError={() => setImageFailed(true)}
      />
    )
  }

  return <span className={className}>{getAvatarLetter(name)}</span>
}
