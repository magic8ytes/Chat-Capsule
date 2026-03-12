import { memo, useEffect, useRef, useState } from 'react'
import * as configService from '../../services/config'

const writeLayoutOptions: Array<{ value: configService.ExportWriteLayout; label: string; desc: string }> = [
  {
    value: 'A',
    label: 'A（类型分目录）',
    desc: '聊天文本、语音、视频、表情包、图片分别创建文件夹'
  },
  {
    value: 'B',
    label: 'B（文本根目录+媒体按会话）',
    desc: '聊天文本在根目录；媒体按类型目录后再按会话分目录'
  },
  {
    value: 'C',
    label: 'C（按会话分目录）',
    desc: '每个会话一个目录，目录内包含文本与媒体文件'
  }
]

interface WriteLayoutSelectorProps {
  writeLayout: configService.ExportWriteLayout
  onChange: (value: configService.ExportWriteLayout) => Promise<void>
  sessionNameWithTypePrefix: boolean
  onSessionNameWithTypePrefixChange: (enabled: boolean) => Promise<void>
}

export const WriteLayoutSelector = memo(function WriteLayoutSelector({
  writeLayout,
  onChange,
  sessionNameWithTypePrefix,
  onSessionNameWithTypePrefixChange
}: WriteLayoutSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return
      setIsOpen(false)
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [isOpen])

  const writeLayoutLabel = writeLayoutOptions.find((option) => option.value === writeLayout)?.label || 'A（类型分目录）'

  return (
    <div className="write-layout-control" ref={containerRef}>
      <span className="control-label">写入目录方式</span>
      <button
        className={`layout-trigger ${isOpen ? 'active' : ''}`}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {writeLayoutLabel}
      </button>
      <div className={`layout-dropdown ${isOpen ? 'open' : ''}`}>
        {writeLayoutOptions.map((option) => (
          <button
            key={option.value}
            className={`layout-option ${writeLayout === option.value ? 'active' : ''}`}
            type="button"
            onClick={async () => {
              await onChange(option.value)
              setIsOpen(false)
            }}
          >
            <span className="layout-option-label">{option.label}</span>
            <span className="layout-option-desc">{option.desc}</span>
          </button>
        ))}
        <div className="layout-prefix-toggle">
          <div className="layout-prefix-copy">
            <span className="layout-prefix-label">聊天文本文件和会话文件夹带前缀</span>
            <span className="layout-prefix-desc">开启后使用群聊_、私聊_、公众号_、曾经的好友_前缀</span>
          </div>
          <button
            type="button"
            className={`layout-prefix-switch ${sessionNameWithTypePrefix ? 'on' : ''}`}
            onClick={async () => {
              await onSessionNameWithTypePrefixChange(!sessionNameWithTypePrefix)
            }}
            aria-label="聊天文本文件和会话文件夹带前缀"
            aria-pressed={sessionNameWithTypePrefix}
          >
            <span className="layout-prefix-switch-thumb" />
          </button>
        </div>
      </div>
    </div>
  )
})
