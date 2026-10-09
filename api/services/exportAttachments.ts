// 生成"报销附件合集 PDF"。
//
// 设计要点（与导出路由约定）：
// 1. 调用方先按"用户当前可见表格"的顺序把报销单传进来；
//    第一个出现的新 reimbursementId -> 编号 1，第二个 -> 编号 2，以此类推。
// 2. 每个报销单输出一组连续页面：
//      - 第 1 页是该报销单按 sortOrder 升序的第一张发票（如果存在）；
//      - 之后是该报销单所有 order 的全部 attachment，
//        按 (order.sequence asc, attachment.sortOrder asc) 排序后
//        命名为"订单截图 1 / 2 / 3 ..."输出（跨 order 累加）。
// 3. 任何一页的顶部都标注该报销单的编号 + 标题 + 类型 + 文件名 + 页码 + 订单备注。
// 4. 缺失的附件（没有发票 / order 没截图）直接跳过；不存在的物理文件画占位提示。
// 5. 中文字体通过 subset-font 动态子集化后由 pdf-lib 嵌入；字体文件丢失时抛清晰错误。
// 6. PDF 附件通过 pdf-lib embedPdf 直接按页合并进合集（支持多页 PDF，忽略加密）；
//    PNG/JPG 截图按原比例缩放居中放入内容区。

