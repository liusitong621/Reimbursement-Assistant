import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Banknote, ChevronDown, Eraser, FileText, ImagePlus, Lock, LockOpen, Plus, RotateCcw, Save, ScanText, SendHorizonal, Trash2, X } from 'lucide-react'
import { cn, sanitizeAmountInput, sanitizePercentInput } from '@/lib/utils'
import { CategoryPicker } from '@/components/CategoryPicker'
import { ShellLayout } from '@/components/ShellLayout'
import LocalOcrGuide from '@/components/LocalOcrGuide'
import { PaymentModeBadge, ReimbursementStatusBadge } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import type { InvoiceStatus, PaymentMode, ReimbursementRecord, UserOption } from '@/lib/types'
import { useAuthStore } from '@/store/authStore'
import { compressImageIfNeeded, formatFileSize } from '@/utils/image'
import { getOcrPreference, mergeRecognizedInvoiceFields, mergeRecognizedOrderFields, recognizeInvoiceFromImage, recognizeOrderFromImage, setOcrPreference, type OcrPreference } from '@/utils/invoiceOcr'
import {
  buildPayload,
  createEmptyOrder,
  createEmptyReimbursement,
  getPaymentAmountTotal,
  invoiceStatusOptions,
  orderStatusOptions,
  paymentModeOptions,
  platformCategoryOptions,
  platformNameOptionsByCategory,
  targetedPlatformNames,
  reimbursementToForm,
  type AmountStandard,
  type OrderFormState,
  type ReimbursementFormState,
} from '@/utils/reimbursement'
import { findDuplicateNumbers } from '@/utils/reimbursement'

type MetaResponse = { users: UserOption[] }

// 3.0：所有上传区域（发票 / 子订单）共用同一个目标类型
type UploadTarget = { kind: 'invoice' } | { kind: 'order'; sequence: number }

// 发票金额类字段：只允许输入两位小数数字
const INVOICE_AMOUNT_FIELDS = new Set<string>(['invoiceAmountExcludingTax', 'invoiceTaxAmount', 'invoiceTotalAmount'])

const fieldClass =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400'

const highlightedClass = 'border-rose-400 bg-rose-50 ring-2 ring-rose-200'
const mutedFieldClass =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400'
const textareaClass =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400'

const lockedFieldsStorageKey = 'fp-editor-locked-fields-v1'
const lockedValuesStorageKey = 'fp-editor-locked-values-v1'
const notePresetsStorageKey = 'fp-note-presets-v1'
const defaultNotePresets = ['停车费', '加油费', '餐饮费', '高速费']

const invoiceLockKeys: Array<[string, keyof ReimbursementFormState]> = [
  ['title', 'title'],
  ['invoiceSellerName', 'invoiceSellerName'],
  ['invoiceSellerTaxNo', 'invoiceSellerTaxNo'],
  ['invoiceAmountExcludingTax', 'invoiceAmountExcludingTax'],
  ['invoiceTaxAmount', 'invoiceTaxAmount'],
  ['invoiceTaxRate', 'invoiceTaxRate'],
  ['invoiceTotalAmount', 'invoiceTotalAmount'],
  ['invoiceNumber', 'invoiceNumber'],
  ['invoiceStatus', 'invoiceStatus'],
  ['categoryId', 'categoryId'],
]

const orderLockKeys: Array<[string, keyof OrderFormState]> = [
  ['order.platformCategory', 'platformCategory'],
  ['order.platformName', 'platformName'],
  ['order.platformNameOther', 'platformNameOther'],
  ['order.merchantName', 'merchantName'],
  ['order.itemDescription', 'itemDescription'],
  ['order.orderNumber', 'orderNumber'],
  ['order.paymentTime', 'paymentTime'],
  ['order.paymentAmount', 'paymentAmount'],
  ['order.orderStatus', 'orderStatus'],
  ['order.purchaserId', 'purchaserId'],
  ['order.paymentMode', 'paymentMode'],
  ['order.userIds', 'userIds'],
  ['order.note', 'note'],
]

