import { useEffect, useState } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import type { ChatRecordItem } from '../types/models'
import { chat } from '../services/ipc'
import { createLogger } from '../utils/logger'
import TitleBar from '../components/TitleBar'
import { AvatarImage } from '../components/AvatarImage'
import { extractChatRecordTitle, parseChatRecordList } from '../utils/chatRecordParser'
import './ChatHistoryPage.scss'

const logger = createLogger('ChatHistoryPage')

export default function ChatHistoryPage() {
  const params = useParams<{ sessionId: string; messageId: string }>()
  const location = useLocation()
  const [recordList, setRecordList] = useState<ChatRecordItem[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('聊天记录')
  const [error, setError] = useState('')

  const getIds = () => {
    const sessionId = params.sessionId || ''
    const messageId = params.messageId || ''

    if (sessionId && messageId) {
      return { sid: sessionId, mid: messageId }
    }

    const match = /^\/chat-history\/([^/]+)\/([^/]+)/.exec(location.pathname)
    if (match) {
      return { sid: match[1], mid: match[2] }
    }

    return { sid: '', mid: '' }
  }

  useEffect(() => {
    const loadData = async () => {
      const { sid, mid } = getIds()
      if (!sid || !mid) {
        setError('无效的聊天记录链接')
        setLoading(false)
        return
      }

      try {
        const result = await chat.getMessage(sid, parseInt(mid, 10))
        if (result.success && result.message) {
          const msg = result.message
          let records: ChatRecordItem[] | undefined = msg.chatRecordList

          if ((!records || records.length === 0) && msg.content) {
            records = parseChatRecordList(msg.content) as ChatRecordItem[] | undefined
          }

          if (records && records.length > 0) {
            setRecordList(records)
            setTitle(extractChatRecordTitle(msg.content || '') || msg.chatRecordTitle || '聊天记录')
          } else {
            setError('暂时无法解析这条聊天记录')
          }
        } else {
          setError(result.error || '获取消息失败')
        }
      } catch (e) {
        logger.error('加载聊天记录详情失败:', e)
        setError('加载详情失败')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [params.sessionId, params.messageId, location.pathname])

  return (
    <div className="chat-history-page">
      <TitleBar title={title} />
      <div className="history-list">
        {loading ? (
          <div className="status-msg">加载中...</div>
        ) : error ? (
          <div className="status-msg error">{error}</div>
        ) : recordList.length === 0 ? (
          <div className="status-msg empty">暂无可显示的聊天记录</div>
        ) : (
          recordList.map((item, i) => (
            <HistoryItem key={i} item={item} />
          ))
        )}
      </div>
    </div>
  )
}

function HistoryItem({ item }: { item: ChatRecordItem }) {
  let time = ''
  if (item.sourcetime) {
    if (/^\d+$/.test(item.sourcetime)) {
      time = new Date(parseInt(item.sourcetime, 10) * 1000).toLocaleString()
    } else {
      time = item.sourcetime
    }
  }

  const renderContent = () => {
    if (item.datatype === 1) {
      return <div className="text-content">{item.datadesc || ''}</div>
    }
    if (item.datatype === 3) {
      const src = item.datathumburl || item.datacdnurl
      if (src) {
        return (
          <div className="media-content">
            <img
              src={src}
              alt="图片"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                const placeholder = document.createElement('div')
                placeholder.className = 'media-tip'
                placeholder.textContent = '图片无法加载'
                target.parentElement?.appendChild(placeholder)
              }}
            />
          </div>
        )
      }
      return <div className="media-placeholder">[图片]</div>
    }
    if (item.datatype === 43) {
      return <div className="media-placeholder">[视频] {item.datatitle}</div>
    }
    if (item.datatype === 34) {
      return <div className="media-placeholder">[语音] {item.duration ? (item.duration / 1000).toFixed(0) + '"' : ''}</div>
    }
    return <div className="text-content">{item.datadesc || item.datatitle || '[不支持的消息类型]'}</div>
  }

  return (
    <div className="history-item">
      <div className="avatar">
        <AvatarImage src={item.sourceheadurl} name={item.sourcename} alt="" loading="eager" referrerPolicy="no-referrer" />
      </div>
      <div className="content-wrapper">
        <div className="header">
          <span className="sender">{item.sourcename || '未知发送者'}</span>
          <span className="time">{time}</span>
        </div>
        <div className={`bubble ${item.datatype === 3 ? 'image-bubble' : ''}`}>
          {renderContent()}
        </div>
      </div>
    </div>
  )
}