import fs from 'node:fs'
import path from 'node:path'
import type { Attachment, OrderItem, Reimbursement } from '@prisma/client'
import { PDFDocument, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import subsetFont from 'subset-font'

type IncludedReimbursement = Reimbursement & {
  creator: { id: string; displayName: string }
  category: { id: string; name: string } | null
  attachments: Attachment[]
  orders: (OrderItem & { attachments: Attachment[] })[]
}

type PageItem = {
  sequenceNumber: number
  sequenceLabel: string
  title: string
  invoiceNumber: string
  categoryName: string
  type: string // "发票" / "订单截图 1（订单 1）" / ...
  indexInGroup: number
  totalInGroup: number
  fileName: string
  filePath: string
  exists: boolean
  note: string // 该页对应的订单备注（发票页为全部订单备注合并）
  loadError?: string // PDF 附件加载失败时记录原因
}

// A4 portrait, 单位 pt
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 36

const HEADER_TITLE_SIZE = 14
const HEADER_META_SIZE = 10
const HEADER_NOTE_SIZE = 9
const HEADER_RULE_GAP = 8
const IMAGE_BOTTOM_OFFSET = MARGIN + 8 + 4 // 底部留白
const MAX_NOTE_LINES = 6
const MIN_CONTENT_HEIGHT = 100

const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const COLOR_TITLE = rgb(0.0588, 0.0902, 0.1608)
const COLOR_META = rgb(0.2784, 0.3333, 0.4118)
const COLOR_NOTE = rgb(0.6235, 0.4353, 0.0431)
const COLOR_RULE = rgb(0.7961, 0.8196, 0.8824)
const COLOR_ERROR = rgb(0.7255, 0.1098, 0.1098)
const COLOR_TEXT = rgb(0.0588, 0.0902, 0.1608)

const FONT_CANDIDATES = [
  'SourceHanSansCN-Regular.otf',
  'NotoSansCJKsc-Regular.otf',
  'NotoSansSC-Regular.otf',
]

// 固定文案 + 常见符号：保证子集字体一定包含这些字形
const BASE_SUBSET_TEXT =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  '·／（）()：:；;，,。.!！?？%％￥¥-—…/\\ \t\n' +
  '附件发票号第页备注：当前导出结果中没有可用的附件。附件文件丢失原始路径无法嵌入错误此附件为PDF文件' +
  '（备注内容较长，已截断）'

let cachedFontBuffer: Buffer | null = null

function loadFont(): Buffer {
  if (cachedFontBuffer) return cachedFontBuffer
  const fontDir = path.join(process.cwd(), 'assets', 'fonts')
  for (const name of FONT_CANDIDATES) {
    const p = path.join(fontDir, name)
    if (fs.existsSync(p) && fs.statSync(p).size > 100_000) {
      cachedFontBuffer = fs.readFileSync(p)
      console.log(
        `[export-attachments] 使用字体: ${name} (${(cachedFontBuffer.length / 1024 / 1024).toFixed(2)} MB)`,
      )
      return cachedFontBuffer
    }
  }
  throw new Error(
    `未找到 PDF 中文字体。请在 ${fontDir} 放置以下任一文件后重试：\n` +
      FONT_CANDIDATES.map((name) => `  - ${name}`).join('\n') +
      '\n可运行: npm run setup:fonts 自动下载。',
  )
}

// 修复上传阶段 UTF-8 字节被误按 Latin-1 解码导致的双重编码乱码文件名（仅展示层修复，不改数据库）
function fixMojibakeFileName(fileName: string): string {
  if (!/[\u0080-\u00ff]/.test(fileName)) return fileName
  try {
    const bytes = Buffer.from(fileName, 'latin1')
    const decoded = bytes.toString('utf8')
    // 含替换符说明并非可逆的 mojibake，保持原样
    if (decoded.includes('\uFFFD')) return fileName
    // 必须能无损往返，避免误伤正常文件名
    if (Buffer.from(decoded, 'utf8').toString('latin1') !== fileName) return fileName
    return decoded
  } catch {
    return fileName
  }
}

function buildPages(
  reimbursements: IncludedReimbursement[],
  sequenceMap: Map<string, number>,
): PageItem[] {
  const pages: PageItem[] = []
  for (const r of reimbursements) {
    const seq = sequenceMap.get(r.id)
    if (!seq) continue // 不在编号表里说明这个报销单根本没出现在筛选结果中（理论上不会发生）
    const sequenceLabel = `R-${String(seq).padStart(3, '0')}`
    const title = (r.title || r.invoiceNumber || `${sequenceLabel} 报销单`).trim()
    const invoiceNumber = r.invoiceNumber?.trim() || ''
    const categoryName = r.category?.name || ''

    // 发票页没有自己的订单，备注展示该报销单全部订单备注（与审批页展示口径一致）
    const invoiceNote = r.orders
      .map((order) => order.note.trim())
      .filter(Boolean)
      .join('；')

    const group: Array<{ type: string; fileName: string; filePath: string; note: string }> = []

    // 1) 发票：报销单级 attachment, kind=invoice
    const invoices = r.attachments
      .filter((a) => a.kind === 'invoice')
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
    for (const a of invoices) {
      group.push({ type: '发票', fileName: fixMojibakeFileName(a.fileName), filePath: a.filePath, note: invoiceNote })
    }

    // 2) 订单截图：所有 order 的 attachment，按 (order.sequence, sortOrder) 排序
    const sortedOrders = r.orders.slice().sort((a, b) => a.sequence - b.sequence)
    let screenshotIndex = 0
    for (const order of sortedOrders) {
      const orderAttachments = order.attachments
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
      for (const a of orderAttachments) {
        screenshotIndex += 1
        group.push({
          type: `订单截图 ${screenshotIndex}（订单 ${order.sequence}）`,
          fileName: fixMojibakeFileName(a.fileName),
          filePath: a.filePath,
          note: order.note.trim(),
        })
      }
    }

    const total = group.length
    group.forEach((item, idx) => {
      const exists = fs.existsSync(item.filePath)
      pages.push({
        sequenceNumber: seq,
        sequenceLabel,
        title,
        invoiceNumber,
        categoryName,
        type: item.type,
        indexInGroup: idx + 1,
        totalInGroup: total,
        fileName: item.fileName,
        filePath: item.filePath,
        exists,
        note: item.note,
      })
    })
  }
  return pages
}

// 若文本超出 maxWidth，则按字符截断并追加省略号
function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  const ellipsis = '…'
  let out = ''
  for (const ch of text) {
    if (font.widthOfTextAtSize(out + ch + ellipsis, size) > maxWidth) break
    out += ch
  }
  return out ? out + ellipsis : ellipsis
}

