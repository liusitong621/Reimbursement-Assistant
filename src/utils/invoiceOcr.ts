import type { ReimbursementFormState, OrderFormState } from '@/utils/reimbursement'
import { normalizePaymentTime } from '@/utils/reimbursement'

import { api } from '@/lib/api'

// Vite 把 pdfjs worker 作为构建资产输出，通过 ?url 拿到可直接加载的 URL（vite/client 已声明该模块类型）

// Vite 模式：使用 ?url 后缀返回 URL 字符串；esbuild 模式：使用 new URL(..., import.meta.url) 静态分析为 file asset

// 两种模式都能在打包时把 worker 文件复制到 dist 并改写 URL

// @ts-ignore -- 两种打包器都能解析

const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href



type RecognizedInvoiceFields = Partial<

  Pick<

    ReimbursementFormState,

    | 'invoiceSellerName'

    | 'invoiceSellerTaxNo'

    | 'invoiceAmountExcludingTax'

    | 'invoiceTaxAmount'

    | 'invoiceTaxRate'

    | 'invoiceTotalAmount'

    | 'invoiceNumber'

    | 'invoiceStatus'

  >

>



type RecognizedOrderFields = Partial<

  Pick<

    OrderFormState,

    'platformName' | 'merchantName' | 'itemDescription' | 'orderNumber' | 'paymentTime' | 'paymentAmount'

  >

>



export type InvoiceOcrResult = {
  text: string
  confidence: number
  fields: RecognizedInvoiceFields
  source?: 'local' | 'server' | 'tesseract'
}

export type OrderOcrResult = {
  text: string
  confidence: number
  fields: RecognizedOrderFields
  source?: 'local' | 'server' | 'tesseract'
}

export type OcrPreference = 'local' | 'server'
const OCR_PREF_KEY = 'fpLocalOcrPreference'

// 读取识别引擎偏好（local=本地优先；server=服务器端，不提示安装本地软件）
export function getOcrPreference(): OcrPreference {
  try {
    return localStorage.getItem(OCR_PREF_KEY) === 'server' ? 'server' : 'local'
  } catch {
    return 'local'
  }
}

export function setOcrPreference(preference: OcrPreference) {
  try {
    localStorage.setItem(OCR_PREF_KEY, preference)
  } catch {
    /* 隐私模式等场景下忽略 */
  }
}


// 统一文本预处理：去除多余空格但保留换行，统一标点

function normalizeOcrText(raw: string): string {

  return raw

    .replace(/\r\n/g, '\n')

    .replace(/\r/g, '\n')

    .replace(/[：:]/g, ':')

    .replace(/[（(]/g, '(')

    .replace(/[)）]/g, ')')

    .replace(/[，,]/g, ',')

    .replace(/[．.]/g, '.')

    .replace(/\u00a0/g, ' ')

    .replace(/[ \t]+/g, ' ')

    .replace(/\n{3,}/g, '\n\n')

    .trim()

}



// 紧凑模式：去掉所有空白，方便正则匹配跨行内容

function compactText(text: string): string {

  return text.replace(/\s+/g, '')

}



// 金额标准化：提取数字部分，处理常见 OCR 错误（O→0, l→1 等）

function normalizeAmount(value: string): string {

  if (!value) return ''

  let cleaned = value

    .replace(/[Oo〇零]/g, '0')

    .replace(/[lI一]/g, '1')

    .replace(/[Ss五]/g, '5')

    .replace(/[^0-9.]/g, '')

  // 处理多个小数点的情况，只保留第一个

  const parts = cleaned.split('.')

  if (parts.length > 2) {

    cleaned = parts[0] + '.' + parts.slice(1).join('')

  }

  if (!cleaned) return ''

  const amount = Number(cleaned)

  return Number.isFinite(amount) ? String(amount) : ''

}



// 从多行文本中按关键词匹配

function takeMatch(text: string, patterns: RegExp[]): string {

  for (const pattern of patterns) {

    const match = text.match(pattern)

    if (match?.[1]) {

      return match[1].trim()

    }

  }

  return ''

}



// 从按行分割的文本中提取：先找含关键词的行，取该行后续内容或下一行

function extractFromLines(

  lines: string[],

  keywords: string[],

  options?: { stopAtColon?: boolean },

): string {

  const stopAtColon = options?.stopAtColon ?? true

  for (let i = 0; i < lines.length; i++) {

    const line = lines[i].trim()

    for (const kw of keywords) {

      if (line.includes(kw)) {

        // 先尝试同行提取

        const afterKw = line.slice(line.indexOf(kw) + kw.length).trim()

        if (afterKw && (!stopAtColon || !afterKw.startsWith(':'))) {

          return afterKw.replace(/^[:：\s]+/, '').trim()

        }

        const colonMatch = line.match(new RegExp(`${kw}[:：\\s]*(.+)`))

        if (colonMatch?.[1]) {

          return colonMatch[1].trim()

        }

        // 再看下一行

        if (lines[i + 1]) {

          const next = lines[i + 1].trim()

          if (next && !isLikelyKeywordLine(next)) {

            return next

          }

        }

      }

    }

  }

  return ''

}



