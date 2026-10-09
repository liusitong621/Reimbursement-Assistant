import type { InvoiceStatus, PaymentMode, ReimbursementRecord, ReimbursementStatus, UserOption } from '@/lib/types'

export const platformCategoryOptions = [
  '购物平台',
  '闪送/外卖平台',
  '快递平台',
  '差旅平台',
  '直接付款',
  '线下支付',
] as const

export const platformNameOptionsByCategory: Record<(typeof platformCategoryOptions)[number], readonly string[]> = {
  购物平台: ['淘宝', '京东', '拼多多', '1688', '抖音', '闲鱼', '其他'],
  '闪送/外卖平台': ['京东秒送', '淘宝闪购', '美团', '其他'],
  快递平台: ['顺丰', '京东', '邮政', '其他'],
  差旅平台: ['火车高铁', '飞机', '打车', '其他'],
  直接付款: ['微信', '支付宝', '云闪付', '银行卡', '其他'],
  线下支付: ['有纸质收据', '无纸质收据'],
}

// 已做针对性 OCR 强化的平台名（前端选项自动显示绿色 PRO 标记，识别时按平台路由到对应规则）
export const targetedPlatformNames = ['闲鱼', '微信'] as const

export const orderStatusOptions = [
  '未付款',
  '已付款未发货',
  '待收货',
  '已完成',
  '退货中未到账',
  '退货完成',
] as const

export const invoiceStatusOptions: Array<{ value: InvoiceStatus; label: string }> = [
  { value: 'none', label: '无发票' },
  { value: 'not_issued', label: '未开票' },
  { value: 'waiting_issued', label: '等待开票中' },
  { value: 'issued', label: '已开票' },
]

export const paymentModeOptions: Array<{ value: PaymentMode; label: string }> = [
  { value: 'personal_reimbursement', label: '个人垫资需报销' },
  { value: 'reserve_fund', label: '该订单使用备用金' },
]

export type OrderFormState = {
  // 3.0：携带子订单 DB id，后端 PATCH 路由据此做 upsert，避免编辑后清空已有附件。
  id?: string
  sequence: number
  platformCategory: string
  platformName: string
  platformNameOther: string
  merchantName: string
  itemDescription: string
  orderNumber: string
  paymentTime: string
  paymentAmount: string
  orderStatus: string
  note: string
  purchaserId: string
  userIds: string[]
  paymentMode: PaymentMode
}

export type AmountStandard = 'invoice' | 'orders'

export type ReimbursementFormState = {
  title: string
  categoryId: string
  invoiceSellerName: string
  invoiceSellerTaxNo: string
  invoiceAmountExcludingTax: string
  invoiceTaxAmount: string
  invoiceTaxRate: string
  invoiceTotalAmount: string
  invoiceNumber: string
  invoiceStatus: InvoiceStatus
  status: ReimbursementStatus
  amountStandard: AmountStandard | ''
  amountMismatchNote: string
  orders: OrderFormState[]
}

export function createEmptyOrder(sequence: number): OrderFormState {
  return {
    sequence,
    platformCategory: '购物平台',
    platformName: '',
    platformNameOther: '',
    merchantName: '',
    itemDescription: '',
    orderNumber: '',
    paymentTime: '',
    paymentAmount: '',
    orderStatus: '未付款',
    note: '',
    purchaserId: '',
    userIds: [],
    paymentMode: 'personal_reimbursement',
  }
}

export function createEmptyReimbursement(): ReimbursementFormState {
  return {
    title: '',
    categoryId: '',
    invoiceSellerName: '',
    invoiceSellerTaxNo: '',
    invoiceAmountExcludingTax: '',
    invoiceTaxAmount: '',
    invoiceTaxRate: '',
    invoiceTotalAmount: '',
    invoiceNumber: '',
    invoiceStatus: 'not_issued',
    status: 'draft',
    amountStandard: '',
    amountMismatchNote: '',
    orders: [createEmptyOrder(1)],
  }
}

function normalizePlatformSelection(platformCategory: string, platformName: string) {
  const platformOptions =
    platformNameOptionsByCategory[platformCategory as keyof typeof platformNameOptionsByCategory] ?? []
  const useOtherPlatform = platformOptions.length > 0 && !platformOptions.includes(platformName)

  return {
    platformName: useOtherPlatform ? '其他' : platformName,
    platformNameOther: useOtherPlatform ? platformName : '',
  }
}

export function reimbursementToForm(record: ReimbursementRecord): ReimbursementFormState {
  return {
    title: record.title,
    categoryId: record.categoryId ?? '',
    invoiceSellerName: record.invoiceSellerName,
    invoiceSellerTaxNo: record.invoiceSellerTaxNo,
    invoiceAmountExcludingTax: String(record.invoiceAmountExcludingTax),
    invoiceTaxAmount: String(record.invoiceTaxAmount),
    invoiceTaxRate: record.invoiceTaxRate,
    invoiceTotalAmount: String(record.invoiceTotalAmount),
    invoiceNumber: record.invoiceNumber,
    invoiceStatus: record.invoiceStatus,
    status: record.status,
    amountStandard: record.amountStandard ?? 'invoice',
    amountMismatchNote: record.amountMismatchNote ?? '',
    orders: record.orders.map((order) => {
      const normalizedPlatform = normalizePlatformSelection(order.platformCategory, order.platformName)

      return {
        // 3.0：把后端给的子订单 DB id 带回表单，便于 PATCH 时做 upsert。
        id: order.id,
        sequence: order.sequence,
        platformCategory: order.platformCategory,
        platformName: normalizedPlatform.platformName,
        platformNameOther: normalizedPlatform.platformNameOther,
        merchantName: order.merchantName,
        itemDescription: order.itemDescription,
        orderNumber: order.orderNumber,
        paymentTime: normalizePaymentTime(order.paymentTime),
        paymentAmount: String(order.paymentAmount),
        orderStatus: order.orderStatus,
        note: order.note,
        purchaserId: order.purchaserId ?? '',
        userIds: order.userIds,
        paymentMode: order.paymentMode,
      }
    }),
  }
}