// 按字符宽度手动换行（中英文混排）
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const ch of text) {
    const candidate = current + ch
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current)
      current = ch
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function drawTextLines(
  page: PDFPage,
  lines: string[],
  x: number,
  startY: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
  maxWidth: number,
) {
  let y = startY
  for (const line of lines) {
    page.drawText(fitText(line, font, size, maxWidth), { x, y, size, font, color })
    y -= size + 2
  }
}

// 绘制页眉，返回内容区顶部坐标（从页面顶部向下测量）
function drawHeader(
  page: PDFPage,
  item: PageItem,
  pageIndex: number,
  totalPages: number,
  font: PDFFont,
): number {
  let cursor = MARGIN

  // 大标题：编号 · 标题 · 分类；优先按段换行，段本身过长时再按字符换行，不截断
  const titleSegments = [item.sequenceLabel, item.title, item.categoryName].filter(Boolean)
  const titleLines: string[] = []
  let currentLine = ''
  for (const seg of titleSegments) {
    const combined = currentLine ? `${currentLine}  ·  ${seg}` : seg
    if (currentLine && font.widthOfTextAtSize(combined, HEADER_TITLE_SIZE) > CONTENT_WIDTH) {
      titleLines.push(currentLine)
      currentLine = seg
    } else {
      currentLine = combined
    }
  }
  if (currentLine) titleLines.push(currentLine)
  for (const line of titleLines) {
    for (const wrapped of wrapText(line, font, HEADER_TITLE_SIZE, CONTENT_WIDTH)) {
      page.drawText(wrapped, {
        x: MARGIN,
        y: PAGE_HEIGHT - cursor - HEADER_TITLE_SIZE,
        size: HEADER_TITLE_SIZE,
        font,
        color: COLOR_TITLE,
      })
      cursor += HEADER_TITLE_SIZE + 2
    }
  }
  cursor += 2

  // 元信息：附件序号 · 类型 / 发票号 / 文件名 / 页码，各项独立成行，超宽自动换行，不截断
  const metaBlocks: string[] = [
    `附件 ${item.indexInGroup}/${item.totalInGroup}${item.type ? `  ·  ${item.type}` : ''}`,
  ]
  if (item.invoiceNumber) metaBlocks.push(`发票号 ${item.invoiceNumber}`)
  if (item.fileName) metaBlocks.push(...wrapText(item.fileName, font, HEADER_META_SIZE, CONTENT_WIDTH))
  metaBlocks.push(`第 ${pageIndex + 1} / ${totalPages} 页`)
  for (const line of metaBlocks) {
    for (const wrapped of wrapText(line, font, HEADER_META_SIZE, CONTENT_WIDTH)) {
      page.drawText(wrapped, {
        x: MARGIN,
        y: PAGE_HEIGHT - cursor - HEADER_META_SIZE,
        size: HEADER_META_SIZE,
        font,
        color: COLOR_META,
      })
      cursor += HEADER_META_SIZE + 2
    }
  }
  cursor += 3

  // 备注：多行自动换行，最多展示 MAX_NOTE_LINES 行
  if (item.note) {
    const noteLines: string[] = []
    for (const rawLine of item.note.split(/\r?\n/)) {
      if (!rawLine.trim()) {
        noteLines.push('')
        continue
      }
      noteLines.push(...wrapText(rawLine.trim(), font, HEADER_NOTE_SIZE, CONTENT_WIDTH - 24))
    }
    const shownLines = noteLines.slice(0, MAX_NOTE_LINES)
    const truncated = noteLines.length > MAX_NOTE_LINES
    shownLines.forEach((line, idx) => {
      const prefix = idx === 0 ? '备注：' : '　　'
      const text = truncated && idx === shownLines.length - 1 ? `${prefix}${line}…` : `${prefix}${line}`
      page.drawText(fitText(text, font, HEADER_NOTE_SIZE, CONTENT_WIDTH), {
        x: MARGIN,
        y: PAGE_HEIGHT - cursor - HEADER_NOTE_SIZE,
        size: HEADER_NOTE_SIZE,
        font,
        color: COLOR_NOTE,
      })
      cursor += HEADER_NOTE_SIZE + 2
    })
    cursor += 4
  }

  // 分隔线
  cursor += 1
  page.drawLine({
    start: { x: MARGIN, y: PAGE_HEIGHT - cursor },
    end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - cursor },
    thickness: 0.6,
    color: COLOR_RULE,
  })
  cursor += HEADER_RULE_GAP

  // 保证内容区至少留出 MIN_CONTENT_HEIGHT 高度
  return Math.min(cursor, PAGE_HEIGHT - IMAGE_BOTTOM_OFFSET - MIN_CONTENT_HEIGHT)
}

