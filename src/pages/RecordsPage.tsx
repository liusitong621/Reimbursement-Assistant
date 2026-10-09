import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Banknote, CheckCheck, ChevronLeft, ChevronRight, ChevronsUpDown, Download, Minus, Plus, RefreshCcw, Search, Trash2, X } from 'lucide-react'
import { ShellLayout } from '@/components/ShellLayout'
import { InvoiceStatusBadge, PaymentModeBadge, ReimbursementStatusBadge } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { categoriesApi } from '@/lib/categories'
import type { Category, ExportResult, InvoiceStatus, PaymentMode, RecordRow, ReimbursementRecord, ReimbursementStatus, UserOption } from '@/lib/types'
import { useAuthStore } from '@/store/authStore'
import {
  formatCurrency,
  formatDateTime,
  getInvoiceStatusLabel,
  getPaymentModeLabel,
  getReimbursementStatusLabel,
} from '@/utils/format'

const preferenceStorageKey = 'fp-records-column-preferences-v3'
const legacyPreferenceStorageKey = 'fp-records-column-preferences-v2'
const tableZoomStorageKey = 'fp-records-table-zoom-v1'
const columnWidthsStorageKey = 'fp-records-column-widths-v1'
const MIN_COLUMN_WIDTH = 60
const checkboxColumnWidth = 40
const fixedColumnDefaultWidths: Record<string, number> = {
  action: 150,
  orderStatus: 110,
  statusBadge: 140,
}
const zoomOptions = [85, 100, 115, 130] as const

type ColumnConfig = {
  key: keyof RecordRow
  label: string
  defaultVisible: boolean
  width: number
  lines: 2 | 3
}

const columnConfigs: ColumnConfig[] = [
  { key: 'parentChildMarker', label: '子母标记', defaultVisible: true, width: 92, lines: 2 },
  { key: 'categoryName', label: '报销分类', defaultVisible: true, width: 130, lines: 2 },
  { key: 'parentInvoiceNumber', label: '所属母单发票号', defaultVisible: true, width: 170, lines: 2 },
  { key: 'title', label: '报销标题', defaultVisible: false, width: 210, lines: 3 },
  { key: 'creatorName', label: '填写人', defaultVisible: false, width: 120, lines: 2 },
  { key: 'status', label: '报销单状态', defaultVisible: false, width: 130, lines: 2 },
  { key: 'rejectionReason', label: '驳回原因', defaultVisible: true, width: 200, lines: 3 },
  { key: 'invoiceStatus', label: '发票状态', defaultVisible: true, width: 120, lines: 2 },
  { key: 'invoiceNumber', label: '发票号码', defaultVisible: true, width: 170, lines: 2 },
  { key: 'invoiceSellerName', label: '销售方名称', defaultVisible: false, width: 200, lines: 3 },
  { key: 'invoiceTotalAmount', label: '发票价税合计', defaultVisible: true, width: 140, lines: 2 },
  { key: 'amountStandard', label: '金额报销标准', defaultVisible: true, width: 14, lines: 2 },
  { key: 'amountMismatchNote', label: '金额差异说明', defaultVisible: false, width: 24, lines: 3 },
  { key: 'platformCategory', label: '平台分类', defaultVisible: false, width: 140, lines: 2 },
  { key: 'platformName', label: '订单平台', defaultVisible: true, width: 150, lines: 2 },
  { key: 'merchantName', label: '商家名称', defaultVisible: false, width: 180, lines: 3 },
  { key: 'itemDescription', label: '订单商品信息', defaultVisible: true, width: 230, lines: 3 },
  { key: 'orderNumber', label: '订单号', defaultVisible: true, width: 180, lines: 2 },
  { key: 'paymentTime', label: '订单支付时间', defaultVisible: true, width: 170, lines: 2 },
  { key: 'paymentAmount', label: '订单支付金额', defaultVisible: true, width: 130, lines: 2 },
  { key: 'note', label: '订单备注', defaultVisible: true, width: 230, lines: 3 },
  { key: 'purchaserName', label: '采购人', defaultVisible: true, width: 130, lines: 2 },
  { key: 'userNames', label: '使用人', defaultVisible: false, width: 200, lines: 3 },
  { key: 'paymentMode', label: '报销方式', defaultVisible: true, width: 145, lines: 2 },
  { key: 'invoiceAttachmentUrl', label: '发票截图', defaultVisible: false, width: 110, lines: 2 },
  { key: 'orderAttachmentUrl', label: '订单截图', defaultVisible: false, width: 110, lines: 2 },
  { key: 'createdAt', label: '创建时间', defaultVisible: false, width: 170, lines: 2 },
  { key: 'updatedAt', label: '更新时间', defaultVisible: false, width: 170, lines: 2 },
]

const defaultColumnKeys = columnConfigs.filter((column) => column.defaultVisible).map((column) => column.key)
const columnLabelMap = Object.fromEntries(columnConfigs.map((column) => [column.key, column.label])) as Record<keyof RecordRow, string>

// 订单状态列固定在操作列右侧展示（不可隐藏、不可移动），仍参与排序与导出。
const orderStatusColumnConfig: ColumnConfig = { key: 'orderStatus', label: '订单状态', defaultVisible: true, width: 110, lines: 2 }