function isLikelyKeywordLine(line: string): boolean {

  const keywords = ['名称', '税号', '金额', '税额', '合计', '号码', '税率', '日期', '地址', '电话', '开户', '账号']

  return keywords.some((kw) => line.includes(kw))

}



// 提取销售方名称：支持多种发票格式

function extractSellerName(text: string, lines: string[]): string {

  // 格式1：销售方名称: XXX

  for (const line of lines) {

    const m = line.match(/销售方名称[:：]?\s*(.+)/)

    if (m?.[1]) return m[1].trim()

  }

  // 格式2：名称: XXX（在销售方区域附近）

  for (let i = 0; i < lines.length; i++) {

    if (/销售方/.test(lines[i])) {

      for (let j = i; j < Math.min(i + 5, lines.length); j++) {

        const m = lines[j].match(/名称[:：]?\s*(.+)/)

        if (m?.[1]) return m[1].trim()

      }

    }

  }

  // 格式3：紧凑文本中直接匹配

  const compact = compactText(text)

  const m = compact.match(/销售方名称[:：]?([\u4e00-\u9fa5A-Za-z0-9()（）]+?)(?:纳税人识别号|税号|地址|电话|$)/)

  if (m?.[1]) return m[1].trim()

  return ''

}



// 提取纳税人识别号：支持 15-20 位字母数字

function extractTaxNo(compact: string, lines: string[]): string {

  // 先从紧凑文本中找

  const m = compact.match(/(?:销售方)?(?:纳税人识别号|统一社会信用代码|税号)[:：]?([0-9A-Z]{15,20})/i)

  if (m?.[1]) return m[1]

  // 再从行文本中找纯数字字母串

  for (const line of lines) {

    const m2 = line.match(/([0-9A-Z]{15,20})/)

    if (m2?.[1] && (line.includes('税号') || line.includes('识别号') || line.includes('信用代码'))) {

      return m2[1]

    }

  }

  return ''

}



export function extractInvoiceFields(text: string): RecognizedInvoiceFields {

  const normalized = normalizeOcrText(text)

  const compact = compactText(normalized)

  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean)



  const fields: RecognizedInvoiceFields = {}



  // 发票号码：支持多种格式

  const invoiceNumber = takeMatch(compact, [

    /发票号码[:：]?([0-9A-Z]{8,20})/i,

    /票据号码[:：]?([0-9A-Z]{8,20})/i,

    /No[:：]?\s*([0-9A-Z]{8,20})/i,

  ])

  if (invoiceNumber) fields.invoiceNumber = invoiceNumber



  // 销售方税号

  const sellerTaxNo = extractTaxNo(compact, lines)

  if (sellerTaxNo) fields.invoiceSellerTaxNo = sellerTaxNo



  // 销售方名称

  const sellerName = extractSellerName(normalized, lines)

  if (sellerName) fields.invoiceSellerName = sellerName



  // 金额（不含税）：尝试多种关键词

  const amountExcludingTax = normalizeAmount(

    takeMatch(compact, [

      /(?:金额|不含税金额|合计金额)[:：]?([0-9]+(?:\.[0-9]{1,2})?)/,

      /(?:合计|小计)[:：]?\s*[￥¥]?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:元|$)/,

    ]),

  )

  if (amountExcludingTax) fields.invoiceAmountExcludingTax = amountExcludingTax



  // 税额

  const taxAmount = normalizeAmount(

    takeMatch(compact, [

      /税额[:：]?([0-9]+(?:\.[0-9]{1,2})?)/,

      /(?:税额|税款)[:：]?\s*[￥¥]?\s*([0-9]+(?:\.[0-9]{1,2})?)/,

    ]),

  )

  if (taxAmount) fields.invoiceTaxAmount = taxAmount



  // 价税合计（大写和小写）

  const invoiceTotalAmount = normalizeAmount(

    takeMatch(compact, [

      /(?:价税合计|小写)[:：]?\s*[￥¥]?\s*([0-9]+(?:\.[0-9]{1,2})?)/,

      /(?:合计|总计)[:：]?\s*[￥¥]?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:元|$)/,

    ]),

  )

  if (invoiceTotalAmount) fields.invoiceTotalAmount = invoiceTotalAmount



  // 税率

  const taxRate = takeMatch(compact, [

    /税率[:：]?\s*([0-9]{1,2}\s*%)/,

    /([0-9]{1,2}\s*%)[:：]?\s*税率/,

  ]).replace(/\s/g, '')

  if (taxRate) fields.invoiceTaxRate = taxRate



  // 发票状态推断

  if (invoiceNumber || invoiceTotalAmount || sellerTaxNo) {

    fields.invoiceStatus = 'issued'

  }



  return fields

}



