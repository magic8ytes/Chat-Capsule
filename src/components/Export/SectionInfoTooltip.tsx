import { memo, useEffect, useRef, useState } from 'react'
import { CircleHelp } from 'lucide-react'

interface SectionInfoTooltipProps {
  label: string
  heading: string
  messages: string[]
}

export const SectionInfoTooltip = memo(function SectionInfoTooltip({
  label,
  heading,
  messages
}: SectionInfoTooltipProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return
      setIsOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div className="section-info-tooltip" ref={containerRef}>
      <button
        type="button"
        className={`section-info-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`查看${label}说明`}
        aria-expanded={isOpen}
      >
        <CircleHelp size={14} />
      </button>
      {isOpen && (
        <div className="section-info-popover" role="dialog" aria-label={`${label}说明`}>
          <h4>{heading}</h4>
          {messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
    </div>
  )
})