// 可排序列清单（按用户确认的规则）：
// - 文字列：按单元格显示内容的拼音首字母排序
// - 数字列：所属母单发票号 / 发票价税合计 / 订单支付金额 按数值大小排序
// - 时间列：订单支付时间 / 创建时间 / 更新时间 按时间先后排序
// 发票号码、订单号、发票截图、订单截图 不提供排序。
const sortableColumnKeys = new Set<keyof RecordRow>([
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

const numericSortColumns = new Set<keyof RecordRow>(['parentInvoiceNumber', 'invoiceTotalAmount', 'paymentAmount'])
const timeSortColumns = new Set<keyof RecordRow>(['paymentTime', 'createdAt', 'updatedAt'])

const amountStandardLabels: Record<string, string> = {
  invoice: '以发票金额为准',
  orders: '以订单金额为准',
}

// 排序依据使用单元格"显示的中文内容"，而不是底层英文枚举值。
function sortDisplayValue(row: RecordRow, column: keyof RecordRow): string {
  const raw = String(row[column] ?? '')
  if (column === 'status') return getReimbursementStatusLabel(raw as ReimbursementStatus) ?? raw
  if (column === 'invoiceStatus') return getInvoiceStatusLabel(raw as InvoiceStatus) ?? raw
  if (column === 'paymentMode') return getPaymentModeLabel(raw as PaymentMode) ?? raw
  if (column === 'amountStandard') return amountStandardLabels[raw] ?? raw
  return raw
}

// 兼容 "2026-08-05 15:05:00"、"2026-8-4"、"2026-8-4 9:5" 等混合时间格式。
function parseTimeValue(value: unknown): number {
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
function compareNumeric(a: unknown, b: unknown): number {
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

function compareRecordColumn(a: RecordRow, b: RecordRow, column: keyof RecordRow) {
  if (numericSortColumns.has(column)) {
    return compareNumeric(a[column], b[column])
  }

  if (timeSortColumns.has(column)) {
    return parseTimeValue(a[column]) - parseTimeValue(b[column])
  }

  return sortDisplayValue(a, column).localeCompare(sortDisplayValue(b, column), 'zh-Hans-CN')
}

type TimeMode = 'range' | 'point'
type TimeDirection = 'after' | 'before'

type BatchStatusResult = {
  processedCount: number
  skippedCount: number
  skippedReasons: string[]
}

type FiltersState = {
  keyword: string
  status: string
  invoiceStatus: string
  paymentMode: string
  creatorId: string
  purchaserId: string
  createdMode: TimeMode
  createdFrom: string
  createdTo: string
  createdPoint: string
  createdPointDirection: TimeDirection
  paymentModeType: TimeMode
  paymentFrom: string
  paymentTo: string
  paymentPoint: string
  paymentPointDirection: TimeDirection
  categoryId: string
}

const initialFilters: FiltersState = {
  keyword: '',
  status: 'all',
  invoiceStatus: 'all',
  paymentMode: 'all',
  creatorId: '',
  purchaserId: '',
  createdMode: 'range',
  createdFrom: '',
  createdTo: '',
  createdPoint: '',
  createdPointDirection: 'after',
  paymentModeType: 'range',
  paymentFrom: '',
  paymentTo: '',
  paymentPoint: '',
  paymentPointDirection: 'after',
  categoryId: '',
}

function parseStoredColumns(raw: string | null): Array<keyof RecordRow> | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return null
    }

    const valid = parsed.filter((key): key is keyof RecordRow =>
      columnConfigs.some((column) => column.key === key),
    )
    return valid.length > 0 ? valid : null
  } catch {
    return null
  }
}

function readStoredColumns() {
  try {
    const current = parseStoredColumns(window.localStorage.getItem(preferenceStorageKey))
    if (current) {
      return current
    }

    const legacy = parseStoredColumns(window.localStorage.getItem(legacyPreferenceStorageKey))
    if (legacy) {
      window.localStorage.removeItem(legacyPreferenceStorageKey)
      return legacy
    }

    return defaultColumnKeys
  } catch {
    return defaultColumnKeys
  }
}

function parseStoredColumnWidths(raw: string | null): Record<string, number> | null {
  if (!raw) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const result: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const width = Number(value)
      if (Number.isFinite(width) && width >= MIN_COLUMN_WIDTH) {
        result[key] = Math.round(width)
      }
    }
    return Object.keys(result).length > 0 ? result : null
  } catch {
    return null
  }
}

function readStoredColumnWidths(): Record<string, number> {
  try {
    return parseStoredColumnWidths(window.localStorage.getItem(columnWidthsStorageKey)) ?? {}
  } catch {
    return {}
  }
}

function readStoredZoom() {
  try {
    const raw = window.localStorage.getItem(tableZoomStorageKey)
    const value = Number(raw)
    return zoomOptions.includes(value as (typeof zoomOptions)[number]) ? value : 100
  } catch {
    return 100
  }
}