export function mergeRecognizedInvoiceFields(

  current: ReimbursementFormState,

  recognized: RecognizedInvoiceFields,

) {

  return {

    ...current,

    invoiceSellerName: current.invoiceSellerName || recognized.invoiceSellerName || '',

    invoiceSellerTaxNo: current.invoiceSellerTaxNo || recognized.invoiceSellerTaxNo || '',

    invoiceAmountExcludingTax:

      current.invoiceAmountExcludingTax || recognized.invoiceAmountExcludingTax || '',

    invoiceTaxAmount: current.invoiceTaxAmount || recognized.invoiceTaxAmount || '',

    invoiceTaxRate: current.invoiceTaxRate || recognized.invoiceTaxRate || '',

    invoiceTotalAmount: current.invoiceTotalAmount || recognized.invoiceTotalAmount || '',

    invoiceNumber: current.invoiceNumber || recognized.invoiceNumber || '',

    invoiceStatus:

      current.invoiceStatus === 'not_issued' && recognized.invoiceStatus

        ? recognized.invoiceStatus

        : current.invoiceStatus,

  } satisfies ReimbursementFormState

}



// 微信付款/转账截图：针对性字段提取
function extractWechatFields(text: string): RecognizedOrderFields {
  const normalized = normalizeOcrText(text)
  const compact = compactText(normalized)
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean)
  const fields: RecognizedOrderFields = { platformName: '微信' }

  let merchant = ''
  for (const line of lines) {
    for (const p of [/转账\s*[-—]\s*转给(.+)$/, /转给(.+)$/, /扫二维码付款\s*[-—]\s*给(.+)$/, /付款\s*[-—]\s*给(.+)$/, /给(.+?)付款$/]) {
      const m = line.match(p)
      if (m) {
        const cand = m[1].trim()
        if (cand.length >= 2 && cand.length <= 40) {
          merchant = cand
          break
        }
      }
    }
    if (merchant) break
  }
  if (!merchant) merchant = extractFromLines(lines, ['商户全称', '商户'], { stopAtColon: true }) || ''
  if (merchant) fields.merchantName = merchant.slice(0, 100)

  let item = extractFromLines(lines, ['商品名称', '商品信息', '订单内容', '商品'], { stopAtColon: true }) || ''
  if (!item) {
    item = extractFromLines(lines, ['转账说明', '付款方留言'], { stopAtColon: true }) || ''
    if (item === '微信转账' || item === '微信') item = ''
  }
  if (item) fields.itemDescription = item.slice(0, 100)

  const orderKeywords = ['交易单号', '商户单号', '转账单号', '服务单号', '订单编号', '订单号']
  for (const kw of orderKeywords) {
    const idx = compact.indexOf(kw)
    if (idx >= 0) {
      const m = compact.slice(idx + kw.length).match(/[0-9A-Za-z-]{8,35}/)
      if (m) {
        fields.orderNumber = m[0]
        break
      }
    }
  }
  if (!fields.orderNumber) {
    for (const line of lines) {
      const m = line.match(/\d{25,35}/)
      if (m) {
        fields.orderNumber = m[0]
        break
      }
    }
  }

  for (const kw of ['支付时间', '转账时间', '交易时间', '付款时间']) {
    for (const line of lines) {
      const idx = line.indexOf(kw)
      if (idx < 0) continue
      const tail = line.slice(idx + kw.length).replace(/[:：]/, ' ')
      const m = tail.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})[日]?\s*(\d{1,2})?[:：]?(\d{2})?/)
      if (m) {
        const hh = m[4] ? m[4].padStart(2, '0') : ''
        const mm = m[5] ? m[5].padStart(2, '0') : '00'
        fields.paymentTime = normalizePaymentTime(`${m[1]}-${m[2]}-${m[3]}${hh ? ` ${hh}:${mm}` : ''}`)
        break
      }
    }
    if (fields.paymentTime) break
  }

  const neg = compact.match(/[-−]\s*[￥¥]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/)
  if (neg) fields.paymentAmount = neg[1].replace(/,/g, '')
  if (!fields.paymentAmount) {
    const m = compact.match(/[￥¥]\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/)
    if (m) fields.paymentAmount = m[1].replace(/,/g, '')
  }
  if (!fields.paymentAmount) {
    const m = compact.match(/(?:支付金额|实付|付款金额|合计)[:：]?\s*[￥¥]?\s*([0-9]+(?:\.[0-9]{1,2})?)/)
    if (m) fields.paymentAmount = m[1]
  }

  return fields
}

