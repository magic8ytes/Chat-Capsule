import { Check } from 'lucide-react'
import type { CSSProperties } from 'react'

interface MessageSelectionCheckboxProps {
  checked?: boolean
  style?: CSSProperties
}

const baseStyle: CSSProperties = {
  width: '20px',
  height: '20px',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'white',
  flexShrink: 0
}

export default function MessageSelectionCheckbox({ checked = false, style }: MessageSelectionCheckboxProps) {
  return (
    <div
      className={`checkbox ${checked ? 'checked' : ''}`}
      style={{
        ...baseStyle,
        border: checked ? 'none' : '2px solid rgba(128,128,128,0.5)',
        backgroundColor: checked ? 'var(--primary)' : 'transparent',
        ...style
      }}
    >
      {checked && <Check size={14} strokeWidth={3} />}
    </div>
  )
}
