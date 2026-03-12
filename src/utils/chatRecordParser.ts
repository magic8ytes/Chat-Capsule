import type { ChatRecordItem } from '../types/models'

const extractXmlValue = (xml: string, tag: string): string => {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml)
  return match
    ? match[1].replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim()
    : ''
}

const decodeHtmlEntitiesDeep = (text?: string): string | undefined => {
  if (!text) return text

  let decoded = text
  for (let i = 0; i < 3; i += 1) {
    const next = decoded
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
    if (next === decoded) break
    decoded = next
  }

  return decoded
}

const extractTagContents = (xml: string, tagName: string): string[] => {
  if (!xml) return []

  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'gi')
  const matches: string[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(xml)) !== null) {
    const value = match[1]?.trim()
    if (value) matches.push(value)
  }

  return matches
}

const extractCdataContents = (xml: string): string[] => {
  if (!xml) return []

  const regex = /<!\[CDATA\[([\s\S]*?)\]\]>/gi
  const matches: string[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(xml)) !== null) {
    const value = match[1]?.trim()
    if (value) matches.push(value)
  }

  return matches
}

const parsePositiveNumber = (value: string): number | undefined => {
  if (!value) return undefined
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

const normalizeChatRecordValue = (value: string): string | undefined => {
  if (!value) return undefined
  const normalized = decodeHtmlEntitiesDeep(value)
    ?.replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .trim()
  return normalized || undefined
}

const buildChatRecordItem = (xml: string, datatypeHint?: number): ChatRecordItem | null => {
  if (!xml) return null

  const datatypeAttr = /<dataitem\b[^>]*\bdatatype\s*=\s*['"]?(\d+)/i.exec(xml)
  const datatypeStr = datatypeAttr?.[1] || extractXmlValue(xml, 'datatype')
  const parsedDatatype = datatypeStr ? parseInt(datatypeStr, 10) : datatypeHint || 0
  const datatype = Number.isFinite(parsedDatatype) ? parsedDatatype : 0

  const sourcename = normalizeChatRecordValue(extractXmlValue(xml, 'sourcename')) || ''
  const sourcetime = normalizeChatRecordValue(extractXmlValue(xml, 'sourcetime')) || ''
  const sourceheadurl = normalizeChatRecordValue(extractXmlValue(xml, 'sourceheadurl'))
  const datadesc = normalizeChatRecordValue(extractXmlValue(xml, 'datadesc'))
  const datatitle = normalizeChatRecordValue(extractXmlValue(xml, 'datatitle'))
  const fileext = normalizeChatRecordValue(extractXmlValue(xml, 'fileext'))
  const messageuuid = normalizeChatRecordValue(extractXmlValue(xml, 'messageuuid'))
  const dataurl = normalizeChatRecordValue(extractXmlValue(xml, 'dataurl'))
  const datathumburl =
    normalizeChatRecordValue(extractXmlValue(xml, 'datathumburl')) ||
    normalizeChatRecordValue(extractXmlValue(xml, 'thumburl'))
  const datacdnurl =
    normalizeChatRecordValue(extractXmlValue(xml, 'datacdnurl')) ||
    normalizeChatRecordValue(extractXmlValue(xml, 'cdnurl'))
  const aeskey =
    normalizeChatRecordValue(extractXmlValue(xml, 'aeskey')) ||
    normalizeChatRecordValue(extractXmlValue(xml, 'qaeskey'))
  const md5 =
    normalizeChatRecordValue(extractXmlValue(xml, 'md5')) ||
    normalizeChatRecordValue(extractXmlValue(xml, 'datamd5'))
  const datasize = parsePositiveNumber(extractXmlValue(xml, 'datasize'))
  const imgheight = parsePositiveNumber(extractXmlValue(xml, 'imgheight'))
  const imgwidth = parsePositiveNumber(extractXmlValue(xml, 'imgwidth'))
  const duration = parsePositiveNumber(extractXmlValue(xml, 'duration'))

  if (!sourcename && !datadesc && !datatitle && !dataurl && !datathumburl && !datacdnurl) {
    return null
  }

  return {
    datatype,
    sourcename,
    sourcetime,
    sourceheadurl,
    datadesc,
    datatitle,
    fileext,
    datasize,
    messageuuid,
    dataurl,
    datathumburl,
    datacdnurl,
    aeskey,
    md5,
    imgheight,
    imgwidth,
    duration
  }
}

const parseChatRecordDataItems = (xml: string): ChatRecordItem[] => {
  if (!xml) return []

  const items: ChatRecordItem[] = []
  const itemRegex = /<dataitem\b([^>]*)>([\s\S]*?)<\/dataitem>/gi
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const attrs = match[1] || ''
    const body = match[2] || ''
    const datatypeAttr = /\bdatatype\s*=\s*['"]?(\d+)/i.exec(attrs)
    const datatypeHint = datatypeAttr ? parseInt(datatypeAttr[1], 10) : undefined
    const item = buildChatRecordItem(`<dataitem${attrs}>${body}</dataitem>`, datatypeHint)
    if (item) items.push(item)
  }

  return items
}

export const extractChatRecordTitle = (content: string): string | undefined => {
  if (!content) return undefined
  const decodedContent = decodeHtmlEntitiesDeep(content) || content
  return normalizeChatRecordValue(extractXmlValue(content, 'title')) ||
    normalizeChatRecordValue(extractXmlValue(decodedContent, 'title'))
}

export const parseChatRecordList = (content: string): ChatRecordItem[] | undefined => {
  const decodedContent = decodeHtmlEntitiesDeep(content) || content
  const type = extractXmlValue(content, 'type') || extractXmlValue(decodedContent, 'type')
  if (type !== '19') return undefined

  const itemKeys = new Set<string>()
  const recordList: ChatRecordItem[] = []
  const candidateContents = new Set<string>()
  const recordBlocks = Array.from(new Set([
    ...extractTagContents(content, 'recorditem'),
    ...extractTagContents(decodedContent, 'recorditem')
  ]))

  const pushItem = (item: ChatRecordItem | null | undefined) => {
    if (!item) return
    const key = [
      item.messageuuid || '',
      item.datatype,
      item.sourcename || '',
      item.sourcetime || '',
      item.datadesc || '',
      item.datatitle || '',
      item.dataurl || '',
      item.datathumburl || '',
      item.datacdnurl || ''
    ].join('\u0001')
    if (itemKeys.has(key)) return
    itemKeys.add(key)
    recordList.push(item)
  }

  const addCandidate = (xml?: string) => {
    const value = xml?.trim()
    if (!value) return
    candidateContents.add(value)
  }

  const registerCandidates = (xml: string) => {
    addCandidate(xml)
    addCandidate(decodeHtmlEntitiesDeep(xml))
    for (const cdata of extractCdataContents(xml)) {
      addCandidate(cdata)
      addCandidate(decodeHtmlEntitiesDeep(cdata))
    }
  }

  registerCandidates(content)
  if (decodedContent !== content) registerCandidates(decodedContent)
  for (const block of recordBlocks) {
    registerCandidates(block)
  }

  for (const candidate of candidateContents) {
    const items = parseChatRecordDataItems(candidate)
    for (const item of items) {
      pushItem(item)
    }
  }

  for (const block of recordBlocks) {
    pushItem(buildChatRecordItem(block))
    const decodedBlock = decodeHtmlEntitiesDeep(block)
    if (decodedBlock && decodedBlock !== block) {
      pushItem(buildChatRecordItem(decodedBlock))
    }
  }

  return recordList.length > 0 ? recordList : undefined
}