function mapFiltersToApi(filters: FiltersState) {
  return {
    keyword: filters.keyword,
    status: filters.status,
    invoiceStatus: filters.invoiceStatus,
    paymentMode: filters.paymentMode,
    creatorId: filters.creatorId,
    purchaserId: filters.purchaserId,
    createdFrom:
      filters.createdMode === 'range'
        ? filters.createdFrom
        : filters.createdPointDirection === 'after'
          ? filters.createdPoint
          : '',
    createdTo:
      filters.createdMode === 'range'
        ? filters.createdTo
        : filters.createdPointDirection === 'before'
          ? filters.createdPoint
          : '',
    paymentFrom:
      filters.paymentModeType === 'range'
        ? filters.paymentFrom
        : filters.paymentPointDirection === 'after'
          ? filters.paymentPoint
          : '',
    paymentTo:
      filters.paymentModeType === 'range'
        ? filters.paymentTo
        : filters.paymentPointDirection === 'before'
          ? filters.paymentPoint
          : '',
    categoryId: filters.categoryId || undefined,
  }
}

// 3.6.1: 同源文件用隐藏 <a download> 直接下载，规避浏览器弹窗拦截导致附件 PDF 丢失。
function downloadExportFile(url: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = ''
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

export default function RecordsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const user = useAuthStore((state) => state.user)
  const [rows, setRows] = useState<RecordRow[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [message, setMessage] = useState('')
  const [reimbursingId, setReimbursingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [batchTargetStatus, setBatchTargetStatus] = useState<ReimbursementStatus | ''>('')
  const [batchReason, setBatchReason] = useState('')
  const [batchChanging, setBatchChanging] = useState(false)
  const [batchResult, setBatchResult] = useState<BatchStatusResult | null>(null)
  const [checkedOrderIds, setCheckedOrderIds] = useState<string[]>([])
  const [sortColumn, setSortColumn] = useState<keyof RecordRow | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [filters, setFilters] = useState<FiltersState>(() => {
    const statusParam = searchParams.get('status')
    const validStatuses: ReimbursementStatus[] = ['draft', 'unfinished', 'pending_review', 'needs_revision', 'completed', 'reimbursed']
    return statusParam && validStatuses.includes(statusParam as ReimbursementStatus)
      ? { ...initialFilters, status: statusParam }
      : initialFilters
  })
  const [columns, setColumns] = useState<Array<keyof RecordRow>>(() => readStoredColumns())
  const [tableZoom, setTableZoom] = useState<number>(() => readStoredZoom())
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => readStoredColumnWidths())
  const [resizing, setResizing] = useState<{ key: string; startX: number; startWidth: number } | null>(null)
  const tableScrollRef = useRef<HTMLDivElement | null>(null)
  const pageScrollbarRef = useRef<HTMLDivElement | null>(null)
  const syncScrollRef = useRef(false)
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false)
  const [tableClientWidth, setTableClientWidth] = useState(0)
  const [tableInViewport, setTableInViewport] = useState(false)
  const showFloatingScrollbar = hasHorizontalOverflow && tableInViewport

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    Object.entries(mapFiltersToApi(filters)).forEach(([key, value]) => {
      if (value && value !== 'all') params.set(key, value)
    })
    const [recordRows, meta, cats] = await Promise.all([
      api.get<RecordRow[]>(`/api/reimbursements/records?${params.toString()}`),
      api.get<{ users: UserOption[] }>('/api/reimbursements/meta'),
      categoriesApi.list().catch(() => [] as Category[]),
    ])
    setRows(recordRows)
    setUsers(meta.users)
    setCategories(cats)
    setCheckedOrderIds((current) => current.filter((id) => recordRows.some((row) => row.orderId === id)))
  }, [filters])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    window.localStorage.setItem(preferenceStorageKey, JSON.stringify(columns))
  }, [columns])

  useEffect(() => {
    window.localStorage.setItem(tableZoomStorageKey, String(tableZoom))
  }, [tableZoom])

  useEffect(() => {
    window.localStorage.setItem(columnWidthsStorageKey, JSON.stringify(columnWidths))
  }, [columnWidths])

  // 页面底部固定横向拉条与表格滚动联动，避免每次都要滚到表格最底部才能左右拖动。
  useEffect(() => {
    const table = tableScrollRef.current
    const bar = pageScrollbarRef.current
    if (!table) {
      setHasHorizontalOverflow(false)
      return
    }

    const updateOverflow = () => {
      setHasHorizontalOverflow(table.scrollWidth > table.clientWidth + 1)
      setTableClientWidth(Math.round(table.clientWidth))
    }
    const syncTableToBar = () => {
      if (!bar || syncScrollRef.current) return
      syncScrollRef.current = true
      bar.scrollLeft = table.scrollLeft
      syncScrollRef.current = false
    }
    const syncBarToTable = () => {
      if (!table || !bar || syncScrollRef.current) return
      syncScrollRef.current = true
      table.scrollLeft = bar.scrollLeft
      syncScrollRef.current = false
    }

    updateOverflow()
    if (bar) {
      bar.scrollLeft = table.scrollLeft
    }
    table.addEventListener('scroll', syncTableToBar)
    bar?.addEventListener('scroll', syncBarToTable)
    window.addEventListener('resize', updateOverflow)

    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateOverflow)
      observer.observe(table)
    }

    let intersectionObserver: IntersectionObserver | undefined
    if (typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver((entries) => {
        setTableInViewport(entries.some((entry) => entry.isIntersecting))
      }, { threshold: 0 })
      intersectionObserver.observe(table)
    }

    return () => {
      table.removeEventListener('scroll', syncTableToBar)
      bar?.removeEventListener('scroll', syncBarToTable)
      window.removeEventListener('resize', updateOverflow)
      observer?.disconnect()
      intersectionObserver?.disconnect()
    }
  }, [columns, columnWidths, tableZoom])

  useEffect(() => {
    const table = tableScrollRef.current
    const bar = pageScrollbarRef.current
    if (table && bar) {
      bar.scrollLeft = table.scrollLeft
    }
  }, [hasHorizontalOverflow, tableInViewport, columns, columnWidths, tableZoom])

  useEffect(() => {
    if (!resizing) {
      return
    }

    let rafId = 0
    const handleMove = (event: PointerEvent) => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const delta = event.clientX - resizing.startX
        const next = Math.max(MIN_COLUMN_WIDTH, Math.round(resizing.startWidth + delta))
        setColumnWidths((current) => (current[resizing.key] === next ? current : { ...current, [resizing.key]: next }))
      })
    }
    const handleUp = () => setResizing(null)

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [resizing])

  function startColumnResize(key: string, startX: number, startWidth: number) {
    setResizing({ key, startX, startWidth })
  }

  const hiddenColumns = useMemo(
    () => columnConfigs.filter((column) => !columns.includes(column.key)),
    [columns],
  )
  const activeColumnConfigs = useMemo(
    () =>
      columns.flatMap((key) => {
        const column = columnConfigs.find((item) => item.key === key)
        return column ? [column] : []
      }),
    [columns],
  )
  const canDirectReimburse = user?.role === 'finance' || user?.role === 'admin'
  const allCheckedOnPage = rows.length > 0 && rows.every((row) => checkedOrderIds.includes(row.orderId))
  const checkedRows = useMemo(
    () => rows.filter((row) => checkedOrderIds.includes(row.orderId)),
    [rows, checkedOrderIds],
  )
  const selectedReimbursementIds = useMemo(
    () => [...new Set(checkedRows.map((row) => row.reimbursementId))],
    [checkedRows],
  )
  const sortedRows = useMemo(() => {
    if (!sortColumn) {
      return rows
    }

    return [...rows].sort((a, b) => {
      const result = compareRecordColumn(a, b, sortColumn)
      return sortDirection === 'asc' ? result : -result
    })
  }, [rows, sortColumn, sortDirection])
  const selectedCompletedIds = useMemo(
    () => [...new Set(checkedRows.filter((row) => row.status === 'completed').map((row) => row.reimbursementId))],
    [checkedRows],
  )
  const tableMinWidth = useMemo(() => {
    const dynamicWidth = activeColumnConfigs.reduce(
      (total, column) => total + (columnWidths[column.key] ?? column.width),
      0,
    )
    return (
      dynamicWidth +
      checkboxColumnWidth +
      (columnWidths['action'] ?? fixedColumnDefaultWidths['action']) +
      (columnWidths['orderStatus'] ?? fixedColumnDefaultWidths['orderStatus']) +
      (columnWidths['statusBadge'] ?? fixedColumnDefaultWidths['statusBadge'])
    )
  }, [activeColumnConfigs, columnWidths])

  function toggleSort(column: keyof RecordRow) {
    setSortColumn((current) => {
      const nextColumn = current === column ? current : column
      setSortDirection((direction) => (current === column ? (direction === 'asc' ? 'desc' : 'asc') : 'asc'))
      return nextColumn
    })
  }

  async function runBatchDelete() {
    if (!selectedReimbursementIds.length) {
      setMessage('请先勾选需要删除的报销单。')
      return
    }

    if (
      !window.confirm(
        `确定要删除所选的 ${selectedReimbursementIds.length} 张报销单吗？删除后不可恢复，已使用的备用金会自动退回。`,
      )
    ) {
      return
    }

    try {
      setDeleting(true)
      setMessage('')
      const result = await api.post<{ processedCount: number }>('/api/reimbursements/batch-delete', {
        ids: selectedReimbursementIds,
      })
      await loadData()
      setCheckedOrderIds([])
      setMessage(`批量删除成功，共删除 ${result.processedCount} 张报销单。`)
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  async function runBatchStatusChange() {
    if (!selectedReimbursementIds.length) {
      setMessage('请先勾选需要处理的报销单。')
      return
    }

    if (!batchTargetStatus) {
      setMessage('请先选择目标状态。')
      return
    }

    if (batchTargetStatus === 'needs_revision' && !batchReason.trim()) {
      setMessage('驳回到待修改必须填写原因。')
      return
    }

    const targetLabel = getReimbursementStatusLabel(batchTargetStatus)
    const reasonText = batchTargetStatus === 'needs_revision' ? `\u9a73\u56de\u539f\u56e0\uff1a${batchReason.trim()}` : ''
    if (
      !window.confirm(
        `\u786e\u5b9a\u8981\u5c06\u6240\u9009\u7684 ${selectedReimbursementIds.length} \u5f20\u62a5\u9500\u5355\u72b6\u6001\u6539\u4e3a\u300c${targetLabel}\u300d\u5417\uff1f${reasonText ? `\n${reasonText}` : ''}`,
      )
    ) {
      return
    }

    try {
      setBatchChanging(true)
      setMessage('')
      const result = await api.post<BatchStatusResult>('/api/reimbursements/batch-status', {
        ids: selectedReimbursementIds,
        status: batchTargetStatus,
        reason: batchTargetStatus === 'needs_revision' ? batchReason.trim() : undefined,
      })
      await loadData()
      setCheckedOrderIds([])
      setBatchResult(result)
      setBatchReason('')
      setBatchTargetStatus('')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBatchChanging(false)
    }
  }

  function moveColumn(column: keyof RecordRow, direction: 'left' | 'right') {
    setColumns((current) => {
      const index = current.indexOf(column)
      if (index === -1) {
        return current
      }

      const targetIndex = direction === 'left' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current
      }

      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(targetIndex, 0, item)
      return next
    })
  }

  return (
    <ShellLayout
      title="查看与导出"
      subtitle="支持按订单行查看、中文列名配置、时间段 / 时间节点筛选，以及记住你的显示范围与导出顺序。"
    >
      <div className={`min-w-0 space-y-6 overflow-x-hidden${showFloatingScrollbar ? ' pb-12' : ''}`}>
        <section className="min-w-0 rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
          <div className="grid gap-4 xl:grid-cols-4">
            <input
              value={filters.keyword}
              onChange={(event) => setFilters((current) => ({ ...current, keyword: event.target.value }))}
              placeholder="模糊搜索：平台、商品、订单号、发票号"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none">
              <option value="all">全部状态</option>
              <option value="draft">草稿</option>
              <option value="unfinished">未完结</option>
              <option value="pending_review">待审核</option>
              <option value="needs_revision">待修改</option>
              <option value="completed">已办结</option>
              <option value="reimbursed">已报销</option>
            </select>
            <select value={filters.invoiceStatus} onChange={(event) => setFilters((current) => ({ ...current, invoiceStatus: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none">
              <option value="all">全部发票状态</option>
              <option value="none">无发票</option>
              <option value="not_issued">未开票</option>
              <option value="waiting_issued">等待开票中</option>
              <option value="issued">已开票</option>
            </select>
            <select value={filters.paymentMode} onChange={(event) => setFilters((current) => ({ ...current, paymentMode: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none">
              <option value="all">全部报销方式</option>
              <option value="personal_reimbursement">个人垫资需报销</option>
              <option value="reserve_fund">该订单使用备用金</option>
            </select>
            <select value={filters.categoryId} onChange={(event) => setFilters((current) => ({ ...current, categoryId: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none">
              <option value="">全部分类</option>
              <option value="none">未分类</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-4">
            <select value={filters.creatorId} onChange={(event) => setFilters((current) => ({ ...current, creatorId: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none">
              <option value="">全部填写人</option>
              {users.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
            </select>
            <select value={filters.purchaserId} onChange={(event) => setFilters((current) => ({ ...current, purchaserId: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none">
              <option value="">全部采购人</option>
              {users.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
            </select>
            <button type="button" onClick={loadData} className="flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm text-white">
              <Search className="h-4 w-4" />
              执行筛选
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  setMessage('')
                  const result = await api.post<ExportResult>('/api/exports', {
                    filters: mapFiltersToApi(filters),
                    columns: ['orderStatus', ...columns],
                    // 4.0.1: 导出时把当前排序一并传给服务端，保证 xlsx 与附件 PDF 顺序与页面一致
                    sort: sortColumn ? { column: sortColumn, direction: sortDirection } : undefined,
                  })
                  downloadExportFile(result.fileUrl)
                  // 3.6.1: 依次下载表格 xlsx 与附件合集 PDF，避免第二个 window.open 被弹窗拦截。
                  window.setTimeout(() => {
                    downloadExportFile(result.attachmentPdfUrl)
                  }, 400)
                  setMessage(`导出成功，共 ${result.recordCount} 行订单数据。已同时生成表格 xlsx 与附件合集 PDF。`)
                } catch (error) {
                  setMessage((error as Error).message)
                }
              }}
              className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
            >
              <Download className="h-4 w-4" />
              导出 (xlsx + 附件 PDF)
            </button>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-medium text-slate-800">时间段选择：创建时间</div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={filters.createdMode === 'range'}
                    onChange={() => setFilters((current) => ({ ...current, createdMode: 'range' }))}
                  />
                  时间段选择
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={filters.createdMode === 'point'}
                    onChange={() => setFilters((current) => ({ ...current, createdMode: 'point' }))}
                  />
                  时间节点选择
                </label>
              </div>
              {filters.createdMode === 'range' ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <input type="date" value={filters.createdFrom} onChange={(event) => setFilters((current) => ({ ...current, createdFrom: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none" />
                  <div className="text-center text-sm text-slate-500">至</div>
                  <input type="date" value={filters.createdTo} onChange={(event) => setFilters((current) => ({ ...current, createdTo: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none" />
                </div>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr]">
                  <select value={filters.createdPointDirection} onChange={(event) => setFilters((current) => ({ ...current, createdPointDirection: event.target.value as TimeDirection }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none">
                    <option value="after">之后</option>
                    <option value="before">之前</option>
                  </select>
                  <input type="date" value={filters.createdPoint} onChange={(event) => setFilters((current) => ({ ...current, createdPoint: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none" />
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-medium text-slate-800">时间段选择：支付时间</div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={filters.paymentModeType === 'range'}
                    onChange={() => setFilters((current) => ({ ...current, paymentModeType: 'range' }))}
                  />
                  时间段选择
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={filters.paymentModeType === 'point'}
                    onChange={() => setFilters((current) => ({ ...current, paymentModeType: 'point' }))}
                  />
                  时间节点选择
                </label>
              </div>
              {filters.paymentModeType === 'range' ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <input type="date" value={filters.paymentFrom} onChange={(event) => setFilters((current) => ({ ...current, paymentFrom: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none" />
                  <div className="text-center text-sm text-slate-500">至</div>
                  <input type="date" value={filters.paymentTo} onChange={(event) => setFilters((current) => ({ ...current, paymentTo: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none" />
                </div>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr]">
                  <select value={filters.paymentPointDirection} onChange={(event) => setFilters((current) => ({ ...current, paymentPointDirection: event.target.value as TimeDirection }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none">
                    <option value="after">之后</option>
                    <option value="before">之前</option>
                  </select>
                  <input type="date" value={filters.paymentPoint} onChange={(event) => setFilters((current) => ({ ...current, paymentPoint: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none" />
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-800">显示范围 / 导出列顺序</div>
            <div className="mt-2 text-xs text-slate-500">默认显示的是思维导图里的核心字段。你调整后的显示项和顺序会直接保存在本机，下次继续按这个配置展示和导出。</div>
            <div className="mt-4 flex flex-wrap gap-2">
              {columns.map((column, index) => (
                <div key={column} className="flex items-center gap-1 rounded-full bg-slate-900 px-2 py-1 text-xs text-white">
                  <span className="px-1">{index + 1}. {columnLabelMap[column]}</span>
                  <button type="button" onClick={() => moveColumn(column, 'left')} className="rounded-full p-1 transition hover:bg-white/10" disabled={index === 0}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => moveColumn(column, 'right')} className="rounded-full p-1 transition hover:bg-white/10" disabled={index === columns.length - 1}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => setColumns((current) => current.filter((item) => item !== column))} className="rounded-full p-1 transition hover:bg-white/10">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {hiddenColumns.map((column) => (
                <button
                  key={column.key}
                  type="button"
                  onClick={() => setColumns((current) => [...current, column.key])}
                  className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-2 text-xs text-slate-600"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {column.label}
                </button>
              ))}
            </div>
          </div>

          {message ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              {message}
            </div>
          ) : null}
        </section>

        <section className="min-w-0 rounded-3xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="text-sm text-slate-600">
                已勾选 {checkedOrderIds.length} 条订单行，对应 {selectedReimbursementIds.length} 张报销单。
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-600">
                  <button
                    type="button"
                    onClick={() => setTableZoom((current) => zoomOptions[Math.max(0, zoomOptions.indexOf(current as (typeof zoomOptions)[number]) - 1)] ?? current)}
                    disabled={tableZoom === zoomOptions[0]}
                    className="rounded-lg p-1 transition hover:bg-white disabled:opacity-40"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-14 text-center">{tableZoom}%</span>
                  <button
                    type="button"
                    onClick={() => setTableZoom((current) => zoomOptions[Math.min(zoomOptions.length - 1, zoomOptions.indexOf(current as (typeof zoomOptions)[number]) + 1)] ?? current)}
                    disabled={tableZoom === zoomOptions[zoomOptions.length - 1]}
                    className="rounded-lg p-1 transition hover:bg-white disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setCheckedOrderIds(rows.map((row) => row.orderId))}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                >
                  全选当前列表
                </button>
                <button
                  type="button"
                  onClick={() => setCheckedOrderIds([])}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                >
                  清空勾选
                </button>
                <button
                  type="button"
                  onClick={runBatchDelete}
                  disabled={deleting || selectedReimbursementIds.length === 0}
                  className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? '删除中...' : '一键删除所选项'}
                </button>
                <select
                  value={batchTargetStatus}
                  onChange={(event) => setBatchTargetStatus(event.target.value as ReimbursementStatus | '')}
                  className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs outline-none"
                >
                  <option value="">批量改为…</option>
                  <option value="unfinished">未结束</option>
                  <option value="pending_review">待审核</option>
                  <option value="needs_revision">待修改</option>
                  <option value="completed">已办结</option>
                  <option value="reimbursed">已报销</option>
                </select>
                {batchTargetStatus === 'needs_revision' ? (
                  <input
                    value={batchReason}
                    onChange={(event) => setBatchReason(event.target.value)}
                    placeholder="驳回原因（必填）"
                    className="w-40 rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs outline-none"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={runBatchStatusChange}
                  disabled={batchChanging || selectedReimbursementIds.length === 0}
                  className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  {batchChanging ? '状态变更中...' : '一键改变所选项状态'}
                </button>
                {canDirectReimburse ? (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        if (!selectedCompletedIds.length) {
                          setMessage('请先勾选至少一张状态为“已办结”的报销单。')
                          return
                        }

                        setMessage('')
                        setReimbursingId('batch')
                        const result = await api.post<{ processedCount: number }>('/api/reimbursements/batch-reimburse', {
                          ids: selectedCompletedIds,
                        })
                        await loadData()
                        setCheckedOrderIds([])
                        setMessage(`批量标记已报销成功，共处理 ${result.processedCount} 张报销单。`)
                      } catch (error) {
                        setMessage((error as Error).message)
                      } finally {
                        setReimbursingId(null)
                      }
                    }}
                    disabled={reimbursingId !== null || selectedCompletedIds.length === 0}
                    className="flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    {reimbursingId === 'batch' ? '批量处理中...' : '批量标记已报销'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="border-b border-slate-200 px-5 py-3 text-xs text-slate-500">
            表头右侧可左右拖动调整列宽（调整结果会自动保存）；若列较多，可在下方列表区域左右拖动查看。表格支持缩放查看，单元格默认最多显示 2-3 行内容。
          </div>
          <div ref={tableScrollRef} className="overflow-x-auto">
            <table className="table-fixed text-sm" style={{ minWidth: `${tableMinWidth}px`, fontSize: `${tableZoom}%` }}>
              <colgroup>
                <col style={{ width: `${checkboxColumnWidth}px` }} />
                <col style={{ width: `${columnWidths['action'] ?? fixedColumnDefaultWidths['action']}px` }} />
                <col style={{ width: `${columnWidths['orderStatus'] ?? fixedColumnDefaultWidths['orderStatus']}px` }} />
                {activeColumnConfigs.map((column) => (
                  <col key={column.key} style={{ width: `${columnWidths[column.key] ?? column.width}px` }} />
                ))}
                <col style={{ width: `${columnWidths['statusBadge'] ?? fixedColumnDefaultWidths['statusBadge']}px` }} />
              </colgroup>
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-2 py-3 font-medium">
                    <input
                      type="checkbox"
                      checked={allCheckedOnPage}
                      onChange={(event) =>
                        setCheckedOrderIds(event.target.checked ? rows.map((row) => row.orderId) : [])
                      }
                    />
                  </th>
                  <th className="relative px-4 py-3 font-medium">
                    操作
                    <ResizeHandle onStart={(startX) => startColumnResize('action', startX, columnWidths['action'] ?? fixedColumnDefaultWidths['action'])} />
                  </th>
                  <th className="relative px-4 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort('orderStatus')}
                      className="inline-flex items-center gap-1 transition hover:text-slate-900"
                    >
                      订单状态
                      {sortColumn === 'orderStatus' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </button>
                    <ResizeHandle onStart={(startX) => startColumnResize('orderStatus', startX, columnWidths['orderStatus'] ?? fixedColumnDefaultWidths['orderStatus'])} />
                  </th>
                  {activeColumnConfigs.map((column) => {
                    const sortable = sortableColumnKeys.has(column.key)
                    return (
                      <th key={column.key} className="relative px-4 py-3 font-medium">
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(column.key)}
                            className="inline-flex items-center gap-1 transition hover:text-slate-900"
                          >
                            {column.label}
                            {sortColumn === column.key ? (
                              sortDirection === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5" />
                              )
                            ) : (
                              <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                            )}
                          </button>
                        ) : (
                          column.label
                        )}
                        <ResizeHandle onStart={(startX) => startColumnResize(column.key, startX, columnWidths[column.key] ?? column.width)} />
                      </th>
                    )
                  })}
                  <th className="relative px-4 py-3 font-medium">
                    状态
                    <ResizeHandle onStart={(startX) => startColumnResize('statusBadge', startX, columnWidths['statusBadge'] ?? fixedColumnDefaultWidths['statusBadge'])} />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedRows.map((row) => (
                  <tr key={row.orderId} className="align-top">
                    <td className="px-2 py-3">
                      <input
                        type="checkbox"
                        checked={checkedOrderIds.includes(row.orderId)}
                        onChange={(event) =>
                          setCheckedOrderIds((current) =>
                            event.target.checked
                              ? [...current, row.orderId]
                              : current.filter((id) => id !== row.orderId),
                          )
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => navigate(`/reimbursements/${row.reimbursementId}`)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
                          查看详情
                        </button>
                        {canDirectReimburse && row.status === 'completed' ? (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                setReimbursingId(row.reimbursementId)
                                setMessage('')
                                await api.post<ReimbursementRecord>(`/api/reimbursements/${row.reimbursementId}/reimburse`, {})
                                await loadData()
                                setMessage(`报销单 ${row.invoiceNumber || row.title} 已标记为已报销。`)
                              } catch (error) {
                                setMessage((error as Error).message)
                              } finally {
                                setReimbursingId(null)
                              }
                            }}
                            disabled={reimbursingId !== null}
                            className="flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 disabled:opacity-60"
                          >
                            <Banknote className="h-3.5 w-3.5" />
                            {reimbursingId === row.reimbursementId ? '核销中...' : '标记已报销'}
                          </button>
                        ) : null}
                        {user?.role === 'admin' && row.status === 'reimbursed' ? (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                setUndoingId(row.reimbursementId)
                                setMessage('')
                                await api.post<ReimbursementRecord>(`/api/reimbursements/${row.reimbursementId}/undo-reimburse`, {})
                                await loadData()
                                setMessage(`报销单 ${row.invoiceNumber || row.title} 已退回为已办结。`)
                              } catch (error) {
                                setMessage((error as Error).message)
                              } finally {
                                setUndoingId(null)
                              }
                            }}
                            disabled={undoingId !== null}
                            className="flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700 disabled:opacity-60"
                          >
                            <RefreshCcw className="h-3.5 w-3.5" />
                            {undoingId === row.reimbursementId ? '退回中...' : '退回已办结'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 break-words text-slate-700">
                      {renderColumn(row, orderStatusColumnConfig)}
                    </td>
                    {activeColumnConfigs.map((column) => (
                      <td key={column.key} className="px-4 py-3 break-words text-slate-700">
                        {renderColumn(row, column)}
                      </td>
                    ))}
                    <td className="px-4 py-3"><ReimbursementStatusBadge status={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {batchResult ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-6">
            <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
              <div className="flex items-center justify-between gap-4">
                <div className="text-base font-semibold text-slate-900">批量状态变更结果</div>
                <button type="button" onClick={() => setBatchResult(null)} className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 text-sm text-slate-600">
                成功处理 {batchResult.processedCount} 张；跳过 {batchResult.skippedCount} 张。
              </div>
              {batchResult.skippedReasons.length > 0 ? (
                <div className="mt-3 max-h-64 overflow-y-auto rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs leading-6 text-rose-700">
                  {batchResult.skippedReasons.map((reason) => (
                    <div key={reason}>· {reason}</div>
                  ))}
                </div>
              ) : null}
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setBatchResult(null)}
                  className="rounded-xl bg-slate-950 px-4 py-2 text-sm text-white"
                >
                  知道了
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
        <div
          aria-hidden={!showFloatingScrollbar}
          className={`fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur transition-opacity duration-200 ${
            showFloatingScrollbar ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div ref={pageScrollbarRef} className="mx-auto overflow-x-auto" style={{ maxWidth: tableClientWidth || undefined }}>
            <div style={{ width: `${tableMinWidth}px`, height: '1px' }} />
          </div>
        </div>
    </ShellLayout>
  )
}

type ResizeHandleProps = {
  onStart: (startX: number) => void
}

function ResizeHandle({ onStart }: ResizeHandleProps) {
  return (
    <div
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onStart(event.clientX)
      }}
      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none bg-transparent transition-colors hover:bg-slate-400/40 active:bg-slate-400/60"
      title="拖动调整列宽"
    />
  )
}

function renderColumn(row: RecordRow, column: ColumnConfig) {
  const clampClass = column.lines === 2 ? 'records-clamp-2' : 'records-clamp-3'

  switch (column.key) {
    case 'categoryName':
      return row.categoryName ? (
        <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700" title={row.categoryName}>
          {row.categoryName}
        </span>
      ) : (
        <div className={clampClass}>-</div>
      )
    case 'invoiceStatus':
      return <InvoiceStatusBadge status={row.invoiceStatus} />
    case 'paymentMode':
      return <PaymentModeBadge mode={row.paymentMode} />
    case 'status':
      return <div className={clampClass}>{getReimbursementStatusLabel(row.status)}</div>
    case 'paymentAmount': {
      const ordersSum = Number(row.ordersPaymentSum || 0)
      const mismatched = Math.abs(Number(row.invoiceTotalAmount || 0) - ordersSum) > 0.01
      if (mismatched && row.amountStandard === 'invoice') {
        return (
          <div className={clampClass}>
            {formatCurrency(row.parentChildMarker === '母' ? Number(row.invoiceTotalAmount || 0) : 0)}
          </div>
        )
      }
      return <div className={clampClass}>{formatCurrency(Number(row.paymentAmount))}</div>
    }
    case 'invoiceTotalAmount':
      return <div className={clampClass}>{formatCurrency(Number(row[column.key]))}</div>
    case 'paymentTime':
    case 'createdAt':
    case 'updatedAt':
      return <div className={clampClass}>{formatDateTime(String(row[column.key]))}</div>
    case 'invoiceAttachmentUrl':
    case 'orderAttachmentUrl':
      return <div className={clampClass}>{row[column.key] ? '已上传' : '-'}</div>
    case 'amountStandard':
      return (
        <div className={clampClass}>
          {row.amountStandard === 'invoice' ? '以发票金额为准' : row.amountStandard === 'orders' ? '以订单金额为准' : '-'}
        </div>
      )
    case 'amountMismatchNote':
      return <div className={clampClass}>{row.amountMismatchNote || '-'}</div>
    case 'rejectionReason':
      return row.rejectionReason ? (
        <div className={clampClass} title={row.rejectionReason} style={{ color: '#be123c' }}>
          {row.rejectionReason}
        </div>
      ) : (
        <div className={clampClass}>-</div>
      )
    default:
      return (
        <div className={clampClass} title={String(row[column.key] ?? '-')}>
          {String(row[column.key] ?? '-')}
        </div>
      )
  }
}