// 闲鱼订单详情截图：针对性字段提取
function extractXianyuFields(text: string): RecognizedOrderFields {
  const normalized = normalizeOcrText(text)
  const compact = compactText(normalized)
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean)
  const fields: RecognizedOrderFields = { platformName: '闲鱼' }

  const cleanNick = (s: string) => s.replace(/[\s|]*(画小铺|鱼小铺)\s*$/, '').trim()
  let merchantName = ''
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.includes('卖家昵称')) continue
    const after = cleanNick(line.split('卖家昵称')[1]?.replace(/^[|:：\s]+/, '') ?? '')
    if (after && !/^[0-9.:：|>，,￥¥\-\s]+$/.test(after)) {
      merchantName = after
      break
    }
    for (const j of [i - 1, i + 1, i + 2]) {
      if (j < 0 || j >= lines.length) continue
      const cand = cleanNick(lines[j])
      if (cand && !/^[0-9.:：|>，,￥¥\-\s]+$/.test(cand) && !/\d{6,}|省|市|区|镇|收货|地址|复制|时间|单号|交易|下单|付款|发货|成交/.test(cand) && cand.length <= 30) {
        merchantName = cand
        break
      }
    }
    if (merchantName) break
  }
  if (merchantName) fields.merchantName = merchantName.slice(0, 100)

  let item = ''
  let titleIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.includes('成交价')) break
    const m = line.match(/^(.+?)\s*[￥¥]\s*\d/)
    if (m) {
      titleIdx = i
      item = m[1].trim()
      break
    }
    if (i + 1 < lines.length && /^[￥¥]\s*\d/.test(lines[i + 1]) && line.length >= 2) {
      titleIdx = i
      item = line
      break
    }
  }
  if (titleIdx >= 0) {
    for (let i = titleIdx + 1; i < lines.length; i += 1) {
      const line = lines[i]
      if (/成交价|订单编号|交易快照|收货地址|支付宝交易号|卖家昵称|下单时间/.test(line)) break
      if (/^[￥¥]\s*\d/.test(line)) continue
      const t = line.trim()
      if (t) item += t
    }
  }
  if (item) fields.itemDescription = item.slice(0, 100)

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes('成交价')) {
      let m = lines[i].match(/[￥¥]\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/)
      if (!m && i + 1 < lines.length) m = lines[i + 1].match(/[￥¥]\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/)
      if (m) fields.paymentAmount = m[1].replace(/,/g, '')
      break
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes('订单编号')) {
      let m = lines[i].split('订单编号')[1]?.match(/\d{15,30}/)
      if (!m && i + 1 < lines.length) m = lines[i + 1].match(/\d{15,30}/)
      if (!m && i - 1 >= 0) m = lines[i - 1].match(/\d{15,30}/)
      if (m) fields.orderNumber = m[0]
      break
    }
  }

  const timeRe = /(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})[日]?\s*(\d{1,2})?[:：]?(\d{2})?/
  for (const kw of ['付款时间', '支付时间']) {
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes(kw)) {
        let m = lines[i].match(timeRe)
        if (!m && i + 1 < lines.length) m = lines[i + 1].match(timeRe)
        if (!m && i - 1 >= 0) m = lines[i - 1].match(timeRe)
        if (m) {
          const hh = m[4] ? m[4].padStart(2, '0') : ''
          const mm = m[5] ? m[5].padStart(2, '0') : '00'
          fields.paymentTime = normalizePaymentTime(`${m[1]}-${m[2]}-${m[3]}${hh ? ` ${hh}:${mm}` : ''}`)
        }
        break
      }
    }
    if (fields.paymentTime) break
  }

  return fields
}