export function normalizePaymentTime(value: string): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''
  // 已是补零的 YYYY-MM-DD HH:MM[:SS] 直接补秒
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    return trimmed.length === 16 ? trimmed + ':00' : trimmed
  }
  // datetime-local 值 YYYY-MM-DDTHH:MM[:SS]
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    return trimmed.replace('T', ' ').slice(0, 16) + ':00'
  }
  // 通用解析：兼容 - / 年月日 分隔、可省略补零、可选时分秒（OCR 常见输出）
  const m = trimmed.match(
    /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})[日]?(?:\s+(\d{1,2})[:：](\d{1,2})(?::(\d{1,2}))?)?$/,
  )
  if (m) {
    const [, year, month, day, hour, minute, second] = m
    const pad = (n: string) => n.padStart(2, '0')
    const time = hour
      ? `${pad(hour)}:${pad(minute)}${second ? ':' + pad(second) : ':00'}`
      : '00:00:00'
    return `${year}-${pad(month)}-${pad(day)} ${time}`
  }
  return trimmed
}

export function buildPayload(form: ReimbursementFormState) {
  return {
    title: form.title,
    categoryId: form.categoryId || null,
    invoiceSellerName: form.invoiceSellerName,
    invoiceSellerTaxNo: form.invoiceSellerTaxNo,
    invoiceAmountExcludingTax: Number(form.invoiceAmountExcludingTax || 0),
    invoiceTaxAmount: Number(form.invoiceTaxAmount || 0),
    invoiceTaxRate: form.invoiceTaxRate,
    invoiceTotalAmount: Number(form.invoiceTotalAmount || 0),
    invoiceNumber: form.invoiceNumber,
    invoiceStatus: form.invoiceStatus,
    status: form.status,
    amountStandard: form.amountStandard || 'orders',
    amountMismatchNote: form.amountMismatchNote,
    orders: form.orders.map((order, index) => ({
      // 3.0：携带子订单 id，后端据此判断是 update 还是 create。
      id: order.id,
      sequence: order.sequence || index + 1,
      platformCategory: order.platformCategory,
      platformName: order.platformName === '其他' ? order.platformNameOther.trim() || '其他' : order.platformName,
      merchantName: order.merchantName,
      itemDescription: order.itemDescription,
      orderNumber: order.orderNumber,
      paymentTime: normalizePaymentTime(order.paymentTime),
      paymentAmount: Number(order.paymentAmount || 0),
      orderStatus: order.orderStatus,
      note: order.note,
      purchaserId: order.purchaserId || undefined,
      userIds: order.userIds,
      paymentMode: order.paymentMode,
    })),
  }
}

export function getPaymentAmountTotal(form: ReimbursementFormState) {
  return form.orders.reduce((sum, order) => sum + Number(order.paymentAmount || 0), 0)
}

export type ExistingNumbers = {
  invoiceNumbers: string[]
  orderNumbers: string[]
}

// 4.0.3: 计算与已有记录重复的发票号 / 订单号。
// self 用于编辑场景：排除本单自身已存在的编号，避免把自己的编号误判为重复。
export function findDuplicateNumbers(
  invoiceNumber: string,
  orderNumbers: string[],
  existing: ExistingNumbers,
  self: { invoiceNumber?: string; orderNumbers?: string[] } = {},
): { invoice: string | null; orders: Record<number, string> } {
  const invoice = invoiceNumber.trim()
  const invoiceSet = new Set(existing.invoiceNumbers)
  const orderSet = new Set(existing.orderNumbers)
  const selfInvoice = (self.invoiceNumber ?? '').trim()
  const selfOrders = new Set((self.orderNumbers ?? []).map((number) => number.trim()).filter(Boolean))

  const invoiceDuplicate = invoice && invoice !== selfInvoice && invoiceSet.has(invoice) ? invoice : null

  const orders: Record<number, string> = {}
  const seenIndex = new Map<string, number>()
  orderNumbers.map((number) => number.trim()).forEach((value, index) => {
    if (!value) return
    // 同一张报销单内订单号重复
    if (seenIndex.has(value)) {
      const firstIndex = seenIndex.get(value) as number
      orders[index] = value
      if (!(firstIndex in orders)) orders[firstIndex] = value
      return
    }
    seenIndex.set(value, index)
    // 与已有记录重复（排除本单自身已存在的编号）
    if (!selfOrders.has(value) && orderSet.has(value)) {
      orders[index] = value
    }
  })

  return { invoice: invoiceDuplicate, orders }
}

export function getUserLabel(users: UserOption[], id: string) {
  return users.find((user) => user.id === id)?.displayName ?? '-'
}
