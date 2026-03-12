import { createPortal } from 'react-dom'
import { Calendar, Check, Copy, Hash, Image as ImageIcon, Mic, X } from 'lucide-react'
import type { Message } from '../../types/models'

interface MessageInfoModalProps {
  message: Message | null
  copiedField: string | null
  onClose: () => void
  onCopyField: (text: string, field: string) => void
}

export default function MessageInfoModal({
  message,
  copiedField,
  onClose,
  onCopyField
}: MessageInfoModalProps) {
  if (!message) return null

  return createPortal(
    <div className="message-info-overlay" onClick={onClose}>
      <div className="message-info-modal" onClick={(event) => event.stopPropagation()}>
        <div className="detail-header">
          <h4>消息详情</h4>
          <button className="close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="detail-content">
          <div className="detail-section">
            <div className="detail-item">
              <Hash size={14} />
              <span className="label">Local ID</span>
              <span className="value">{message.localId}</span>
              <button className="copy-btn" title="复制" onClick={() => onCopyField(String(message.localId), 'msgLocalId')}>
                {copiedField === 'msgLocalId' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
            <div className="detail-item">
              <Hash size={14} />
              <span className="label">Server ID</span>
              <span className="value">{message.serverId}</span>
            </div>
            <div className="detail-item">
              <span className="label">消息类型</span>
              <span className="value highlight">{message.localType}</span>
            </div>
            <div className="detail-item">
              <span className="label">发送者</span>
              <span className="value">{message.senderUsername || '-'}</span>
              {message.senderUsername && (
                <button className="copy-btn" title="复制" onClick={() => onCopyField(message.senderUsername!, 'msgSender')}>
                  {copiedField === 'msgSender' ? <Check size={12} /> : <Copy size={12} />}
                </button>
              )}
            </div>
            <div className="detail-item">
              <Calendar size={14} />
              <span className="label">创建时间</span>
              <span className="value">{new Date(message.createTime * 1000).toLocaleString()}</span>
            </div>
            <div className="detail-item">
              <span className="label">发送状态</span>
              <span className="value">{message.isSend === 1 ? '发送' : '接收'}</span>
            </div>
          </div>

          {(message.imageMd5 || message.videoMd5 || message.voiceDurationSeconds != null) && (
            <div className="detail-section">
              <div className="section-title">
                <ImageIcon size={14} />
                <span>媒体信息</span>
              </div>
              {message.imageMd5 && (
                <div className="detail-item">
                  <span className="label">Image MD5</span>
                  <span className="value mono">{message.imageMd5}</span>
                  <button className="copy-btn" title="复制" onClick={() => onCopyField(message.imageMd5!, 'imgMd5')}>
                    {copiedField === 'imgMd5' ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              )}
              {message.imageDatName && (
                <div className="detail-item">
                  <span className="label">DAT 文件</span>
                  <span className="value mono">{message.imageDatName}</span>
                </div>
              )}
              {message.videoMd5 && (
                <div className="detail-item">
                  <span className="label">Video MD5</span>
                  <span className="value mono">{message.videoMd5}</span>
                  <button className="copy-btn" title="复制" onClick={() => onCopyField(message.videoMd5!, 'vidMd5')}>
                    {copiedField === 'vidMd5' ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              )}
              {message.voiceDurationSeconds != null && (
                <div className="detail-item">
                  <Mic size={14} />
                  <span className="label">语音时长</span>
                  <span className="value">{message.voiceDurationSeconds}秒</span>
                </div>
              )}
            </div>
          )}

          {(message.emojiMd5 || message.emojiCdnUrl) && (
            <div className="detail-section">
              <div className="section-title">
                <span>表情包信息</span>
              </div>
              {message.emojiMd5 && (
                <div className="detail-item">
                  <span className="label">MD5</span>
                  <span className="value mono">{message.emojiMd5}</span>
                </div>
              )}
              {message.emojiCdnUrl && (
                <div className="detail-item">
                  <span className="label">CDN URL</span>
                  <span className="value mono">{message.emojiCdnUrl}</span>
                </div>
              )}
            </div>
          )}

          {message.localType !== 1 && (message.rawContent || message.content) && (
            <div className="detail-section">
              <div className="section-title">
                <span>原始消息内容</span>
                <button className="copy-btn" title="复制" onClick={() => onCopyField(message.rawContent || message.content || '', 'rawContent')}>
                  {copiedField === 'rawContent' ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
              <div className="raw-content-box">
                <pre>{message.rawContent || message.content}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