// 订单截图 OCR 字段提取（platform 为平台名，用于路由到针对性规则）
export function extractOrderFields(text: string, platform = ''): RecognizedOrderFields {
  const looksXianyu = platform === '闲鱼' || /感谢使用闲鱼|闲鱼集市/.test(text) || (/成交价/.test(text) && /卖家昵称|鱼小铺|画小铺/.test(text))
  if (looksXianyu) {
    return extractXianyuFields(text)
  }
  if (platform === '微信') {
    return extractWechatFields(text)
  }

  const normalized = normalizeOcrText(text)

  const compact = compactText(normalized)

  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean)

  const fields: RecognizedOrderFields = {}



  // 平台名称：从常见平台关键词中匹配

  const platformKeywords: Array<{ name: string; patterns: string[] }> = [

    { name: '淘宝', patterns: ['淘宝', 'taobao', '天猫'] },

    { name: '京东', patterns: ['京东', 'jd.com', 'jd'] },

    { name: '拼多多', patterns: ['拼多多', 'pinduoduo'] },

    { name: '1688', patterns: ['1688'] },

    { name: '抖音', patterns: ['抖音', 'douyin'] },

    { name: '美团', patterns: ['美团', 'meituan'] },

    { name: '京东到家', patterns: ['京东到家', '达达'] },

    { name: '淘宝买菜', patterns: ['淘宝买菜', '买菜'] },

    { name: '顺丰', patterns: ['顺丰', 'sf-express'] },

    { name: '微信', patterns: ['微信', 'wechat'] },

    { name: '支付宝', patterns: ['支付宝', 'alipay'] },

    { name: '闪送', patterns: ['闪送'] },

  ]

  for (const { name, patterns } of platformKeywords) {

    if (patterns.some((p) => compact.toLowerCase().includes(p.toLowerCase()))) {

      fields.platformName = name

      break

    }

  }



  // 商家名称

  const merchantName = extractFromLines(lines, ['店铺名称', '商家名称', '商家', '卖家'], { stopAtColon: true })

    || takeMatch(compact, [

      /(?:店铺名称|商家名称|商家|卖家)[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9（）()]+?)(?:订单|商品|金额|时间|$)/,

    ])

  if (merchantName) fields.merchantName = merchantName



  // 订单号

  const orderNumber = takeMatch(compact, [

    /(?:订单号|订单编号|单号|订单号)[:：]?\s*([0-9A-Za-z-]{8,30})/i,

    /(?:Order|No)[:：]?\s*([0-9A-Za-z-]{8,30})/i,

  ])

  if (orderNumber) fields.orderNumber = orderNumber



  // 支付时间

  const paymentTime = takeMatch(compact, [

    /(?:支付时间|付款时间|下单时间|成交时间|创建时间)[:：]?\s*([0-9]{4}[-/年][0-9]{1,2}[-/月][0-9]{1,2}[日]?(?:\s+[0-9]{1,2}[:：][0-9]{1,2}(?:[:：][0-9]{1,2})?)?)/,

    /([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}\s+[0-9]{1,2}:[0-9]{1,2})/,

  ])

  if (paymentTime) {

    fields.paymentTime = normalizePaymentTime(

      paymentTime

        .replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '')

        .replace(/\//g, '-')

        .trim(),

    )

  }



  // 支付金额

  const paymentAmount = normalizeAmount(

    takeMatch(compact, [

      /(?:实付金额|实付|支付金额|付款金额|金额|合计|总价|订单金额)[:：]?\s*[￥¥]?\s*([0-9]+(?:\.[0-9]{1,2})?)/,

      /[￥¥]\s*([0-9]+(?:\.[0-9]{1,2})?)/,

    ]),

  )

  if (paymentAmount) fields.paymentAmount = paymentAmount



  // 商品信息

  const itemDescription = extractFromLines(lines, ['商品名称', '商品信息', '商品', '订单内容'], { stopAtColon: true })

    || takeMatch(compact, [

      /(?:商品名称|商品信息|商品)[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9×x*\s]+?)(?:订单|金额|时间|数量|规格|$)/,

    ])

  if (itemDescription) {

    fields.itemDescription = itemDescription.slice(0, 100)

  }



  return fields

}



export function mergeRecognizedOrderFields(

  current: OrderFormState,

  recognized: RecognizedOrderFields,

): OrderFormState {

  return {

    ...current,

    platformName: current.platformName || recognized.platformName || current.platformName,

    merchantName: current.merchantName || recognized.merchantName || current.merchantName,

    itemDescription: current.itemDescription || recognized.itemDescription || current.itemDescription,

    orderNumber: current.orderNumber || recognized.orderNumber || current.orderNumber,

    paymentTime: current.paymentTime || normalizePaymentTime(recognized.paymentTime || '') || current.paymentTime,

    paymentAmount: current.paymentAmount || recognized.paymentAmount || current.paymentAmount,

  }

}



// 创建 Tesseract worker 的共用函数

// 把 File 读取为 HTMLImageElement

function fileToImageEl(file: File): Promise<HTMLImageElement> {

  return new Promise((resolve, reject) => {

    const image = new Image()

    image.onload = () => resolve(image)

    image.onerror = reject

    image.src = URL.createObjectURL(file)

  })

}



// 使用 pdfjs-dist（开源 PDF 渲染库，纯 JS、无原生依赖）把 PDF 首页渲染为图片，

// 这样后续 OCR 与预览逻辑可统一走图片流程。

async function renderPdfFirstPageToImage(file: File): Promise<File> {

  const pdfjs = await import('pdfjs-dist')

  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl



  const buffer = await file.arrayBuffer()

  const doc = await pdfjs.getDocument({ data: buffer, isEvalSupported: false }).promise

  const page = await doc.getPage(1)

  // 控制最大边长，避免过高分辨率拖累 OCR

  const targetWidth = 1600

  const viewport = page.getViewport({ scale: 1 })

  const scale = Math.min(2, targetWidth / viewport.width)

  const scaledViewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')

  canvas.width = Math.floor(scaledViewport.width)

  canvas.height = Math.floor(scaledViewport.height)

  const context = canvas.getContext('2d')

  if (!context) {

    throw new Error('无法初始化 canvas 用于 PDF 渲染')

  }

  await page.render({ canvasContext: context, viewport: scaledViewport }).promise



  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))

  if (!blob) {

    throw new Error('PDF 渲染失败')

  }

  return new File([blob], file.name.replace(/\.pdf$/i, '.jpg'), { type: 'image/jpeg' })

}



// 发票图像预处理：灰度化 + 自适应二值化（Otsu 阈值），针对标准发票版式显黑提白，

// 提升 tesseract 对数字 / 号码的识别准确率。这是开源、可离线的纯前端处理，无需新增服务端依赖。

