// 服务端复刻"查看与导出"页面的排序逻辑（与 src/pages/RecordsPage.tsx 保持一致），
// 保证导出的 xlsx 行顺序与附件合集 PDF 页面顺序都跟随页面当前选择的排序。
// 若两处逻辑需要调整，必须同步修改。

export type RecordSortRow = Record<string, unknown>

// 可排序列清单（与前端 sortableColumnKeys 完全一致）：
// 文字列按拼音首字母排序、数字列按数值大小、时间列按时间先后。
export const sortableColumnKeys = new Set<string>([
  'parentChildMarker',
  'categoryName',
  'parentInvoiceNumber',
  'rejectionReason',
  'invoiceStatus',
  'invoiceTotalAmount',
  'amountStandard',
  'platformName',
  'itemDescription',
  'paymentTime',
  'paymentAmount',
  'note',
  'purchaserName',
  'paymentMode',
  'title',
  'creatorName',
  'status',
  'invoiceSellerName',
  'amountMismatchNote',
  'platformCategory',
  'merchantName',
  'userNames',
  'createdAt',
  'updatedAt',
  'orderStatus',
])

const numericSortColumns = new Set<string>([
  'parentInvoiceNumber',
  'invoiceTotalAmount',
  'paymentAmount',
])

const timeSortColumns = new Set<string>(['paymentTime', 'createdAt', 'updatedAt'])

// 排序依据使用单元格"显示的中文内容"，而不是底层英文枚举值。
const reimbursementStatusLabels: Record<string, string> = {
  draft: '草稿',
  unfinished: '未完结报销',
  pending_review: '待审核',
  needs_revision: '待修改',
  completed: '已办结',
  reimbursed: '已报销',
}

const invoiceStatusLabels: Record<string, string> = {
  none: '无发票',
  not_issued: '未开票',
  waiting_issued: '等待开票中',
  issued: '已开票',
}

const paymentModeLabels: Record<string, string> = {
  personal_reimbursement: '个人垫资需报销',
  reserve_fund: '该订单使用备用金',
}

const amountStandardLabels: Record<string, string> = {
  invoice: '以发票金额为准',
  orders: '以订单金额为准',
}

export function sortDisplayValue(row: RecordSortRow, column: string): string {
  const raw = String(row[column] ?? '')
  if (column === 'status') return reimbursementStatusLabels[raw] ?? raw
  if (column === 'invoiceStatus') return invoiceStatusLabels[raw] ?? raw
  if (column === 'paymentMode') return paymentModeLabels[raw] ?? raw
  if (column === 'amountStandard') return amountStandardLabels[raw] ?? raw
  return raw
}

// 兼容 "2026-08-05 15:05:00"、"2026-8-4"、"2026-8-4 9:5" 等混合时间格式。
export function parseTimeValue(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  const text = String(value ?? '').trim()
  if (!text) return Number.NEGATIVE_INFINITY
  const parsed = new Date(text.replace(' ', 'T'))
  if (!Number.isNaN(parsed.getTime())) return parsed.getTime()
  // 兜底：非补零格式 YYYY-M-D[ H:mm[:ss]]
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
  if (match) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match
    const manual = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
    if (!Number.isNaN(manual.getTime())) return manual.getTime()
  }
  return Number.NEGATIVE_INFINITY
}

// 数字比较：超长数字串（如 28 位发票号）用 BigInt 保证精确排序，普通数值用 Number。
export function compareNumeric(a: unknown, b: unknown): number {
  const leftText = String(a ?? '').trim()
  const rightText = String(b ?? '').trim()
  const isIntegerText = (text: string) => /^-?\d+$/.test(text)
  if (isIntegerText(leftText) && isIntegerText(rightText)) {
    try {
      const leftBig = leftText === '' ? BigInt(0) : BigInt(leftText)
      const rightBig = rightText === '' ? BigInt(0) : BigInt(rightText)
      return leftBig < rightBig ? -1 : leftBig > rightBig ? 1 : 0
    } catch {
      // 非整数串走 Number 比较
    }
  }
  const left = leftText === '' ? 0 : Number(leftText)
  const right = rightText === '' ? 0 : Number(rightText)
  return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0)
}

export function compareRecordColumn(a: RecordSortRow, b: RecordSortRow, column: string): number {
  if (numericSortColumns.has(column)) {
    return compareNumeric(a[column], b[column])
  }
  if (timeSortColumns.has(column)) {
    return parseTimeValue(a[column]) - parseTimeValue(b[column])
  }
  return sortDisplayValue(a, column).localeCompare(sortDisplayValue(b, column), 'zh-Hans-CN')
}

export function sortRecordRows<T>(
  rows: T[],
  column: string,
  direction: 'asc' | 'desc',
): T[] {
  if (!sortableColumnKeys.has(column)) return rows
  const sorted = [...rows].sort((a, b) =>
    compareRecordColumn(a as RecordSortRow, b as RecordSortRow, column),
  )
  return direction === 'asc' ? sorted : sorted.reverse()
}