// 在内容区内等比缩放居中，返回绘制矩形
function fitRect(
  srcWidth: number,
  srcHeight: number,
  maxWidth: number,
  maxHeight: number,
  imageTop: number,
): { x: number; y: number; width: number; height: number } {
  if (!(srcWidth > 0) || !(srcHeight > 0)) {
    return { x: MARGIN, y: PAGE_HEIGHT - imageTop - 50, width: 0, height: 0 }
  }
  const scale = Math.min(maxWidth / srcWidth, maxHeight / srcHeight)
  const width = srcWidth * scale
  const height = srcHeight * scale
  return {
    x: MARGIN + (maxWidth - width) / 2,
    y: PAGE_HEIGHT - imageTop - height - (maxHeight - height) / 2,
    width,
    height,
  }
}

function sniffImageType(buffer: Buffer): 'png' | 'jpg' | null {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png'
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg'
  }
  return null
}

async function appendItem(
  doc: PDFDocument,
  item: PageItem,
  startIndex: number,
  totalPages: number,
  font: PDFFont,
  pdfDocs: Map<string, PDFDocument>,
): Promise<number> {
  const ext = path.extname(item.filePath).toLowerCase()

  // 物理文件丢失
  if (!item.exists) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    const imageTop = drawHeader(page, item, startIndex, totalPages, font)
    drawTextLines(
      page,
      [`附件文件丢失: ${item.fileName}`, `原始路径: ${item.filePath}`],
      MARGIN,
      PAGE_HEIGHT - imageTop - 12,
      11,
      font,
      COLOR_ERROR,
      CONTENT_WIDTH,
    )
    return 1
  }

  // PDF 附件：按页合并进合集（支持多页）
  if (ext === '.pdf') {
    const srcDoc = pdfDocs.get(item.filePath)
    if (!srcDoc || item.loadError) {
      const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      const imageTop = drawHeader(page, item, startIndex, totalPages, font)
      drawTextLines(
        page,
        [
          `无法嵌入 PDF 附件: ${item.fileName}`,
          `错误: ${item.loadError || '未知错误'}`,
          `原始路径: ${item.filePath}`,
        ],
        MARGIN,
        PAGE_HEIGHT - imageTop - 12,
        11,
        font,
        COLOR_ERROR,
        CONTENT_WIDTH,
      )
      return 1
    }

    const embedded = await doc.embedPdf(srcDoc, srcDoc.getPageIndices())
    for (let i = 0; i < embedded.length; i += 1) {
      const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      const imageTop = drawHeader(page, item, startIndex + i, totalPages, font)
      const contentHeight = PAGE_HEIGHT - imageTop - IMAGE_BOTTOM_OFFSET
      const rect = fitRect(embedded[i].width, embedded[i].height, CONTENT_WIDTH, contentHeight, imageTop)
      if (rect.width > 0 && rect.height > 0) {
        page.drawPage(embedded[i], rect)
      } else {
        drawTextLines(
          page,
          [`无法嵌入 PDF 附件: ${item.fileName}`, '页面尺寸无效。'],
          MARGIN,
          PAGE_HEIGHT - imageTop - 12,
          11,
          font,
          COLOR_ERROR,
          CONTENT_WIDTH,
        )
      }
    }
    return embedded.length
  }

  // 图片附件：PNG / JPG
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const imageTop = drawHeader(page, item, startIndex, totalPages, font)
  const contentHeight = PAGE_HEIGHT - imageTop - IMAGE_BOTTOM_OFFSET
  try {
    const buffer = fs.readFileSync(item.filePath)
    const type = sniffImageType(buffer)
    if (type === 'png') {
      const image = await doc.embedPng(buffer)
      const rect = fitRect(image.width, image.height, CONTENT_WIDTH, contentHeight, imageTop)
      page.drawImage(image, rect)
    } else if (type === 'jpg') {
      const image = await doc.embedJpg(buffer)
      const rect = fitRect(image.width, image.height, CONTENT_WIDTH, contentHeight, imageTop)
      page.drawImage(image, rect)
    } else {
      throw new Error(`不支持的图片格式: ${ext || '未知'}`)
    }
  } catch (err) {
    drawTextLines(
      page,
      [`无法嵌入附件: ${item.fileName}`, `错误: ${(err as Error).message}`],
      MARGIN,
      PAGE_HEIGHT - imageTop - 12,
      11,
      font,
      COLOR_ERROR,
      CONTENT_WIDTH,
    )
  }
  return 1
}