async function preprocessForOcr(file: File): Promise<File> {

  const image = await fileToImageEl(file)

  // 限制最大边长，避免大图造成卡顿

  const maxEdge = 2000

  let width = image.width

  let height = image.height

  const scale = width > maxEdge || height > maxEdge ? Math.min(maxEdge / width, maxEdge / height) : 1

  if (scale < 1) {

    width = Math.floor(width * scale)

    height = Math.floor(height * scale)

  }

  const canvas = document.createElement('canvas')

  canvas.width = width

  canvas.height = height

  const ctx = canvas.getContext('2d')

  if (!ctx) return file

  ctx.drawImage(image, 0, 0, width, height)



  const imageData = ctx.getImageData(0, 0, width, height)

  const data = imageData.data



  // 灰度

  const gray = new Uint8ClampedArray(width * height)

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {

    gray[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0

  }



  // Otsu 阈值

  const hist = new Array(256).fill(0)

  for (let i = 0; i < gray.length; i++) hist[gray[i]]++

  const total = gray.length

  let sum = 0

  for (let i = 0; i < 256; i++) sum += i * hist[i]

  let sumB = 0

  let wB = 0

  let maxVar = -1

  let threshold = 127

  for (let i = 0; i < 256; i++) {

    wB += hist[i]

    if (wB === 0) continue

    const wF = total - wB

    if (wF === 0) break

    sumB += i * hist[i]

    const mB = sumB / wB

    const mF = (sum - sumB) / wF

    const between = wB * wF * (mB - mF) * (mB - mF)

    if (between > maxVar) {

      maxVar = between

      threshold = i

    }

  }



  // 二值化写入 RGBA

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {

    const v = gray[j] > threshold ? 255 : 0

    data[i] = v

    data[i + 1] = v

    data[i + 2] = v

    data[i + 3] = 255

  }

  ctx.putImageData(imageData, 0, 0)



  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))

  if (!blob) return file

  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })

}



// 把任意输入（图片或 PDF）准备为用于 OCR 的图像 File

async function prepareOcrImageFile(file: File): Promise<File> {

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {

    const rendered = await renderPdfFirstPageToImage(file)

    return preprocessForOcr(rendered)

  }

  return preprocessForOcr(file)

}



// 导出供预览使用：PDF 渲染为图片缩略图

export async function preparePreviewFile(file: File): Promise<File> {

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {

    return renderPdfFirstPageToImage(file)

  }

  return file

}



async function createOcrWorker(

  file: File,

  onProgress?: (progress: number, status: string) => void,

) {

  // tesseract.js：开源 OCR 引擎，支持中文简 + 英文

  // 针对发票版式启用 PSM 6（统一文本块）以提升结构化字段提取稳定性

  const ocrFile = await prepareOcrImageFile(file)

  const Tesseract = await import('tesseract.js')

  const baseUrl = import.meta.env.BASE_URL || '/'

  const worker = await Tesseract.createWorker(['chi_sim', 'eng'], Tesseract.OEM.DEFAULT, {

    // 本地化 tesseract worker / core / 语言包，避免依赖外网 CDN（国内网络不可达时识别直接失败）

    workerPath: `${baseUrl}tesseract/worker.min.js`,

    corePath: `${baseUrl}tesseract/tesseract-core.wasm.js`,

    langPath: `${baseUrl}tessdata/`,

    logger: (message: { progress: number; status: string }) => {

      onProgress?.(message.progress, message.status)

    },

  })



  try {

    await worker.setParameters({

      preserve_interword_spaces: '1',

      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,

    })

    const result = await worker.recognize(ocrFile)

    return result

  } finally {

    await worker.terminate()

  }

}



// 本地 OCR 服务地址（本机 GPU 加速 PaddleOCR + PDF 文本层秒级提取）

export const LOCAL_OCR_BASE = 'http://127.0.0.1:8001'

const LOCAL_OCR_TIMEOUT_MS = 60_000

// 读取本地 OCR 服务版本号（用于网页端提示升级）
export async function getLocalOcrVersion(timeoutMs = 3000): Promise<string> {
  try {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    const resp = await fetch(`${LOCAL_OCR_BASE}/api/v1/version`, {
      signal: controller.signal,
      mode: 'cors',
    })
    window.clearTimeout(timer)
    if (!resp.ok) return ''
    const data = (await resp.json()) as { version?: string }
    return data.version || ''
  } catch {
    return ''
  }
}



// 本地服务健康探测：快速失败（300ms），不阻塞页面
export async function checkLocalOcrHealth(timeoutMs = 800): Promise<boolean> {
  try {

    const controller = new AbortController()

    const timer = window.setTimeout(() => controller.abort(), timeoutMs)

    const resp = await fetch(`${LOCAL_OCR_BASE}/api/v1/health`, {

      signal: controller.signal,

      mode: 'cors',

    })

    window.clearTimeout(timer)

    return resp.ok

  } catch {

    return false

  }

}



// 直接调用本地 OCR 服务（与服务器版响应结构一致）

