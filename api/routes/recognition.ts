import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// 不落盘，只在内存里转给 OCR
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
})

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:8001'
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS ?? 90_000) // 单张 90s 容忍 PDF

type OcrField = {
  invoice_code: string | null
  invoice_no: string | null
  invoice_date: string | null
  buyer_name: string | null
  buyer_tax_id: string | null
  seller_name: string | null
  seller_tax_id: string | null
  items: Array<Record<string, unknown>>
  total_amount: number | null
  total_tax: number | null
  grand_total: number | null
  grand_total_uppercase: string | null
  remark: string | null
  issuer: string | null
  receiver: string | null
  reviewer: string | null
  _meta?: { block_count: number; avg_confidence: number; warnings: string[]; page: number }
}

type OcrResponse = {
  file_id: string
  filename: string
  file_type: string
  file_size: number
  pages: number
  fields: OcrField[]
  cost_ms: number
}

async function callOcr(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  mode: 'one-shot' | 'upload-then-extract',
): Promise<OcrResponse> {
  const endpoint = mode === 'one-shot' ? '/api/v1/ocr' : '/api/v1/ocr/upload'
  const url = `${OCR_SERVICE_URL.replace(/\/+$/, '')}${endpoint}`

  // 构造 multipart/form-data（Node 18+ 自带 fetch + FormData）
  const form = new FormData()
  // Buffer 需要包成 Uint8Array 再给 Blob
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType || 'application/octet-stream' })
  form.append('file', blob, filename || 'invoice')

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), OCR_TIMEOUT_MS)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      body: form,
      signal: ac.signal,
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`OCR service returned ${resp.status}: ${text.slice(0, 200)}`)
    }
    return (await resp.json()) as OcrResponse
  } finally {
    clearTimeout(timer)
  }
}

router.get('/health', async (_req, res) => {
  try {
    const r = await fetch(`${OCR_SERVICE_URL.replace(/\/+$/, '')}/api/v1/health`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!r.ok) throw new Error(`status ${r.status}`)
    const data = (await r.json()) as Record<string, unknown>
    res.json({
      success: true,
      data: {
        fp: 'ok',
        ocr_service: OCR_SERVICE_URL,
        ocr: data,
      },
    })
  } catch (e) {
    res.status(503).json({
      success: false,
      error: `OCR 服务不可达: ${OCR_SERVICE_URL} (${(e as Error).message})`,
    })
  }
})

// 一步式：上传 + 识别同时返回
router.post('/invoice-ocr', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: '缺少文件字段 file' })
      return
    }
    const result = await callOcr(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      'one-shot',
    )
    res.json({ success: true, data: result })
  } catch (e) {
    const msg = (e as Error).message
    console.error('[recognition] OCR failed:', msg)
    res.status(500).json({ success: false, error: `OCR 失败: ${msg}` })
  }
})

// 仅上传：返回 file_id 给前端缓存
router.post('/invoice-ocr/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: '缺少文件字段 file' })
      return
    }
    const result = await callOcr(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      'upload-then-extract',
    )
    res.json({
      success: true,
      data: {
        file_id: result.file_id,
        filename: result.filename,
        size: req.file.size,
      },
    })
  } catch (e) {
    const msg = (e as Error).message
    console.error('[recognition] upload failed:', msg)
    res.status(500).json({ success: false, error: `上传失败: ${msg}` })
  }
})

// 触发识别：前端传 file_id 调 OCR 服务 extract
router.post('/invoice-ocr/extract', requireAuth, async (req, res) => {
  try {
    const fileId = (req.body as { file_id?: string })?.file_id
    if (!fileId) {
      res.status(400).json({ success: false, error: '缺少 file_id' })
      return
    }
    const url = `${OCR_SERVICE_URL.replace(/\/+$/, '')}/api/v1/ocr/extract`
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), OCR_TIMEOUT_MS)
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId }),
        signal: ac.signal,
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(`OCR service returned ${r.status}: ${text.slice(0, 200)}`)
      }
      const data = (await r.json()) as OcrResponse
      res.json({ success: true, data })
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    const msg = (e as Error).message
    console.error('[recognition] extract failed:', msg)
    res.status(500).json({ success: false, error: `识别失败: ${msg}` })
  }
})

// 4.1.0: 订单截图识别（供 Agent / API 调用；转发到 OCR 服务的 /api/v1/order-ocr）
// OCR 服务需支持 order-ocr 接口（本地 FpLocalOcr 与升级后的服务器端 OCR 服务支持）
router.post('/order-ocr', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: '缺少文件字段 file' })
      return
    }

    const platform = typeof (req.body as { platform?: string })?.platform === 'string'
      ? String((req.body as { platform?: string }).platform)
      : ''

    const url = `${OCR_SERVICE_URL.replace(/\/+$/, '')}/api/v1/order-ocr`
    const form = new FormData()
    const blob = new Blob([new Uint8Array(req.file.buffer)], {
      type: req.file.mimetype || 'application/octet-stream',
    })
    form.append('file', blob, req.file.originalname || 'order')
    if (platform) form.append('platform', platform)

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), OCR_TIMEOUT_MS)
    try {
      const r = await fetch(url, { method: 'POST', body: form, signal: ac.signal })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        const hint = r.status === 404
          ? '（当前 OCR 服务版本不含订单识别接口 /api/v1/order-ocr，需要升级 OCR 服务）'
          : ''
        throw new Error(`OCR service returned ${r.status}: ${text.slice(0, 200)} ${hint}`)
      }
      const data = (await r.json()) as {
        fields: {
          platformName?: string
          merchantName?: string
          itemDescription?: string
          orderNumber?: string
          paymentTime?: string
          paymentAmount?: string
        }
        text?: string
        confidence?: number
        cost_ms?: number
      }
      res.json({ success: true, data })
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    const msg = (e as Error).message
    console.error('[recognition] order-ocr failed:', msg)
    res.status(500).json({ success: false, error: `订单识别失败: ${msg}` })
  }
})

export default router
