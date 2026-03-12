import type { MouseEvent, ReactNode } from 'react'
import type { Message } from '../../types/models'
import { shell } from '../../services/ipc'
import { renderTextWithInlineEmoji } from '../../utils/renderInlineEmoji'
import { AvatarImage } from '../AvatarImage'
import { QuotedEmoji } from './AppMessageBubble'
import { toSafePreviewMediaUrl } from '../../utils/mediaUrl'

const cleanMessageContent = (content: string): string => {
  if (!content) return ''
  return content.replace(/^[a-zA-Z0-9]+@openim:\n?/, '')
}

const renderTextWithEmoji = renderTextWithInlineEmoji

function parseAppMsgDocument(rawXml: string): Document | null {
  try {
    const start = rawXml.indexOf('<msg>')
    const xml = start >= 0 ? rawXml.slice(start) : rawXml
    return new DOMParser().parseFromString(xml, 'text/xml')
  } catch {
    return null
  }
}

export function renderAppMessageRichPreview(message: Message): ReactNode {
  const rawXml = message.rawContent || ''
  if (!rawXml || (!rawXml.includes('<appmsg') && !rawXml.includes('&lt;appmsg'))) return null

  let doc: Document | null = null
  const getDoc = () => {
    if (doc) return doc
    doc = parseAppMsgDocument(rawXml)
    return doc
  }
  const q = (selector: string) => getDoc()?.querySelector(selector)?.textContent?.trim() || ''

  const xmlType = message.xmlType || q('appmsg > type') || q('type')

  if (xmlType === '57') {
    const replyText = q('title') || cleanMessageContent(message.parsedContent) || ''
    const referContent = q('refermsg > content') || ''
    const referSender = q('refermsg > displayname') || ''
    const referType = q('refermsg > type') || ''

    const renderReferContent = () => {
      if (referType === '47') {
        try {
          const innerDoc = new DOMParser().parseFromString(referContent, 'text/xml')
          const cdnUrl = innerDoc.querySelector('emoji')?.getAttribute('cdnurl') || ''
          const md5 = innerDoc.querySelector('emoji')?.getAttribute('md5') || ''
          if (cdnUrl) return <QuotedEmoji cdnUrl={cdnUrl} md5={md5} />
        } catch {
          return <span className="quoted-type-label">[动画表情]</span>
        }
        return <span className="quoted-type-label">[动画表情]</span>
      }

      const typeLabels: Record<string, string> = {
        '3': '图片',
        '34': '语音',
        '43': '视频',
        '49': '链接',
        '50': '通话',
        '10000': '系统消息',
        '10002': '撤回消息'
      }
      if (referType && typeLabels[referType]) {
        return <span className="quoted-type-label">[{typeLabels[referType]}]</span>
      }

      return <>{renderTextWithEmoji(cleanMessageContent(referContent))}</>
    }

    return (
      <div className="bubble-content">
        <div className="quoted-message">
          {referSender && <span className="quoted-sender">{referSender}</span>}
          <span className="quoted-text">{renderReferContent()}</span>
        </div>
        <div className="message-text">{renderTextWithEmoji(cleanMessageContent(replyText))}</div>
      </div>
    )
  }

  const title = message.linkTitle || q('title') || cleanMessageContent(message.parsedContent) || 'Card'
  const desc = message.appMsgDesc || q('des')
  const url = message.linkUrl || q('url')
  const thumbUrl = message.linkThumb || message.appMsgThumbUrl || q('thumburl') || q('cdnthumburl') || q('cover') || q('coverurl')
  const safeThumbUrl = toSafePreviewMediaUrl(thumbUrl)
  const musicUrl = message.appMsgMusicUrl || message.appMsgDataUrl || q('musicurl') || q('playurl') || q('dataurl') || q('lowurl')
  const sourceName = message.appMsgSourceName || q('sourcename')
  const sourceDisplayName = q('sourcedisplayname') || ''
  const appName = message.appMsgAppName || q('appname')
  const sourceUsername = message.appMsgSourceUsername || q('sourceusername')
  const finderName =
    message.finderNickname ||
    message.finderUsername ||
    q('findernickname') ||
    q('finder_nickname') ||
    q('finderusername') ||
    q('finder_username')

  const lower = rawXml.toLowerCase()
  const kind = message.appMsgKind || (
    (xmlType === '2001' || lower.includes('hongbao')) ? 'red-packet'
      : (xmlType === '115' ? 'gift'
        : ((xmlType === '33' || xmlType === '36') ? 'miniapp'
          : (((xmlType === '5' || xmlType === '49') && (sourceUsername.startsWith('gh_') || !!sourceName || appName.includes('公众号'))) ? 'official-link'
            : (xmlType === '51' ? 'finder'
              : (xmlType === '3' ? 'music'
                : ((xmlType === '5' || xmlType === '49') ? 'link'
                  : (!!musicUrl ? 'music' : '')))))))
  )

  if (!kind) return null

  let displayTitle = title
  if (kind === 'finder' && (!displayTitle || displayTitle.includes('不支持'))) {
    try {
      const nextDoc = new DOMParser().parseFromString(rawXml, 'text/xml')
      displayTitle = nextDoc.querySelector('finderFeed desc')?.textContent?.trim() || desc || ''
    } catch {
      displayTitle = desc || ''
    }
  }

  const openExternal = (event: MouseEvent, nextUrl?: string) => {
    if (!nextUrl) return
    event.stopPropagation()
    void shell.openExternal(nextUrl)
  }

  const metaLabel =
    kind === 'red-packet' ? '红包'
      : kind === 'finder' ? (finderName || '视频号')
        : kind === 'location' ? '位置'
          : kind === 'music' ? (sourceName || appName || '音乐')
            : (sourceName || appName || (sourceUsername.startsWith('gh_') ? '公众号' : ''))

  const renderCard = (cardKind: string, clickableUrl?: string) => (
    <div
      className={`link-message appmsg-rich-card ${cardKind}`}
      onClick={clickableUrl ? (event) => openExternal(event, clickableUrl) : undefined}
      title={clickableUrl}
    >
      <div className="link-header">
        <div className="link-title" title={title}>{title}</div>
        {metaLabel ? <div className="appmsg-meta-badge">{metaLabel}</div> : null}
      </div>
      <div className="link-body">
        <div className="link-desc-block">
          {desc ? <div className="link-desc" title={desc}>{desc}</div> : null}
        </div>
        {safeThumbUrl ? (
          <img
            src={safeThumbUrl}
            alt=""
            className={`link-thumb${((cardKind === 'miniapp') || /\.svg(?:$|\?)/i.test(safeThumbUrl)) ? ' theme-adaptive' : ''}`}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className={`link-thumb-placeholder ${cardKind}`}>{cardKind.slice(0, 2).toUpperCase()}</div>
        )}
      </div>
    </div>
  )

  if (kind === 'quote') {
    const replyText = message.linkTitle || q('title') || cleanMessageContent(message.parsedContent) || ''
    const referContent = message.quotedContent || q('refermsg > content') || ''
    const referSender = message.quotedSender || q('refermsg > displayname') || ''
    return (
      <div className="bubble-content">
        <div className="quoted-message">
          {referSender && <span className="quoted-sender">{referSender}</span>}
          <span className="quoted-text">{renderTextWithEmoji(cleanMessageContent(referContent))}</span>
        </div>
        <div className="message-text">{renderTextWithEmoji(cleanMessageContent(replyText))}</div>
      </div>
    )
  }

  if (kind === 'red-packet') {
    const greeting = (() => {
      try {
        const nextDoc = getDoc()
        if (!nextDoc) return ''
        return nextDoc.querySelector('receivertitle')?.textContent?.trim() ||
          nextDoc.querySelector('sendertitle')?.textContent?.trim() || ''
      } catch {
        return ''
      }
    })()

    return (
      <div className="hongbao-message">
        <div className="hongbao-icon">
          <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
            <rect x="4" y="6" width="32" height="28" rx="4" fill="white" fillOpacity="0.3" />
            <rect x="4" y="6" width="32" height="14" rx="4" fill="white" fillOpacity="0.2" />
            <circle cx="20" cy="20" r="6" fill="white" fillOpacity="0.4" />
            <text x="20" y="24" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">¥</text>
          </svg>
        </div>
        <div className="hongbao-info">
          <div className="hongbao-greeting">{greeting || '恭喜发财，大吉大利'}</div>
          <div className="hongbao-label">微信红包</div>
        </div>
      </div>
    )
  }

  if (kind === 'gift') {
    const giftImg = toSafePreviewMediaUrl(message.giftImageUrl || thumbUrl)
    const giftWish = message.giftWish || title || '送你一份心意'
    const giftPriceRaw = message.giftPrice
    const giftPriceYuan = giftPriceRaw ? (parseInt(giftPriceRaw, 10) / 100).toFixed(2) : ''
    return (
      <div className="gift-message">
        {giftImg && <img className="gift-img" src={giftImg} alt="" referrerPolicy="no-referrer" />}
        <div className="gift-info">
          <div className="gift-wish">{giftWish}</div>
          {giftPriceYuan && <div className="gift-price">¥{giftPriceYuan}</div>}
          <div className="gift-label">微信礼物</div>
        </div>
      </div>
    )
  }

  if (kind === 'finder') {
    const coverUrl = toSafePreviewMediaUrl(message.finderCoverUrl || thumbUrl)
    const duration = message.finderDuration
    const authorName = finderName || ''
    const authorAvatar = toSafePreviewMediaUrl(message.finderAvatar)
    const formattedDuration = duration ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : ''
    return (
      <div className="channel-video-card" onClick={url ? (event) => openExternal(event, url) : undefined}>
        <div className="channel-video-cover">
          {coverUrl ? (
            <img src={coverUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <div className="channel-video-cover-placeholder">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
          )}
          {formattedDuration && <span className="channel-video-duration">{formattedDuration}</span>}
        </div>
        <div className="channel-video-info">
          <div className="channel-video-title">{displayTitle || '视频号视频'}</div>
          <div className="channel-video-author">
            {authorAvatar && <AvatarImage className="channel-video-avatar" src={authorAvatar} name={authorName || '视频号'} alt="" loading="eager" referrerPolicy="no-referrer" />}
            <span>{authorName || '视频号'}</span>
          </div>
        </div>
      </div>
    )
  }

  if (kind === 'music') {
    const albumUrl = toSafePreviewMediaUrl(message.musicAlbumUrl || thumbUrl)
    const playUrl = message.musicUrl || musicUrl || url
    const songTitle = title || '未知歌曲'
    const artist = desc || ''
    const appLabel = sourceName || appName || ''
    return (
      <div className="music-message" onClick={playUrl ? (event) => openExternal(event, playUrl) : undefined}>
        <div className="music-cover">
          {albumUrl ? (
            <img src={albumUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </div>
        <div className="music-info">
          <div className="music-title">{songTitle}</div>
          {artist && <div className="music-artist">{artist}</div>}
          {appLabel && <div className="music-source">{appLabel}</div>}
        </div>
      </div>
    )
  }

  if (kind === 'official-link') {
    const authorAvatar = toSafePreviewMediaUrl(q('publisher > headimg') || q('brand_info > headimgurl') || q('appmsg > avatar') || q('headimgurl') || message.cardAvatarUrl)
    const authorName = sourceDisplayName || q('publisher > nickname') || sourceName || appName || '公众号'
    const coverPic = toSafePreviewMediaUrl(q('mmreader > category > item > cover') || thumbUrl)
    const digest = q('mmreader > category > item > digest') || desc
    const articleTitle = q('mmreader > category > item > title') || title

    return (
      <div className="official-message" onClick={url ? (event) => openExternal(event, url) : undefined}>
        <div className="official-header">
          {authorAvatar ? (
            <AvatarImage src={authorAvatar} name={authorName} alt="" className="official-avatar" loading="eager" referrerPolicy="no-referrer" />
          ) : (
            <div className="official-avatar-placeholder">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          )}
          <span className="official-name">{authorName}</span>
        </div>
        <div className="official-body">
          {coverPic ? (
            <div className="official-cover-wrapper">
              <img src={coverPic} alt="" className="official-cover" referrerPolicy="no-referrer" />
              <div className="official-title-overlay">{articleTitle}</div>
            </div>
          ) : (
            <div className="official-title-text">{articleTitle}</div>
          )}
          {digest && <div className="official-digest">{digest}</div>}
        </div>
      </div>
    )
  }

  if (kind === 'link') return renderCard('link', url || undefined)
  if (kind === 'card') return renderCard('card', url || undefined)
  if (kind === 'miniapp') {
    return (
      <div className="miniapp-message miniapp-message-rich">
        <div className="miniapp-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
        </div>
        <div className="miniapp-info">
          <div className="miniapp-title">{title}</div>
          <div className="miniapp-label">{metaLabel || '小程序'}</div>
        </div>
        {safeThumbUrl ? (
          <img
            src={safeThumbUrl}
            alt=""
            className={`miniapp-thumb${/\.svg(?:$|\?)/i.test(safeThumbUrl) ? ' theme-adaptive' : ''}`}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </div>
    )
  }

  return null
}