function collectSubsetText(pages: PageItem[]): string {
  const parts: string[] = [BASE_SUBSET_TEXT]
  for (const p of pages) {
    parts.push(p.sequenceLabel, p.title, p.categoryName, p.type, p.fileName, p.invoiceNumber, p.note)
    if (!p.exists) {
      parts.push(`附件文件丢失: ${p.fileName}`, `原始路径: ${p.filePath}`)
    }
  }
  return parts.join('\n')
}

export async function buildExportAttachments(
  filePath: string,
  reimbursements: IncludedReimbursement[],
  sequenceMap: Map<string, number>,
): Promise<void> {
  const pages = buildPages(reimbursements, sequenceMap)

  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)

  // 中文字体：subset-font 动态子集化（OTF -> TTF），失败时回退为嵌入完整字体
  const fontBuffer = loadFont()
  let font: PDFFont
  try {
    const subset = await subsetFont(fontBuffer, collectSubsetText(pages), {
      targetFormat: 'truetype',
    })
    font = await doc.embedFont(subset, { features: { locl: false } })
  } catch (err) {
    console.warn('[export-attachments] 字体子集化失败，回退为嵌入完整字体:', (err as Error).message)
    font = await doc.embedFont(fontBuffer, { features: { locl: false } })
  }

  // 预加载所有 PDF 附件（用于统计总页数），加载失败则记录并画占位提示
  const pdfDocs = new Map<string, PDFDocument>()
  for (const p of pages) {
    if (!p.exists || path.extname(p.filePath).toLowerCase() !== '.pdf' || pdfDocs.has(p.filePath)) {
      continue
    }
    try {
      const srcDoc = await PDFDocument.load(fs.readFileSync(p.filePath), { ignoreEncryption: true })
      pdfDocs.set(p.filePath, srcDoc)
    } catch (err) {
      p.loadError = (err as Error).message
      console.warn(`[export-attachments] 无法读取 PDF 附件 ${p.filePath}:`, p.loadError)
    }
  }

  let totalPages = 0
  for (const p of pages) {
    if (p.exists && !p.loadError && path.extname(p.filePath).toLowerCase() === '.pdf') {
      totalPages += pdfDocs.get(p.filePath)!.getPageCount()
    } else {
      totalPages += 1
    }
  }

  if (pages.length === 0) {
    const emptyPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    emptyPage.drawText('当前导出结果中没有可用的附件。', {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - HEADER_TITLE_SIZE,
      size: HEADER_TITLE_SIZE,
      font,
      color: COLOR_TEXT,
    })
  } else {
    let outputIndex = 0
    for (const item of pages) {
      outputIndex += await appendItem(doc, item, outputIndex, totalPages, font, pdfDocs)
    }
  }

  const bytes = await doc.save()
  fs.writeFileSync(filePath, bytes)
}