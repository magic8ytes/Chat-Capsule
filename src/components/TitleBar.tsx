import './TitleBar.scss'

interface TitleBarProps {
  title?: string
}

function TitleBar({ title }: TitleBarProps = {}) {
  return (
    <div className="title-bar">
      <img src="./logo.png" alt="Chat Capsule" className="title-logo" />
      <span className="titles">{title || 'Chat Capsule'}</span>
    </div>
  )
}

export default TitleBar