function loadLockedFields(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(lockedFieldsStorageKey)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function loadLockedValues(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(lockedValuesStorageKey)
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function restoreLockedValues(form: ReimbursementFormState): ReimbursementFormState {
  const fields = loadLockedFields()
  const values = loadLockedValues()
  const next = { ...form, orders: form.orders.map((order) => ({ ...order })) }
  for (const [lockKey, fieldKey] of invoiceLockKeys) {
    if (fields[lockKey] && values[lockKey] !== undefined) {
      ;(next as unknown as Record<string, unknown>)[fieldKey] = values[lockKey]
    }
  }
  const order = next.orders[0]
  if (order) {
    for (const [lockKey, fieldKey] of orderLockKeys) {
      if (fields[lockKey] && values[lockKey] !== undefined) {
        ;(order as unknown as Record<string, unknown>)[fieldKey] = values[lockKey]
      }
    }
  }
  return next
}


function FieldLabel({
  label,
  locked,
  canEdit,
  onToggleLock,
}: {
  label: string
  locked: boolean
  canEdit: boolean
  onToggleLock: () => void
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium text-slate-700">
      <span>{label}</span>
      {canEdit ? (
        <button
          type="button"
          onClick={onToggleLock}
          title={locked ? '已锁定：点击解锁，新建报销单时此字段将清空' : '点击锁定：新建报销单时保留此字段，避免重复输入'}
          className="rounded-lg p-1 transition hover:bg-slate-100"
        >
          {locked ? (
            <Lock className="h-3.5 w-3.5 text-amber-500" />
          ) : (
            <LockOpen className="h-3.5 w-3.5 text-slate-400" />
          )}
        </button>
      ) : null}
    </div>
  )
}

function fileListFromArray(files: File[]): FileList {
  // ponytail: 用最少代码把 File[] 伪装成 FileList，复用现有 handleFiles
  return {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    *[Symbol.iterator]() {
      for (const file of files) yield file
    },
  } as unknown as FileList
}

function uploadAreaClass(isDragging: boolean, isActive: boolean) {
  if (isDragging) {
    return 'border-amber-500 bg-amber-50/80 ring-2 ring-amber-200'
  }
  if (isActive) {
    return 'border-amber-400 bg-white ring-2 ring-amber-200'
  }
  return 'border-slate-200 bg-slate-50'
}

export default function ReimbursementEditorPage({ mode }: { mode: 'create' | 'edit' }) {
  const navigate = useNavigate()
  const { id } = useParams()
  const user = useAuthStore((state) => state.user)
  const [users, setUsers] = useState<UserOption[]>([])
  const [record, setRecord] = useState<ReimbursementRecord | null>(null)
  const [form, setForm] = useState<ReimbursementFormState>(() => mode === 'create' ? restoreLockedValues(createEmptyReimbursement()) : createEmptyReimbursement())
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([])
  const [orderFiles, setOrderFiles] = useState<Record<number, File[]>>({})
  const [message, setMessage] = useState('')
  const [ocrPreview, setOcrPreview] = useState('')
  const [ocrPending, setOcrPending] = useState(false)
  const [ocrProgressText, setOcrProgressText] = useState('')
  const [ocrPreference, setOcrPref] = useState<OcrPreference>(() => getOcrPreference())
  const [taxRateEditing, setTaxRateEditing] = useState(false)
  const [taxRateDraft, setTaxRateDraft] = useState('')
  const [orderOcrPending, setOrderOcrPending] = useState<Record<number, boolean>>({})
  const [orderOcrProgress, setOrderOcrProgress] = useState<Record<number, string>>({})
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string; isPdf?: boolean } | null>(null)
  const [highlightedFields, setHighlightedFields] = useState<Record<string, boolean>>({})
  const [customNotePresets, setCustomNotePresets] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(notePresetsStorageKey)
      return raw ? (JSON.parse(raw) as string[]) : []
    } catch {
      return []
    }
  })
  const lockedValuesRef = useRef<Record<string, unknown>>(loadLockedValues())
  const [openPlatformIndex, setOpenPlatformIndex] = useState<number | null>(null)
  const [lockedFields, setLockedFields] = useState<Record<string, boolean>>(() => {
    try {
      const raw = window.localStorage.getItem(lockedFieldsStorageKey)
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
    } catch {
      return {}
    }
  })

  // 4.0.3: 已有发票号 / 订单号（用于重复检测）
  const [existingNumbers, setExistingNumbers] = useState<{ invoiceNumbers: string[]; orderNumbers: string[] }>({
    invoiceNumbers: [],
    orderNumbers: [],
  })
  // 记录已经弹窗提醒过的重复值，避免每次渲染都重复弹窗
  const alertedDuplicatesRef = useRef<{ invoice?: string; orders: Record<number, string> }>({ orders: {} })

  // 4.0.3: 防止连点导致同一报销单被重复创建 / 重复提交
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  // 3.0：上传区域支持粘贴+拖拽。这里记录"当前激活的上传目标"，window 级 paste 事件会路由到这里。
  const [activeUploadTarget, setActiveUploadTarget] = useState<UploadTarget | null>(null)
  const [dragTarget, setDragTarget] = useState<UploadTarget | null>(null)
  // 用 ref 同步最新状态，避免在 window paste handler 中拿到过期的 activeUploadTarget。
  const activeUploadTargetRef = useRef<UploadTarget | null>(null)
  const canEditRecordRef = useRef(false)

  useEffect(() => {
    activeUploadTargetRef.current = activeUploadTarget
  }, [activeUploadTarget])

  useEffect(() => {
    api.get<MetaResponse>('/api/reimbursements/meta').then((data) => setUsers(data.users))
    // 4.0.3: 一次性拉取已有发票号 / 订单号用于重复检测
    api.get<{ invoiceNumbers: string[]; orderNumbers: string[] }>('/api/reimbursements/numbers')
      .then((data) => setExistingNumbers(data))
      .catch(() => {})
    if (mode === 'edit' && id) {
      api.get<ReimbursementRecord>(`/api/reimbursements/${id}`).then((data) => {
        setRecord(data)
        setForm(reimbursementToForm(data))
      })
    }
  }, [id, mode])

  const paymentTotal = useMemo(() => getPaymentAmountTotal(form), [form])
  const canEditRecord = mode === 'create' ? user?.role !== 'finance' : !!user && !!record && (user.role === 'admin' || user.id === record.creator.id)

  // 4.0.3: 发票号 / 订单号重复检测（编辑时排除本单自身已存在的编号）
  const duplicateState = useMemo(() => {
    return findDuplicateNumbers(
      form.invoiceNumber,
      form.orders.map((order) => order.orderNumber),
      existingNumbers,
      {
        invoiceNumber: record?.invoiceNumber ?? '',
        orderNumbers: record?.orders.map((order) => order.orderNumber) ?? [],
      },
    )
  }, [form, existingNumbers, record])

  // 检测到重复时弹窗提醒（同一重复值只提醒一次；修改后再次重复会重新提醒）
  useEffect(() => {
    const messages: string[] = []
    if (duplicateState.invoice) {
      if (alertedDuplicatesRef.current.invoice !== duplicateState.invoice) {
        messages.push('发票号码 “' + duplicateState.invoice + '” 与已有记录重复')
        alertedDuplicatesRef.current.invoice = duplicateState.invoice
      }
    } else {
      alertedDuplicatesRef.current.invoice = undefined
    }
    const currentAlertedOrders = { ...alertedDuplicatesRef.current.orders }
    for (const [index, value] of Object.entries(duplicateState.orders)) {
      if (currentAlertedOrders[Number(index)] !== value) {
        messages.push('订单号 “' + value + '”（第 ' + (Number(index) + 1) + ' 个子订单）与已有记录重复')
        currentAlertedOrders[Number(index)] = value
      }
    }
    for (const [index, value] of Object.entries(currentAlertedOrders)) {
      if (duplicateState.orders[Number(index)] !== value) {
        delete currentAlertedOrders[Number(index)]
      }
    }
    alertedDuplicatesRef.current.orders = currentAlertedOrders
    if (messages.length > 0) {
      window.alert('检测到重复编号，请修改后再保存：\n' + messages.join('\n'))
    }
  }, [duplicateState])

  useEffect(() => {
    canEditRecordRef.current = canEditRecord
  }, [canEditRecord])

  useEffect(() => {
    window.localStorage.setItem(lockedFieldsStorageKey, JSON.stringify(lockedFields))
  }, [lockedFields])

  // 新建模式下，把已锁定字段的当前值持久化，刷新/新建后自动恢复
  useEffect(() => {
    if (mode !== 'create') return
    const next: Record<string, unknown> = {}
    for (const [lockKey, fieldKey] of invoiceLockKeys) {
      if (lockedFields[lockKey]) next[lockKey] = form[fieldKey]
    }
    const order = form.orders[0]
    if (order) {
      for (const [lockKey, fieldKey] of orderLockKeys) {
        if (lockedFields[lockKey]) next[lockKey] = order[fieldKey]
      }
    }
    lockedValuesRef.current = next
    window.localStorage.setItem(lockedValuesStorageKey, JSON.stringify(next))
  }, [form, lockedFields, mode])

  function appendNotePreset(index: number, preset: string) {
    setForm((current) => ({
      ...current,
      orders: current.orders.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, note: item.note.trim() ? item.note.trim() + '，' + preset : preset }
          : item,
      ),
    }))
  }

  function selectPlatform(index: number, value: string) {
    setForm((current) => ({
      ...current,
      orders: current.orders.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, platformName: value, platformNameOther: value === "其他" ? item.platformNameOther : "" }
          : item,
      ),
    }))
    setOpenPlatformIndex(null)
  }

  function addCustomNotePreset() {
    const text = window.prompt('请输入新的备注备选项')
    if (!text || !text.trim()) return
    setCustomNotePresets((current) => {
      if (current.includes(text.trim())) return current
      const next = [...current, text.trim()]
      window.localStorage.setItem(notePresetsStorageKey, JSON.stringify(next))
      return next
    })
  }

  function toggleLock(key: string) {
    setLockedFields((current) => ({ ...current, [key]: !current[key] }))
  }

  function clearHighlight(key: string) {
    setHighlightedFields((current) => (current[key] ? { ...current, [key]: false } : current))
  }

  // 3.0：window 级 paste 监听器。点击某个上传区域把它置为 active 目标，粘贴时把剪贴板里的文件放进去。
  useEffect(() => {
    function onWindowPaste(event: ClipboardEvent) {
      const domTarget = event.target as HTMLElement | null
      if (
        domTarget &&
        ((domTarget.tagName === 'INPUT' && (domTarget as HTMLInputElement).type !== 'file') ||
          domTarget.tagName === 'TEXTAREA' ||
          domTarget.isContentEditable)
      ) {
        return
      }
      const items = event.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length === 0) return
      const target = activeUploadTargetRef.current
      if (!target) {
        setMessage('请先点击要粘贴到的上传区域（发票截图或子订单截图）。')
        return
      }
      if (!canEditRecordRef.current) {
        setMessage('当前账号没有上传权限。')
        return
      }
      event.preventDefault()
      void applyPastedFiles(files, target)
    }

    window.addEventListener('paste', onWindowPaste)
    return () => window.removeEventListener('paste', onWindowPaste)
  }, [])

  const amountDiff = Math.abs(paymentTotal - Number(form.invoiceTotalAmount || 0))
  const hasAmountMismatch = amountDiff > 0.01
  const currentStatus = record?.status ?? form.status
  const submitButtonLabel = currentStatus === 'draft' ? '提交为未完结' : '送审'
  const submitTargetStatus: ReimbursementFormState['status'] =
    currentStatus === 'draft' ? 'unfinished' : 'pending_review'
  const canMarkReimbursed = !!record && !!user && (user.role === 'finance' || user.role === 'admin') && record.status === 'completed'

  function updateOrder(index: number, patch: Partial<ReimbursementFormState['orders'][number]>) {
    setForm((current) => ({
      ...current,
      orders: current.orders.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }))
  }

  function toggleOrderUser(index: number, targetUserId: string) {
    setForm((current) => ({
      ...current,
      orders: current.orders.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item
        }

        const exists = item.userIds.includes(targetUserId)
        return {
          ...item,
          userIds: exists
            ? item.userIds.filter((userId) => userId !== targetUserId)
            : [...item.userIds, targetUserId],
        }
      }),
    }))
  }

  async function handleFiles(fileList: FileList | null, label: string) {
    const preparedFiles = await Promise.all(Array.from(fileList ?? []).map((file) => compressImageIfNeeded(file)))
    const compressedFiles = preparedFiles.filter((item) => item.compressed)

    if (compressedFiles.length > 0) {
      const detail = compressedFiles
        .map((item) => `${formatFileSize(item.originalSize)} -> ${formatFileSize(item.finalSize)}`)
        .join('，')
      setMessage(`${label}中有 ${compressedFiles.length} 张图片超过 10MB，系统已自动压缩后继续使用（${detail}）。`)
    }

    return preparedFiles.map((item) => item.file)
  }

  // 3.0：粘贴/拖拽到的文件都会走这个统一的入参处理，保持与文件选择器一致行为（压缩 + 提示）。
  async function applyPastedFiles(files: File[], target: UploadTarget) {
    if (target.kind === 'invoice') {
      setHighlightedFields({})
    setOcrPreview('')
      setOcrProgressText('')
      const pastedInvoiceFiles = await handleFiles(fileListFromArray(files), '发票截图')
      setInvoiceFiles((current) => [...current, ...pastedInvoiceFiles])
      return
    }
    const sequence = target.sequence
    const prepared = (await handleFiles(fileListFromArray(files), `子订单 ${sequence} 截图`)).slice(0, 2)
    setOrderFiles((current) => ({ ...current, [sequence]: [...(current[sequence] ?? []), ...prepared].slice(0, 2) }))
  }


  async function runInvoiceOcr() {
    const sourceFile = invoiceFiles[0]
    if (!sourceFile) {
      setMessage('请先上传发票截图，再执行识别。')
      return
    }

    setOcrPending(true)
    setOcrProgressText('正在初始化 OCR 引擎...')
    setMessage('')

    try {
      const result = await recognizeInvoiceFromImage(sourceFile, (progress, status) => {
        setOcrProgressText(`${status} ${Math.round(progress * 100)}%`)
      })
      const matchedFields = Object.entries(result.fields).filter(([, value]) => value)

      setForm((current) => mergeRecognizedInvoiceFields(current, result.fields))
      const mergedInvoiceForm = mergeRecognizedInvoiceFields(form, result.fields)
      const invoiceOcrKeys = [
        'invoiceNumber',
        'invoiceSellerTaxNo',
        'invoiceSellerName',
        'invoiceAmountExcludingTax',
        'invoiceTaxAmount',
        'invoiceTotalAmount',
        'invoiceTaxRate',
        'invoiceStatus',
      ]
      const unrecognizedInvoiceKeys = invoiceOcrKeys.filter(
        (key) => !String(mergedInvoiceForm[key as keyof ReimbursementFormState] ?? '').trim(),
      )
      if (unrecognizedInvoiceKeys.length > 0) {
        setHighlightedFields((current) => {
          const next = { ...current }
          unrecognizedInvoiceKeys.forEach((key) => {
            next[key] = true
          })
          return next
        })
      }
      setOcrPreview(result.text.trim().slice(0, 800))

      if (matchedFields.length === 0) {
        setMessage('OCR 已完成，但没有提取到足够稳定的字段，请根据识别文本手动补充。')
        return
      }

      setMessage(
        `OCR 已完成，已尝试填充 ${matchedFields.map(([key]) => key).join('、')}，已填写的内容会优先保留。`,
      )
    } catch (error) {
      setMessage(`OCR 识别失败：${(error as Error).message}`)
    } finally {
      setOcrPending(false)
      setOcrProgressText('')
    }
  }

  async function runOrderOcr(index: number, sequence: number) {
    const sourceFile = orderFiles[sequence]?.[0]
    if (!sourceFile) {
      setMessage(`请先上传子订单 ${sequence} 的截图，再执行识别。`)
      return
    }

    setOrderOcrPending((current) => ({ ...current, [sequence]: true }))
    setOrderOcrProgress((current) => ({ ...current, [sequence]: '正在初始化 OCR 引擎...' }))
    setMessage('')

    try {
      const result = await recognizeOrderFromImage(sourceFile, (progress, status) => {
        setOrderOcrProgress((current) => ({ ...current, [sequence]: `${status} ${Math.round(progress * 100)}%` }))
      }, form.orders[index].platformName)
      const matchedFields = Object.entries(result.fields).filter(([, value]) => value)

      setForm((current) => ({
        ...current,
        orders: current.orders.map((item, itemIndex) =>
          itemIndex === index ? mergeRecognizedOrderFields(item, result.fields) : item,
        ),
      }))
      const mergedOrderForm = mergeRecognizedOrderFields(form.orders[index], result.fields)
      const orderOcrKeys = [
        'platformName',
        'merchantName',
        'itemDescription',
        'orderNumber',
        'paymentTime',
        'paymentAmount',
      ]
      const unrecognizedOrderKeys = orderOcrKeys.filter(
        (key) => !String(mergedOrderForm[key as keyof OrderFormState] ?? '').trim(),
      )
      if (unrecognizedOrderKeys.length > 0) {
        setHighlightedFields((current) => {
          const next = { ...current }
          unrecognizedOrderKeys.forEach((key) => {
            next[`order.${key}`] = true
          })
          return next
        })
      }

      if (matchedFields.length === 0) {
        setMessage(`子订单 ${sequence} OCR 已完成，但没有提取到足够稳定的字段，请手动补充。`)
        return
      }

      setMessage(`子订单 ${sequence} OCR 已完成，已尝试填充 ${matchedFields.map(([key]) => key).join('、')}。`)
    } catch (error) {
      setMessage(`子订单 ${sequence} OCR 识别失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setOrderOcrPending((current) => ({ ...current, [sequence]: false }))
      setOrderOcrProgress((current) => ({ ...current, [sequence]: '' }))
    }
  }

  function applyLockedFields(source: ReimbursementFormState, target: ReimbursementFormState) {
    const invoiceLockKeys: Array<[string, keyof ReimbursementFormState]> = [
      ['title', 'title'],
      ['invoiceSellerName', 'invoiceSellerName'],
      ['invoiceSellerTaxNo', 'invoiceSellerTaxNo'],
      ['invoiceAmountExcludingTax', 'invoiceAmountExcludingTax'],
      ['invoiceTaxAmount', 'invoiceTaxAmount'],
      ['invoiceTaxRate', 'invoiceTaxRate'],
      ['invoiceTotalAmount', 'invoiceTotalAmount'],
      ['invoiceNumber', 'invoiceNumber'],
      ['invoiceStatus', 'invoiceStatus'],
      ['categoryId', 'categoryId'],
    ]

    for (const [lockKey, fieldKey] of invoiceLockKeys) {
      if (lockedFields[lockKey]) {
        ;(target as Record<string, unknown>)[fieldKey] = (source as Record<string, unknown>)[fieldKey]
      }
    }

    const sourceOrder = source.orders[0]
    const targetOrder = target.orders[0]
    if (sourceOrder && targetOrder) {
      const orderLockKeys: Array<[string, keyof OrderFormState]> = [
        ['order.platformCategory', 'platformCategory'],
        ['order.platformName', 'platformName'],
        ['order.platformNameOther', 'platformNameOther'],
        ['order.merchantName', 'merchantName'],
        ['order.itemDescription', 'itemDescription'],
        ['order.orderNumber', 'orderNumber'],
        ['order.paymentTime', 'paymentTime'],
        ['order.paymentAmount', 'paymentAmount'],
        ['order.orderStatus', 'orderStatus'],
        ['order.purchaserId', 'purchaserId'],
        ['order.paymentMode', 'paymentMode'],
        ['order.userIds', 'userIds'],
        ['order.note', 'note'],
      ]

      for (const [lockKey, fieldKey] of orderLockKeys) {
        if (lockedFields[lockKey]) {
          ;(targetOrder as unknown as Record<string, unknown>)[fieldKey] =
            (sourceOrder as unknown as Record<string, unknown>)[fieldKey]
        }
      }
    }
  }

  function resetToNewReimbursement(successMessage: string) {
    setRecord(null)
    const nextForm = createEmptyReimbursement()
    applyLockedFields(form, nextForm)
    setForm(nextForm)
    setInvoiceFiles([])
    setOrderFiles({})
    setOcrPreview('')
    setOcrProgressText('')
    setOcrPending(false)
    setOrderOcrPending({})
    setOrderOcrProgress({})
    setActiveUploadTarget(null)
    setDragTarget(null)
    setPreviewImage(null)
    setMessage(successMessage)
    navigate('/reimbursements/new', { replace: true })
  }
  // 4.0.4: 一键清除未锁定字段内容（锁定的字段保留，截图一并清空）
  function clearUnlockedFields() {
    const confirmed = window.confirm(
      '确定要清除所有未锁定字段的内容吗？\n锁定的字段会保留；发票/订单截图也会一并清空。',
    )
    if (!confirmed) return
    const nextForm = createEmptyReimbursement()
    applyLockedFields(form, nextForm)
    setForm(nextForm)
    setInvoiceFiles([])
    setOrderFiles({})
    setOcrPreview('')
    setOcrProgressText('')
    setMessage('已清除未锁定项内容，锁定的字段已保留。')
  }

  async function submit(
    targetStatus: ReimbursementFormState['status'],
    options?: { openNew?: boolean },
  ) {
    try {
    // 4.0.3: 连点保护——上一次保存/提交未结束时忽略新的点击
    if (submittingRef.current) {
      return
    }
    submittingRef.current = true
    setSubmitting(true)
      setMessage('')
      // 4.0.3: 发票号 / 订单号与已有记录重复时禁止一切保存操作
      const duplicateMessages: string[] = []
      if (duplicateState.invoice) {
        duplicateMessages.push('发票号码 “' + duplicateState.invoice + '” 与已有记录重复')
      }
      for (const value of Object.values(duplicateState.orders)) {
        if (value) duplicateMessages.push('订单号 “' + value + '” 与已有记录重复')
      }
      if (duplicateMessages.length > 0) {
        window.alert('检测到重复编号，已禁止保存：\n' + duplicateMessages.join('\n'))
        return
      }
      const nextForm = { ...form, status: targetStatus }
      const payload = buildPayload(nextForm)

      if (hasAmountMismatch && !form.amountStandard) {
        window.alert(
          `发票价税合计（${Number(form.invoiceTotalAmount || 0).toFixed(2)} 元）与订单支付金额合计（${paymentTotal.toFixed(2)} 元）不一致，\n请先在"金额报销标准"中选择以哪个金额为准，然后才能保存或提交。`,
        )
        return
      }

      // 送审时（目标为 pending_review），金额不一致必须填写情况说明
      if (targetStatus === 'pending_review' && hasAmountMismatch) {
        if (!form.amountMismatchNote.trim()) {
          window.alert(
            `发票价税合计（${Number(form.invoiceTotalAmount || 0).toFixed(2)} 元）与订单支付金额合计（${paymentTotal.toFixed(2)} 元）不一致，\n送审前必须在"金额差异说明"中填写情况说明。\n\n您可以先暂存为草稿或未完结，补充说明后再送审。`,
          )
          return
        }
      }

      if (mode === 'create') {
        const formData = new FormData()
        formData.append('payload', JSON.stringify(payload))
        invoiceFiles.forEach((file) => formData.append('invoiceImages', file))
        Object.entries(orderFiles).forEach(([sequence, files]) => {
          files.forEach((file) => formData.append(`orderImages_${sequence}`, file))
        })
        const created = await api.post<ReimbursementRecord>('/api/reimbursements', formData, true)
        if (options?.openNew) {
          resetToNewReimbursement(
            targetStatus === 'draft'
              ? '已保存为草稿，已打开新的空白报销单。'
              : '已提交为未完结，已打开新的空白报销单。',
          )
        } else {
          navigate(`/reimbursements/${created.id}`)
        }
        return
      }

      const editFormData = new FormData()
      editFormData.append('payload', JSON.stringify(payload))
      invoiceFiles.forEach((file) => editFormData.append('invoiceImages', file))
      Object.entries(orderFiles).forEach(([sequence, files]) => {
        files.forEach((file) => editFormData.append(`orderImages_${sequence}`, file))
      })
      setInvoiceFiles([])
      setOrderFiles({})
      const updated = await api.patch<ReimbursementRecord>(`/api/reimbursements/${id}`, editFormData, true)
      setRecord(updated)
      setForm(reimbursementToForm(updated))
      setMessage('报销单已更新。')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  function isPdfAttachment(name: string, mime?: string) {
    return Boolean(mime?.startsWith('application/pdf')) || name.toLowerCase().endsWith('.pdf')
  }

  async function deleteSavedAttachment(attachmentId: string) {
    try {
      setMessage('')
      await api.delete<{ id: string }>(`/api/reimbursements/attachments/${attachmentId}`)
      if (record) {
        setRecord({
          ...record,
          attachments: record.attachments.filter((item) => item.id !== attachmentId),
          orders: record.orders.map((order) => ({
            ...order,
            attachments: order.attachments.filter((item) => item.id !== attachmentId),
          })),
        })
      }
      setMessage('附件已删除，可以重新上传。')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }
  function renderAttachment(
    url: string,
    name: string,
    mime?: string,
    onDelete?: () => void,
  ) {
    const content = isPdfAttachment(name, mime) ? (
      <button
        type="button"
        onClick={() => setPreviewImage({ src: url, alt: name, isPdf: true })}
        className="flex h-36 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-600 transition hover:scale-[1.02]"
      >
        <FileText className="h-6 w-6 shrink-0 text-rose-500" />
        <span className="truncate">{name}</span>
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setPreviewImage({ src: url, alt: name })}
        className="overflow-hidden rounded-2xl"
      >
        <img src={url} alt={name} className="h-36 w-full rounded-2xl object-cover transition hover:scale-[1.02]" />
      </button>
    )
    return (
      <div key={`${name}-${url}`} className="relative">
        {content}
        {onDelete ? (
          <button
            type="button"
            title="删除附件"
            aria-label={`删除附件：${name}`}
            onClick={(event) => {
              event.stopPropagation()
              onDelete()
            }}
            className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-rose-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-rose-50"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <ShellLayout
      title={mode === 'create' ? '新建报销单' : '编辑报销单'}
      subtitle="按照新导图重构为发票主信息 + 多子订单的复合表单。主订单默认为母单，后续订单将作为同发票子单导出。"
    >
      <div className="mb-4"><CategoryPicker
          value={form.categoryId || null}
          onChange={(categoryId) => setForm((current) => ({ ...current, categoryId: categoryId ?? '' }))}
          role={user?.role ?? 'employee'}
          disabled={!canEditRecord}
          locked={!!lockedFields['categoryId']}
          onToggleLock={() => toggleLock('categoryId')}
        /></div>
        {record ? (
        <div className="mb-4 flex items-center gap-3">
          <ReimbursementStatusBadge status={record.status} />
          <div className="text-sm text-slate-500">创建人：{record.creator.displayName}</div>
        </div>
      ) : null}
      {mode === 'edit' && !canEditRecord ? (
        <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
          当前账号仅可查看该报销单详情，不能直接修改内容。
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
                <section
          className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          onDragOver={(event) => {
            event.preventDefault()
            if (canEditRecord) setDragTarget({ kind: 'invoice' })
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            const related = event.relatedTarget as Node | null
            if (related && event.currentTarget.contains(related)) return
            setDragTarget((current) => (current?.kind === 'invoice' ? null : current))
          }}
          onDrop={async (event) => {
            event.preventDefault()
            setDragTarget(null)
            if (!canEditRecord || event.dataTransfer.files.length === 0) return
            setOcrPreview('')
            setOcrProgressText('')
            const droppedInvoiceFiles = await handleFiles(event.dataTransfer.files, '发票截图')
            setInvoiceFiles((current) => [...current, ...droppedInvoiceFiles])
          }}
        >
          <div>
            <h2 className="flex flex-wrap items-center gap-2 font-[CrimsonPro] text-3xl text-slate-950">
              发票主信息
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold leading-none text-emerald-700">PRO</span>
            </h2>
            <div className="mt-2 text-sm text-slate-500">发票信息、发票截图上传和 OCR 识别集中放在这张卡片内处理；发票格式固定，始终使用强化版 OCR。</div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">订单识别方式：</span>
              <button
                type="button"
                onClick={() => { setOcrPreference('local'); setOcrPref('local') }}
                className={cn('rounded-full border px-3 py-1 transition', ocrPreference === 'local' ? 'border-sky-500 bg-sky-50 font-medium text-sky-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}
              >
                本地识别（推荐）
              </button>
              <button
                type="button"
                onClick={() => { setOcrPreference('server'); setOcrPref('server') }}
                title="仅切换订单识别方式；发票始终使用本地强化版 OCR"
                className={cn('rounded-full border px-3 py-1 transition', ocrPreference === 'server' ? 'border-sky-500 bg-sky-50 font-medium text-sky-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}
              >
                服务器端识别
              </button>
              <span className="text-slate-400">仅影响右侧订单识别；发票始终走强化版 OCR</span>
            </div>
            <LocalOcrGuide preference={ocrPreference} />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {[
                ['title', '报销标题'],
                ['invoiceSellerName', '销售方名称'],
                ['invoiceSellerTaxNo', '销售方税号'],
                ['invoiceAmountExcludingTax', '金额合计（不含税）'],
                ['invoiceTaxAmount', '税额合计'],
                ['invoiceTotalAmount', '价税合计'],
                ['invoiceNumber', '发票号码'],
              ].map(([key, label]) => (
                <label key={key} className="block">
                  <FieldLabel
                    label={label}
                    locked={!!lockedFields[key]}
                    canEdit={canEditRecord}
                    onToggleLock={() => toggleLock(key)}
                  />
                  <input
                    value={form[key as keyof ReimbursementFormState] as string}
                    onChange={(event) => {
                      const value = INVOICE_AMOUNT_FIELDS.has(key) ? sanitizeAmountInput(event.target.value) : event.target.value
                      setForm((current) => ({ ...current, [key]: value }))
                    }}
                    onFocus={() => clearHighlight(key)}
                    className={cn(
                      fieldClass,
                      highlightedFields[key] ? highlightedClass : '',
                      key === 'invoiceNumber' && duplicateState.invoice ? highlightedClass : '',
                    )}
                  />
                  {key === 'invoiceNumber' && duplicateState.invoice ? (
                    <span className="mt-1 block text-xs font-medium text-rose-600">发票号码 “{duplicateState.invoice}” 与已有记录重复，保存已被禁止。</span>
                  ) : null}
                </label>
              ))}
              <label className="block">
                <FieldLabel
                  label="税率"
                  locked={!!lockedFields['invoiceTaxRate']}
                  canEdit={canEditRecord}
                  onToggleLock={() => toggleLock('invoiceTaxRate')}
                />
                <input
                  value={taxRateEditing ? taxRateDraft : form.invoiceTaxRate}
                  onFocus={() => {
                    clearHighlight('invoiceTaxRate')
                    setTaxRateEditing(true)
                    setTaxRateDraft(form.invoiceTaxRate.replace('%', ''))
                  }}
                  onChange={(event) => setTaxRateDraft(sanitizePercentInput(event.target.value))}
                  onBlur={() => {
                    setTaxRateEditing(false)
                    const v = taxRateDraft.trim()
                    setForm((current) => ({ ...current, invoiceTaxRate: v ? `${v}%` : '' }))
                  }}
                  className={cn(fieldClass, highlightedFields['invoiceTaxRate'] ? highlightedClass : '')}
                />
              </label>
              <label className="block">
                <FieldLabel
                  label="发票状态"
                  locked={!!lockedFields['invoiceStatus']}
                  canEdit={canEditRecord}
                  onToggleLock={() => toggleLock('invoiceStatus')}
                />
                <select
                  value={form.invoiceStatus}
                  onChange={(event) => setForm((current) => ({ ...current, invoiceStatus: event.target.value as InvoiceStatus }))}
                  onFocus={() => clearHighlight('invoiceStatus')}
                  className={cn(fieldClass, highlightedFields['invoiceStatus'] ? highlightedClass : '')}
                >
                  {invoiceStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div
            onClick={() => setActiveUploadTarget({ kind: 'invoice' })}
            onDragOver={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (canEditRecord) setDragTarget({ kind: 'invoice' })
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setDragTarget((current) => (current?.kind === 'invoice' ? null : current))
            }}
            onDrop={async (event) => {
              event.preventDefault()
              event.stopPropagation()
              setDragTarget(null)
              if (!canEditRecord || event.dataTransfer.files.length === 0) return
              setOcrPreview('')
              setOcrProgressText('')
              const droppedInvoiceFiles = await handleFiles(event.dataTransfer.files, '发票截图')
              setInvoiceFiles((current) => [...current, ...droppedInvoiceFiles])
            }}
            className={`cursor-pointer rounded-3xl border-2 border-dashed p-5 transition ${uploadAreaClass(
              dragTarget?.kind === 'invoice',
              activeUploadTarget?.kind === 'invoice',
            )}`}
          >
            <div className="flex items-center gap-3 text-sm font-medium text-slate-700">
              <ImagePlus className="h-4 w-4" />
              上传发票截图
            </div>
            <div className="mt-2 text-xs text-slate-500">
              支持超大图片自动压缩，上传后可点击缩略图查看大图，也可以一键识别发票主信息。
            </div>
            <div className="mt-1 text-xs text-amber-700">
              点击此区域后即可使用 <kbd className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold">Ctrl</kbd>/
              <kbd className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold">⌘</kbd>+<kbd className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold">V</kbd> 粘贴截图，也支持直接把图片/PDF 拖入此区域。
            </div>
            {canEditRecord ? (
              <input
                type="file"
                multiple
                accept="image/*,application/pdf"
                onChange={async (event) => {
                  setOcrPreview('')
                  setOcrProgressText('')
                  const selectedInvoiceFiles = await handleFiles(event.target.files, '发票截图')
                  setInvoiceFiles((current) => [...current, ...selectedInvoiceFiles])
                }}
                className="mt-4 w-full text-sm text-slate-700"
              />
            ) : null}

            {invoiceFiles.length > 0 ? (
              <>
                <div className="mt-4 text-xs text-slate-500">点击缩略图可查看大图。</div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {invoiceFiles.map((file, index) => renderAttachment(URL.createObjectURL(file), file.name, file.type, canEditRecord ? () => setInvoiceFiles((current) => current.filter((_, i) => i !== index)) : undefined))}
                </div>
              </>
            ) : null}

            {record?.attachments.length ? (
              <>
                <div className="mt-4 text-xs text-slate-500">点击缩略图可查看大图（已保存到服务器）。</div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {record.attachments.map((attachment) => renderAttachment(attachment.fileUrl, attachment.fileName, attachment.mimeType, canEditRecord ? () => deleteSavedAttachment(attachment.id) : undefined))}
                </div>
              </>
            ) : null}

            {canEditRecord && invoiceFiles.length > 0 ? (
              <button
                type="button"
                onClick={runInvoiceOcr}
                disabled={ocrPending}
                className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ScanText className="h-4 w-4" />
                {ocrPending ? ocrProgressText || '正在识别发票...' : '识别发票主信息'}
              </button>
            ) : null}

            {ocrPending && ocrProgressText ? (
              <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-700">
                {ocrProgressText}
              </div>
            ) : null}

            {ocrPreview ? (
              <div className="mt-3 max-h-40 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <div className="mb-2 font-medium text-slate-900">OCR 识别文本预览</div>
                <div className="max-h-40 overflow-auto whitespace-pre-wrap">{ocrPreview}</div>
              </div>
            ) : null}
          </div>

          <div className={`rounded-3xl border p-5 text-sm ${amountDiff > 0.01 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            <div className="font-medium">金额校验</div>
            <div className="mt-3">
              订单支付金额合计：{paymentTotal.toFixed(2)} 元
              <br />
              发票价税合计：{Number(form.invoiceTotalAmount || 0).toFixed(2)} 元
            </div>
            {amountDiff > 0.01 ? (
              <div className="mt-3">两者当前不一致，送审时需填写金额差异说明并选择报销标准，暂存（草稿/未完结）不受影响。</div>
            ) : (
              <div className="mt-3">两者当前一致，可以直接保存或送审。</div>
            )}
          </div>
        </section>

        <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-[CrimsonPro] text-3xl text-slate-950">订单子单</h2>
              <div className="mt-2 text-sm text-slate-500">订单里所有固定选项字段都改为下拉菜单，遇到"其他"会出现补充输入框。</div>
            </div>
            <button
              type="button"
              onClick={() => setForm((current) => ({ ...current, orders: [...current.orders, createEmptyOrder(current.orders.length + 1)] }))}
              className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
            >
              <Plus className="h-4 w-4" />
              增加同发票子订单
            </button>
          </div>

          <div className="space-y-5">
            {form.orders.map((order, index) => {
              const platformNameOptions =
                platformNameOptionsByCategory[order.platformCategory as keyof typeof platformNameOptionsByCategory] ?? []

              return (
                <div
                  key={order.sequence}
                  className="rounded-3xl border border-slate-200 bg-slate-50 p-5"
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (canEditRecord) setDragTarget({ kind: 'order', sequence: order.sequence })
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault()
                    const related = event.relatedTarget as Node | null
                    if (related && event.currentTarget.contains(related)) return
                    setDragTarget((current) => (current?.kind === 'order' && current.sequence === order.sequence ? null : current))
                  }}
                  onDrop={async (event) => {
                    event.preventDefault()
                    setDragTarget(null)
                    if (!canEditRecord || event.dataTransfer.files.length === 0) return
                    const files = (await handleFiles(event.dataTransfer.files, `子订单 ${order.sequence} 截图`)).slice(0, 2)
                    setOrderFiles((current) => ({ ...current, [order.sequence]: [...(current[order.sequence] ?? []), ...files].slice(0, 2) }))
                  }}
                >
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="font-medium text-slate-900">子订单 {order.sequence} {index === 0 ? '（母单）' : ''}</div>
                    <div className="flex items-center gap-2">
                      <PaymentModeBadge mode={order.paymentMode} />
                      {form.orders.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => setForm((current) => ({
                            ...current,
                            orders: current.orders
                              .filter((item) => item.sequence !== order.sequence)
                              .map((item, itemIndex) => ({ ...item, sequence: itemIndex + 1 })),
                          }))}
                          className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs text-rose-600"
                        >
                          删除子单
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <FieldLabel

                        label="平台分类"

                        locked={!!lockedFields['order.platformCategory']}

                        canEdit={canEditRecord}

                        onToggleLock={() => toggleLock('order.platformCategory')}

                      />
                      <select
                        value={order.platformCategory}
                        onChange={(event) => {
                          const nextCategory = event.target.value
                          const nextOptions =
                            platformNameOptionsByCategory[nextCategory as keyof typeof platformNameOptionsByCategory] ?? []
                          const keepCurrentPlatform = nextOptions.includes(order.platformName)
                          updateOrder(index, {
                            platformCategory: nextCategory,
                            platformName: keepCurrentPlatform ? order.platformName : '',
                            platformNameOther: '',
                          })
                        }}
                        className={mutedFieldClass}
                      >
                        {platformCategoryOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <FieldLabel

                        label="平台名称"

                        locked={!!lockedFields['order.platformName']}

                        canEdit={canEditRecord}

                        onToggleLock={() => toggleLock('order.platformName')}

                      />
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setOpenPlatformIndex((current) => (current === index ? null : index))}
                          onFocus={() => clearHighlight('order.platformName')}
                          className={cn(mutedFieldClass, 'flex items-center justify-between gap-2 text-left', highlightedFields['order.platformName'] ? highlightedClass : '')}
                        >
                          <span className="flex items-center gap-2">
                            {order.platformName || "请选择"}
                            {targetedPlatformNames.includes(order.platformName as (typeof targetedPlatformNames)[number]) ? (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold leading-none text-emerald-700">PRO</span>
                            ) : null}
                          </span>
                          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                        </button>
                        {openPlatformIndex === index ? (
                          <div className="absolute z-20 mt-1 w-full rounded-2xl border border-slate-200 bg-white p-1 shadow-lg">
                            <button
                              type="button"
                              onClick={() => selectPlatform(index, "")}
                              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
                            >
                              请选择
                            </button>
                            {platformNameOptions.map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => selectPlatform(index, option)}
                                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                              >
                                <span>{option}</span>
                                {targetedPlatformNames.includes(option as (typeof targetedPlatformNames)[number]) ? (
                                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold leading-none text-emerald-700">PRO</span>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </label>

                    {order.platformName === '其他' ? (
                      <label className="block md:col-span-2">
                        <FieldLabel

                          label="其他平台名称"

                          locked={!!lockedFields['order.platformNameOther']}

                          canEdit={canEditRecord}

                          onToggleLock={() => toggleLock('order.platformNameOther')}

                        />
                        <input
                          value={order.platformNameOther}
                          onChange={(event) => updateOrder(index, { platformNameOther: event.target.value })}
                          placeholder="请输入具体平台名称"
                          className={mutedFieldClass}
                        />
                      </label>
                    ) : null}

                    <label className="block">
                      <FieldLabel

                        label="商家名称"

                        locked={!!lockedFields['order.merchantName']}

                        canEdit={canEditRecord}

                        onToggleLock={() => toggleLock('order.merchantName')}

                      />
                      <input value={order.merchantName} onChange={(event) => updateOrder(index, { merchantName: event.target.value })} onFocus={() => clearHighlight('order.merchantName')} className={cn(mutedFieldClass, highlightedFields['order.merchantName'] ? highlightedClass : '')} />
                    </label>

                    <label className="block">
                      <FieldLabel

                        label="商品信息"

                        locked={!!lockedFields['order.itemDescription']}

                        canEdit={canEditRecord}

                        onToggleLock={() => toggleLock('order.itemDescription')}

                      />
                      <input value={order.itemDescription} onChange={(event) => updateOrder(index, { itemDescription: event.target.value })} onFocus={() => clearHighlight('order.itemDescription')} className={cn(mutedFieldClass, highlightedFields['order.itemDescription'] ? highlightedClass : '')} />
                    </label>

                    <label className="block">
                      <FieldLabel

                        label="订单号"

                        locked={!!lockedFields['order.orderNumber']}

                        canEdit={canEditRecord}

                        onToggleLock={() => toggleLock('order.orderNumber')}

                      />
                      <input
                        value={order.orderNumber}
                        onChange={(event) => updateOrder(index, { orderNumber: event.target.value })}
                        onFocus={() => clearHighlight('order.orderNumber')}
                        className={cn(
                          mutedFieldClass,
                          highlightedFields['order.orderNumber'] ? highlightedClass : '',
                          duplicateState.orders[index] ? highlightedClass : '',
                        )}
                      />
                      {duplicateState.orders[index] ? (
                        <span className="mt-1 block text-xs font-medium text-rose-600">订单号 “{duplicateState.orders[index]}” 与已有记录重复，保存已被禁止。</span>
                      ) : null}
                    </label>

                    <label className="block">
                      <FieldLabel

                        label="支付时间"

                        locked={!!lockedFields['order.paymentTime']}

                        canEdit={canEditRecord}

                        onToggleLock={() => toggleLock('order.paymentTime')}

                      />
                      <input
                        type="datetime-local"
                        value={order.paymentTime ? order.paymentTime.replace(' ', 'T').slice(0, 16) : ''}
                        onChange={(event) => updateOrder(index, { paymentTime: event.target.value ? event.target.value.replace('T', ' ') : '' })}
                        onFocus={() => clearHighlight('order.paymentTime')}
                        className={cn(mutedFieldClass, highlightedFields['order.paymentTime'] ? highlightedClass : '')}
                      />
                    </label>

                    <label className="block">
                      <FieldLabel

                        label="支付金额"

                        locked={!!lockedFields['order.paymentAmount']}

                        canEdit={canEditRecord}

                        onToggleLock={() => toggleLock('order.paymentAmount')}

                      />
                      <input value={order.paymentAmount} onChange={(event) => updateOrder(index, { paymentAmount: sanitizeAmountInput(event.target.value) })} onFocus={() => clearHighlight('order.paymentAmount')} className={cn(mutedFieldClass, highlightedFields['order.paymentAmount'] ? highlightedClass : '')} />
                    </label>

                    <label className="block">
                      <FieldLabel

                        label="订单状态"

                        locked={!!lockedFields['order.orderStatus']}

                        canEdit={canEditRecord}

                        onToggleLock={() => toggleLock('order.orderStatus')}

                      />
                      <select
                        value={order.orderStatus}
                        onChange={(event) => updateOrder(index, { orderStatus: event.target.value })}
                        className={mutedFieldClass}
                      >
                        {orderStatusOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <FieldLabel

                        label="采购人"

                        locked={!!lockedFields['order.purchaserId']}

                        canEdit={canEditRecord}

                        onToggleLock={() => toggleLock('order.purchaserId')}

                      />
                      <select
                        value={order.purchaserId}
                        onChange={(event) => updateOrder(index, { purchaserId: event.target.value })}
                        className={mutedFieldClass}
                      >
                        <option value="">请选择</option>
                        {users.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
                      </select>
                    </label>

                    <label className="block">
                      <FieldLabel

                        label="报销方式"

                        locked={!!lockedFields['order.paymentMode']}

                        canEdit={canEditRecord}

                        onToggleLock={() => toggleLock('order.paymentMode')}

                      />
                      <select
                        value={order.paymentMode}
                        onChange={(event) => updateOrder(index, { paymentMode: event.target.value as PaymentMode })}
                        className={mutedFieldClass}
                      >
                        {paymentModeOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block md:col-span-2">
                      <FieldLabel

                        label="使用人（可多选）"

                        locked={!!lockedFields['order.userIds']}

                        canEdit={canEditRecord}

                        onToggleLock={() => toggleLock('order.userIds')}

                      />
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="mb-3 text-xs text-slate-500">请直接勾选对应账号，可多选；每个账号前都有独立小方框。</div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {users.map((item) => {
                            const checked = order.userIds.includes(item.id)

                            return (
                              <label
                                key={item.id}
                                className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                                  checked
                                    ? 'border-amber-300 bg-amber-50 text-slate-900'
                                    : 'border-slate-200 bg-slate-50 text-slate-700'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleOrderUser(index, item.id)}
                                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                                />
                                <div className="min-w-0">
                                  <div className="font-medium">{item.displayName}</div>
                                  <div className="mt-1 text-xs text-slate-500">{item.username}</div>
                                </div>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    </label>

                    <label className="block md:col-span-2">
                      <FieldLabel

                        label="备注"

                        locked={!!lockedFields['order.note']}

                        canEdit={canEditRecord}

                        onToggleLock={() => toggleLock('order.note')}

                      />
                      <textarea rows={3} value={order.note} onChange={(event) => updateOrder(index, { note: event.target.value })} className={textareaClass} />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {[...defaultNotePresets, ...customNotePresets].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={(event) => {
                              event.preventDefault()
                              appendNotePreset(index, preset)
                            }}
                            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-amber-300 hover:text-slate-900"
                          >
                            {preset}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault()
                            addCustomNotePreset()
                          }}
                          title="新建自定义备注备选项"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:text-slate-900"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </label>

                    <div
                      onClick={() => setActiveUploadTarget({ kind: 'order', sequence: order.sequence })}
                      onDragOver={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        if (canEditRecord) setDragTarget({ kind: 'order', sequence: order.sequence })
                      }}
                      onDragLeave={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setDragTarget((current) => (current?.kind === 'order' && current.sequence === order.sequence ? null : current))
                      }}
                      onDrop={async (event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setDragTarget(null)
                        if (!canEditRecord || event.dataTransfer.files.length === 0) return
                        const files = (await handleFiles(event.dataTransfer.files, `子订单 ${order.sequence} 截图`)).slice(0, 2)
                        setOrderFiles((current) => ({ ...current, [order.sequence]: [...(current[order.sequence] ?? []), ...files].slice(0, 2) }))
                      }}
                      className={`block md:col-span-2 cursor-pointer rounded-2xl border-2 border-dashed p-3 transition ${uploadAreaClass(
                        dragTarget?.kind === 'order' && dragTarget.sequence === order.sequence,
                        activeUploadTarget?.kind === 'order' && activeUploadTarget.sequence === order.sequence,
                      )}`}
                    >
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                        <ImagePlus className="h-4 w-4" />
                        订单截图（最多两张）
                      </div>
                      <div className="mb-2 text-xs text-slate-500">支持上传大图，超过 10MB 会自动压缩。上传后可点击缩略图查看大图。</div>
                      <div className="mb-2 text-xs text-amber-700">点击此区域后即可 Ctrl/⌘+V 粘贴，也支持直接拖入图片或 PDF。</div>
                      {canEditRecord ? (
                        <input
                          type="file"
                          multiple
                          accept="image/*,application/pdf"
                          onChange={async (event) => {
                            const files = (await handleFiles(event.target.files, `子订单 ${order.sequence} 截图`)).slice(0, 2)
                            setOrderFiles((current) => ({ ...current, [order.sequence]: [...(current[order.sequence] ?? []), ...files].slice(0, 2) }))
                          }}
                          className="w-full text-sm text-slate-700"
                        />
                      ) : null}
                    </div>

                    {canEditRecord && orderFiles[order.sequence]?.length ? (
                      <div className="md:col-span-2">
                        <div className="mb-2 text-xs text-slate-500">点击缩略图可查看大图。</div>
                        <div className="grid grid-cols-2 gap-3">
                          {orderFiles[order.sequence].map((file, index) =>
                            renderAttachment(URL.createObjectURL(file), file.name, file.type, canEditRecord ? () => setOrderFiles((current) => ({ ...current, [order.sequence]: (current[order.sequence] ?? []).filter((_, i) => i !== index) })) : undefined),
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => runOrderOcr(index, order.sequence)}
                          disabled={orderOcrPending[order.sequence]}
                          className="mt-3 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <ScanText className="h-4 w-4" />
                          {orderOcrPending[order.sequence] ? '正在识别订单...' : '识别订单信息'}
                        </button>
                        {orderOcrProgress[order.sequence] ? (
                          <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-700">
                            {orderOcrProgress[order.sequence]}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {record?.orders.find((item) => item.sequence === order.sequence)?.attachments.length ? (
                      <div className="md:col-span-2">
                        <div className="mb-2 text-xs text-slate-500">点击缩略图可查看大图（已保存到服务器）。</div>
                        <div className="grid grid-cols-2 gap-3">
                          {record.orders.find((item) => item.sequence === order.sequence)?.attachments.map((attachment) =>
                            renderAttachment(attachment.fileUrl, attachment.fileName, attachment.mimeType, canEditRecord ? () => deleteSavedAttachment(attachment.id) : undefined),
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {hasAmountMismatch ? (
          <section className="mb-6 rounded-3xl border border-amber-300 bg-amber-50 p-6">
            <h2 className="font-[CrimsonPro] text-2xl text-amber-900">金额报销标准（实际报销金额）</h2>
            <div className="mt-2 text-sm text-amber-800">
              发票价税合计（{Number(form.invoiceTotalAmount || 0).toFixed(2)} 元）与订单支付金额合计（{paymentTotal.toFixed(2)} 元）不一致，请选择实际报销金额的依据标准。
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-5 py-4 text-sm transition ${form.amountStandard === 'invoice' ? 'border-amber-500 bg-white text-slate-900 shadow' : 'border-amber-200 bg-white/50 text-slate-600'}`}>
                <input
                  type="radio"
                  name="amountStandard"
                  checked={form.amountStandard === 'invoice'}
                  onChange={() => setForm((current) => ({ ...current, amountStandard: 'invoice' as AmountStandard }))}
                  className="h-4 w-4"
                />
                <span>
                  <span className="font-medium">以发票金额为准</span>
                  <span className="mt-1 block text-xs text-slate-500">报销金额 = {Number(form.invoiceTotalAmount || 0).toFixed(2)} 元</span>
                </span>
              </label>
              <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-5 py-4 text-sm transition ${form.amountStandard === 'orders' ? 'border-amber-500 bg-white text-slate-900 shadow' : 'border-amber-200 bg-white/50 text-slate-600'}`}>
                <input
                  type="radio"
                  name="amountStandard"
                  checked={form.amountStandard === 'orders'}
                  onChange={() => setForm((current) => ({ ...current, amountStandard: 'orders' as AmountStandard }))}
                  className="h-4 w-4"
                />
                <span>
                  <span className="font-medium">以订单截图中实际支付金额之和为准</span>
                  <span className="mt-1 block text-xs text-slate-500">报销金额 = {paymentTotal.toFixed(2)} 元</span>
                </span>
              </label>
            </div>
            {!form.amountStandard ? (
              <div className="mt-3 text-xs font-medium text-rose-600">尚未选择报销标准，选择后才能保存或提交。</div>
            ) : null}
            <label className="mt-5 block">
              <div className="mb-2 text-sm font-medium text-amber-900">金额差异说明（送审时必填）</div>
              <textarea
                rows={3}
                value={form.amountMismatchNote}
                onChange={(event) => setForm((current) => ({ ...current, amountMismatchNote: event.target.value }))}
                placeholder="请说明发票金额与订单金额不一致的原因，例如：部分订单无需报销、发票包含其他费用等。"
                className="w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-amber-400"
              />
            </label>
            <div className="mt-3 text-xs text-amber-700">
              {form.amountMismatchNote.trim()
                ? '已填写情况说明，可以送审。'
                : '未填写情况说明时不允许送审，但可以暂存为草稿或未完结。'}
            </div>
          </section>
        ) : null}
<section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-[CrimsonPro] text-3xl text-slate-950">页面操作</h2>
            <div className="mt-2 text-sm text-slate-500">
              草稿用于尚未整理完成的报销单；点击提交后会进入未完结；未完结再点击送审才会进入审批流程。
            </div>
          </div>
          {message ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {message}
            </div>
          ) : null}
          {duplicateState.invoice || Object.keys(duplicateState.orders).length > 0 ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              检测到与已有记录重复的编号，已禁止一切保存操作：
              {[duplicateState.invoice && `发票号码 “${duplicateState.invoice}”`, ...Object.values(duplicateState.orders).map((value) => `订单号 “${value}”`)].filter(Boolean).join('、')}
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {canEditRecord ? (
            <>
              <button
                  type="button"
                  onClick={() => submit('draft')}
                  disabled={submitting}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {submitting ? '保存中…' : '保存为草稿'}
                </button>
              <button
                type="button"
                onClick={() => submit(submitTargetStatus)}
                disabled={submitting}
                className="flex items-center justify-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <SendHorizonal className="h-4 w-4" />
                {submitting ? '提交中…' : submitButtonLabel}
              </button>
              {mode === 'edit' && !!user && !!record && user.id === record.creator.id && (currentStatus === 'pending_review' || currentStatus === 'needs_revision') ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const updated = await api.post<ReimbursementRecord>(`/api/reimbursements/${id}/withdraw`, {})
                      setRecord(updated)
                      setForm(reimbursementToForm(updated))
                      setMessage('已撤回送审，报销单回到未结束状态，可继续编辑。')
                    } catch (error) {
                      setMessage((error as Error).message)
                    }
                  }}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm text-sky-600"
                >
                  <RotateCcw className="h-4 w-4" />
                  撤回送审
                </button>
              ) : null}
              {mode === 'create' ? (
                <>
                  <button
                    type="button"
                    onClick={() => submit('draft', { openNew: true })}
                    disabled={submitting}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Save className="h-4 w-4" />
                    {submitting ? '保存中…' : '保存为草稿并新建报销单'}
                  </button>
                  <button
                    type="button"
                    onClick={() => submit(submitTargetStatus, { openNew: true })}
                    disabled={submitting}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <SendHorizonal className="h-4 w-4" />
                    {submitting ? '提交中…' : '提交为未完结并新建报销单'}
                  </button>
                  <button
                    type="button"
                    onClick={() => clearUnlockedFields()}
                    title="清除所有未锁定字段的内容，锁定的字段保留（含截图）"
                    className="flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-600 hover:bg-rose-50"
                  >
                    <Eraser className="h-4 w-4" />
                    清除未锁定项
                  </button>
                </>
              ) : null}
              {mode === 'edit' ? (
                <button
                  type="button"
                  onClick={async () => {
                    await api.delete(`/api/reimbursements/${id}`)
                    navigate('/records')
                  }}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-600"
                >
                  <Trash2 className="h-4 w-4" />
                  删除报销单
                </button>
              ) : null}
            </>
          ) : null}
          {canMarkReimbursed ? (
            <button
              type="button"
              onClick={async () => {
                try {
                  const updated = await api.post<ReimbursementRecord>(`/api/reimbursements/${id}/reimburse`, {})
                  setRecord(updated)
                  setForm(reimbursementToForm(updated))
                  setMessage('已标记为已报销。')
                } catch (error) {
                  setMessage((error as Error).message)
                }
              }}
              className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-medium text-white"
            >
              <Banknote className="h-4 w-4" />
              标记为已报销
            </button>
          ) : null}
        </div>
      </section>
      {previewImage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-6">
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute right-6 top-6 rounded-full border border-white/20 bg-white/10 p-2 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {previewImage.isPdf ? (
            <iframe src={previewImage.src} title={previewImage.alt} className="h-[85vh] w-[85vw] rounded-3xl bg-white" />
          ) : (
            <img src={previewImage.src} alt={previewImage.alt} className="max-h-[88vh] max-w-[88vw] rounded-3xl object-contain" />
          )}
        </div>
      ) : null}
    </ShellLayout>
  )
}