async function recognizeInvoiceViaLocal(

  file: File,

  onProgress?: (progress: number, status: string) => void,

): Promise<InvoiceOcrResult> {

  onProgress?.(0.05, '上传发票到本地 OCR')

  const form = new FormData()

  form.append('file', file, file.name || 'invoice')



  const controller = new AbortController()

  const timer = window.setTimeout(() => controller.abort(), LOCAL_OCR_TIMEOUT_MS)

  try {

    onProgress?.(0.3, '本地 GPU OCR 识别中')

    const resp = await fetch(`${LOCAL_OCR_BASE}/api/v1/ocr`, {

      method: 'POST',

      body: form,

      signal: controller.signal,

      mode: 'cors',

    })

    if (!resp.ok) {

      const text = await resp.text().catch(() => '')

      throw new Error(`本地 OCR 服务返回 ${resp.status}: ${text.slice(0, 120)}`)

    }

    const data = (await resp.json()) as BackendOcrResponse

    onProgress?.(0.92, '解析字段')

    const page1 = data.fields[0]

    const fields = page1 ? mapBackendToInvoiceFields(page1) : {}

    const confidence = page1?._meta?.avg_confidence ?? 0
    onProgress?.(1, '完成')
    return {
      text: '',
      confidence,
      fields,
      source: 'local',
    }
  } finally {
    window.clearTimeout(timer)
  }
}


export async function recognizeInvoiceFromImage(

  file: File,

  onProgress?: (progress: number, status: string) => void,

): Promise<InvoiceOcrResult> {
  // 兼容所有用户电脑：仅做一次快速健康探测（约 0.8s），本地 OCR 服务恰好运行时才走本地；
  // 未安装/未运行本地程序的电脑一律立即走服务器端 OCR，不唤起外部协议、不做长时间等待。
  // 发票格式固定：发票识别始终走强化版发票 OCR（本地 PaddleOCR 优先，服务器 OCR 兜底），
  // 不随订单识别方式 / 右侧平台选择变化。
  try {
    if (await checkLocalOcrHealth(800)) {
      return await recognizeInvoiceViaLocal(file, onProgress)
    }
    return await recognizeInvoiceViaBackend(file, onProgress)
  } catch (error) {
    // 本地调用出错时回退服务器端 OCR

    try {

      return await recognizeInvoiceViaBackend(file, onProgress)

    } catch {

      throw error

    }

  }

}



export async function recognizeOrderFromImage(
  file: File,
  onProgress?: (progress: number, status: string) => void,
  platform = '',
): Promise<OrderOcrResult> {
  // 兼容所有用户电脑：本地 OCR 服务优先（快速探测），失败立即回退浏览器 tesseract
  if (getOcrPreference() === 'server') {
    const result = await createOcrWorker(file, onProgress)
    return {
      text: result.data.text,
      confidence: result.data.confidence,
      fields: extractOrderFields(result.data.text, platform),
      source: 'tesseract',
    }
  }
  try {
    if (await checkLocalOcrHealth(800)) {
      return await recognizeOrderViaLocal(file, onProgress, platform)
    }
  } catch {
    // 本地调用出错时回退浏览器 tesseract
  }
  const result = await createOcrWorker(file, onProgress)

  return {
    text: result.data.text,
    confidence: result.data.confidence,
    fields: extractOrderFields(result.data.text, platform),
    source: 'tesseract',
  }
}

// 调用本地 OCR 服务的订单识别接口
async function recognizeOrderViaLocal(
  file: File,
  onProgress?: (progress: number, status: string) => void,
  platform = '',
): Promise<OrderOcrResult> {
  onProgress?.(0.05, '上传订单到本地 OCR')
  const form = new FormData()
  form.append('file', file, file.name || 'order')
  if (platform) form.append('platform', platform)

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), LOCAL_OCR_TIMEOUT_MS)
  try {
    onProgress?.(0.3, '本地 OCR 识别中')
    const resp = await fetch(`${LOCAL_OCR_BASE}/api/v1/order-ocr`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      mode: 'cors',
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`本地 OCR 服务返回 ${resp.status}: ${text.slice(0, 120)}`)
    }
    const data = (await resp.json()) as {
      fields: RecognizedOrderFields
      text?: string
      confidence?: number
    }
    onProgress?.(0.92, '解析字段')
    onProgress?.(1, '完成')
    return {
      text: data.text ?? '',
      confidence: data.confidence ?? 0,
      fields: data.fields ?? {},
      source: 'local',
    }
  } finally {
    window.clearTimeout(timer)
  }
}


// ---------------------------------------------------------------------------

// 3.2 新增：服务器端 OCR（中国制式发票）

// ---------------------------------------------------------------------------



type BackendOcrField = {

  invoice_code: string | null

  invoice_no: string | null

  invoice_date: string | null

  buyer_name: string | null

  buyer_tax_id: string | null

  seller_name: string | null

  seller_tax_id: string | null

  total_amount: number | null

  total_tax: number | null

  tax_rate: number | null

  grand_total: number | null

  grand_total_uppercase: string | null

  remark: string | null

  issuer: string | null

  receiver: string | null

  reviewer: string | null

  _meta?: { block_count: number; avg_confidence: number; warnings: string[]; page: number }

}



