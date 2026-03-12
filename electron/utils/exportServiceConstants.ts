export const MESSAGE_TYPE_MAP: Record<number, number> = {
  1: 0,
  3: 1,
  34: 2,
  43: 3,
  49: 7,
  47: 5,
  48: 8,
  42: 27,
  50: 23,
  10000: 80
}

export const TXT_COLUMN_DEFINITIONS: Array<{ id: string; label: string }> = [
  { id: 'index', label: '序号' },
  { id: 'time', label: '时间' },
  { id: 'senderRole', label: '发送者身份' },
  { id: 'messageType', label: '消息类型' },
  { id: 'content', label: '内容' },
  { id: 'senderNickname', label: '发送者昵称' },
  { id: 'senderWxid', label: '发送者微信ID' },
  { id: 'senderRemark', label: '发送者备注' }
]