type BackendOcrResponse = {

  file_id: string

  filename: string

  file_type: string

  file_size: number

  pages: number

  fields: BackendOcrField[]

  cost_ms: number

}



function numToStr(v: number | null | undefined): string {

  if (v === null || v === undefined || Number.isNaN(v)) return ''

  return Number.isInteger(v) ? String(v) : v.toFixed(2)

}



function rateToStr(v: number | null | undefined): string {

  // 后端统一返回 0-100 范围的数字（1.0 = 1%、13.0 = 13%）。

  // 早期版本曾用 v <= 1 判断是否乘 100，但当税率恰好为 1% / 13% 时会误判并翻 100 倍。

  // 现在直接按 0-100 范围格式化，不再做范围推断。

  if (v === null || v === undefined || Number.isNaN(v)) return ''

  const rounded = Math.round(v * 100) / 100

  return `${rounded}%`

}



// 把后端数字字段计算成 invoiceTaxRate 字符串（兜底用）

function computeTaxRateStr(

  totalAmount: number | null | undefined,

  totalTax: number | null | undefined,

  taxRate: number | null | undefined,

): string {

  // 优先用后端给的 tax_rate（已经是 0-100 范围的数字）

  if (typeof taxRate === 'number' && Number.isFinite(taxRate) && taxRate > 0) {

    return rateToStr(taxRate)

  }

  // 兜底：total_tax / total_amount * 100

  if (

    typeof totalAmount === 'number' && totalAmount > 0 &&

    typeof totalTax === 'number' && totalTax > 0

  ) {

    const ratio = (totalTax / totalAmount) * 100

    return rateToStr(Math.round(ratio * 100) / 100)

  }

  return ''

}



function mapBackendToInvoiceFields(b: BackendOcrField): RecognizedInvoiceFields {

  const fields: RecognizedInvoiceFields = {}

  if (b.seller_name) fields.invoiceSellerName = b.seller_name

  if (b.seller_tax_id) fields.invoiceSellerTaxNo = b.seller_tax_id

  if (b.total_amount !== null) fields.invoiceAmountExcludingTax = numToStr(b.total_amount)

  if (b.total_tax !== null) fields.invoiceTaxAmount = numToStr(b.total_tax)

  if (b.grand_total !== null) fields.invoiceTotalAmount = numToStr(b.grand_total)

  if (b.invoice_no) fields.invoiceNumber = b.invoice_no

  // 税率：后端字段优先，再用 total_tax / total_amount 兜底

  const taxRateStr = computeTaxRateStr(b.total_amount, b.total_tax, b.tax_rate)

  if (taxRateStr) fields.invoiceTaxRate = taxRateStr

  if (b.invoice_no || b.grand_total !== null || b.seller_tax_id) {

    fields.invoiceStatus = 'issued'

  }

  return fields

}



// 估算识别耗时（毫秒）：PDF 比图片慢，按文件大小线性插值

function estimateOcrDurationMs(file: File): number {

  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

  const base = isPdf ? 55_000 : 22_000

  const sizeFactor = Math.min(file.size / 500_000, 2) // 0.5MB 基准，最大 2x

  return Math.round(base * (0.7 + 0.3 * sizeFactor))

}



export async function recognizeInvoiceViaBackend(

  file: File,

  onProgress?: (progress: number, status: string) => void,

): Promise<InvoiceOcrResult> {

  onProgress?.(0.05, '上传发票')



  const form = new FormData()

  form.append('file', file, file.name || 'invoice')



  // 启动客户端进度 ticker：从 0.15 平滑插值到 0.85，按文件大小估算耗时

  // 后端无流式进度推送，纯前端平滑展示避免进度条卡 15%

  const expectedMs = estimateOcrDurationMs(file)

  const startTs = performance.now()

  let lastReported = 0.15

  const tick = window.setInterval(() => {

    const elapsed = performance.now() - startTs

    // 缓动曲线：0.15 → 0.85，使用 sqrt 让前段快、后段慢，更接近真实识别节奏

    const ratio = Math.min(elapsed / expectedMs, 1)

    const eased = Math.sqrt(ratio)

    const p = 0.15 + eased * 0.7

    if (p > lastReported) {

      lastReported = p

      onProgress?.(p, 'OCR 引擎识别中')

    }

  }, 400)



  onProgress?.(0.15, 'OCR 引擎识别中')

  let data: BackendOcrResponse

  try {

    data = await api.post<BackendOcrResponse>(

      '/api/recognition/invoice-ocr',

      form,

      true,

    )

  } finally {

    window.clearInterval(tick)

  }



  onProgress?.(0.92, '解析字段')

  const page1 = data.fields[0]

  const fields = page1 ? mapBackendToInvoiceFields(page1) : {}

  const confidence = page1?._meta?.avg_confidence ?? 0



  onProgress?.(1, '完成')
  return {
    text: '',
    confidence,
    fields,
    source: 'server',
  }
}
