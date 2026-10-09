import type { Prisma, ReimbursementStatus, Role } from '@prisma/client'
import type { RecordFilters } from '../types.js'
import { toPublicFilePath } from './storage.js'

export const reimbursementInclude = {
  category: {
    select: { id: true, name: true, sortOrder: true },
  },
  creator: true,
  orders: {
    include: {
      purchaser: true,
      participants: {
        include: {
          user: true,
        },
      },
      attachments: {
        orderBy: {
          sortOrder: 'asc' as const,
        },
      },
    },
    orderBy: {
      sequence: 'asc' as const,
    },
  },
  attachments: {
    orderBy: {
      sortOrder: 'asc' as const,
    },
  },
  reviewLogs: {
    include: {
      operator: true,
    },
    orderBy: {
      createdAt: 'desc' as const,
    },
  },
} as const

type IncludedReimbursement = Prisma.ReimbursementGetPayload<{
  include: typeof reimbursementInclude
}>

function isPrivileged(role: Role) {
  return role === 'leader' || role === 'finance' || role === 'admin'
}

// 4.0.9: 查询参数枚举白名单——非法值（注入/手误）一律按未筛选处理，
// 防止未校验的枚举直达 Prisma 触发 ValidationError 打崩进程。
const STATUS_WHITELIST = new Set(['draft', 'unfinished', 'pending_review', 'needs_revision', 'completed', 'reimbursed'])
const INVOICE_STATUS_WHITELIST = new Set(['none', 'not_issued', 'waiting_issued', 'issued'])
const PAYMENT_MODE_WHITELIST = new Set(['personal_reimbursement', 'reserve_fund'])

function sanitizeEnumFilters(filters: RecordFilters): RecordFilters {
  return {
    ...filters,
    status: filters.status && STATUS_WHITELIST.has(filters.status) ? filters.status : undefined,
    invoiceStatus:
      filters.invoiceStatus && INVOICE_STATUS_WHITELIST.has(filters.invoiceStatus)
        ? filters.invoiceStatus
        : undefined,
    paymentMode:
      filters.paymentMode && PAYMENT_MODE_WHITELIST.has(filters.paymentMode) ? filters.paymentMode : undefined,
  }
}

export function buildRecordWhere(filters: RecordFilters, role: Role, userId: string): Prisma.ReimbursementWhereInput {
  filters = sanitizeEnumFilters(filters)
  const orderConditions: Prisma.OrderItemWhereInput[] = []
  const where: Prisma.ReimbursementWhereInput = {}

  if (!isPrivileged(role)) {
    where.creatorId = userId
  } else if (role === 'finance') {
    where.status = {
      in: ['completed', 'reimbursed'],
    }
  } else if (filters.creatorId) {
    where.creatorId = filters.creatorId
  }

  if (filters.status && filters.status !== 'all') {
    where.status = filters.status as ReimbursementStatus
  }

  if (filters.invoiceStatus && filters.invoiceStatus !== 'all') {
    where.invoiceStatus = filters.invoiceStatus
  }

  if (filters.categoryId === 'none') {
    where.categoryId = null
  } else if (filters.categoryId) {
    where.categoryId = filters.categoryId
  }

  if (filters.keyword) {
    where.OR = [
      { title: { contains: filters.keyword } },
      { invoiceNumber: { contains: filters.keyword } },
      { invoiceSellerName: { contains: filters.keyword } },
      {
        orders: {
          some: {
            OR: [
              { platformName: { contains: filters.keyword } },
              { merchantName: { contains: filters.keyword } },
              { itemDescription: { contains: filters.keyword } },
              { orderNumber: { contains: filters.keyword } },
              { note: { contains: filters.keyword } },
            ],
          },
        },
      },
    ]
  }

  if (filters.paymentMode && filters.paymentMode !== 'all') {
    orderConditions.push({
      paymentMode: filters.paymentMode,
    })
  }

  if (filters.purchaserId) {
    orderConditions.push({
      purchaserId: filters.purchaserId,
    })
  }

  if (filters.paymentFrom || filters.paymentTo) {
    orderConditions.push({
      paymentTime: {
        ...(filters.paymentFrom ? { gte: filters.paymentFrom } : {}),
        ...(filters.paymentTo ? { lte: filters.paymentTo } : {}),
      },
    })
  }

  if (orderConditions.length > 0) {
    where.orders = {
      some: {
        AND: orderConditions,
      },
    }
  }

  if (filters.createdFrom || filters.createdTo) {
    where.createdAt = {
      ...(filters.createdFrom ? { gte: new Date(filters.createdFrom) } : {}),
      ...(filters.createdTo ? { lte: new Date(`${filters.createdTo}T23:59:59.999Z`) } : {}),
    }
  }

  return where
}

export function serializeReimbursement(item: IncludedReimbursement) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    categoryId: item.categoryId,
    category: item.category
      ? { id: item.category.id, name: item.category.name, sortOrder: item.category.sortOrder }
      : null,
    invoiceSellerName: item.invoiceSellerName,
    invoiceSellerTaxNo: item.invoiceSellerTaxNo,
    invoiceAmountExcludingTax: item.invoiceAmountExcludingTax,
    invoiceTaxAmount: item.invoiceTaxAmount,
    invoiceTaxRate: item.invoiceTaxRate,
    invoiceTotalAmount: item.invoiceTotalAmount,
    invoiceNumber: item.invoiceNumber,
    invoiceStatus: item.invoiceStatus,
    rejectionReason: item.rejectionReason,
    amountStandard: item.amountStandard,
    amountMismatchNote: item.amountMismatchNote,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    creator: {
      id: item.creator.id,
      username: item.creator.username,
      displayName: item.creator.displayName,
      role: item.creator.role,
      reserveFundBalance: item.creator.reserveFundBalance,
    },
    attachments: item.attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      fileName: attachment.fileName,
      fileUrl: toPublicFilePath(attachment.filePath),
      mimeType: attachment.mimeType,
      sortOrder: attachment.sortOrder,
    })),
    orders: item.orders.map((order) => ({
      id: order.id,
      sequence: order.sequence,
      platformCategory: order.platformCategory,
      platformName: order.platformName,
      merchantName: order.merchantName,
      itemDescription: order.itemDescription,
      orderNumber: order.orderNumber,
      paymentTime: order.paymentTime,
      paymentAmount: order.paymentAmount,
      orderStatus: order.orderStatus,
      note: order.note,
      purchaserId: order.purchaserId,
      purchaserName: order.purchaser?.displayName ?? '',
      paymentMode: order.paymentMode,
      isParentOrder: order.isParentOrder,
      userIds: order.participants.map((participant) => participant.userId),
      userNames: order.participants.map((participant) => participant.user.displayName),
      attachments: order.attachments.map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        fileName: attachment.fileName,
        fileUrl: toPublicFilePath(attachment.filePath),
        mimeType: attachment.mimeType,
        sortOrder: attachment.sortOrder,
      })),
    })),
    reviewLogs: item.reviewLogs.map((log) => ({
      id: log.id,
      action: log.action,
      reason: log.reason,
      fromStatus: log.fromStatus,
      toStatus: log.toStatus,
      createdAt: log.createdAt,
      operatorName: log.operator.displayName,
    })),
  }
}

export function flattenForRecords(item: ReturnType<typeof serializeReimbursement>) {
  return item.orders.map((order) => ({
    reimbursementId: item.id,
    title: item.title,
    creatorId: item.creator.id,
    creatorName: item.creator.displayName,
    status: item.status,
    invoiceStatus: item.invoiceStatus,
    invoiceNumber: item.invoiceNumber,
    invoiceTotalAmount: item.invoiceTotalAmount,
    ordersPaymentSum: item.orders.reduce((sum, order) => sum + (Number(order.paymentAmount) || 0), 0),
    invoiceSellerName: item.invoiceSellerName,
    orderId: order.id,
    sequence: order.sequence,
    parentChildMarker: order.isParentOrder ? '母' : '子',
    parentInvoiceNumber: item.invoiceNumber,
    categoryId: item.categoryId ?? '',
    categoryName: item.category?.name ?? '',
    platformCategory: order.platformCategory,
    platformName: order.platformName,
    merchantName: order.merchantName,
    itemDescription: order.itemDescription,
    orderNumber: order.orderNumber,
    paymentTime: order.paymentTime,
    paymentAmount: order.paymentAmount,
    orderStatus: order.orderStatus,
    note: order.note,
 purchaserId: order.purchaserId,
    purchaserName: order.purchaserName,
    userNames: order.userNames.join('、'),
    paymentMode: order.paymentMode,
    invoiceAttachmentUrl: item.attachments[0]?.fileUrl ?? '',
    orderAttachmentUrl: order.attachments[0]?.fileUrl ?? '',
    amountStandard: item.amountStandard,
    amountMismatchNote: item.amountMismatchNote,
    rejectionReason: item.rejectionReason,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }))
}

type FlatRecordRow = ReturnType<typeof flattenForRecords>[number]

function includesKeyword(value: string | number | undefined, keyword: string) {
  return String(value ?? '')
    .toLowerCase()
    .includes(keyword.toLowerCase())
}

export function filterRecordRows(rows: FlatRecordRow[], filters: RecordFilters) {
  return rows.filter((row) => {
    if (filters.keyword) {
      const matchesKeyword = [
        row.title,
        row.invoiceNumber,
        row.invoiceSellerName,
        row.platformName,
        row.merchantName,
        row.itemDescription,
        row.orderNumber,
        row.note,
        row.creatorName,
        row.purchaserName,
        row.userNames,
      ].some((value) => includesKeyword(value, filters.keyword!))

      if (!matchesKeyword) {
        return false
      }
    }

    if (filters.status && filters.status !== 'all' && row.status !== filters.status) {
      return false
    }

    if (filters.invoiceStatus && filters.invoiceStatus !== 'all' && row.invoiceStatus !== filters.invoiceStatus) {
      return false
    }

    if (filters.paymentMode && filters.paymentMode !== 'all' && row.paymentMode !== filters.paymentMode) {
      return false
    }

    if (filters.creatorId && row.creatorId !== filters.creatorId) {
      return false
    }

    if (filters.purchaserId && row.purchaserId !== filters.purchaserId) {
      return false
    }

    if (filters.paymentFrom && row.paymentTime < filters.paymentFrom) {
      return false
    }

    if (filters.paymentTo && row.paymentTime > filters.paymentTo) {
      return false
    }

    if (filters.createdFrom && new Date(row.createdAt) < new Date(filters.createdFrom)) {
      return false
    }

    if (filters.createdTo && new Date(row.createdAt) > new Date(`${filters.createdTo}T23:59:59.999Z`)) {
      return false
    }

    if (filters.categoryId === 'none' && row.categoryId) {
      return false
    }

    if (filters.categoryId && filters.categoryId !== 'none' && row.categoryId !== filters.categoryId) {
      return false
    }

    return true
  })
}

const filterKeyLabels: Record<string, string> = {
  keyword: '关键字',
  status: '报销单状态',
  invoiceStatus: '开票状态',
  paymentMode: '报销方式',
  creatorId: '填单人',
  purchaserId: '采购人',
  createdFrom: '创建时间起',
  createdTo: '创建时间止',
  paymentFrom: '支付时间起',
  paymentTo: '支付时间止',
  categoryId: '分类',
}

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

export type FilterNameLookup = {
  creatorNames?: Record<string, string>
  purchaserNames?: Record<string, string>
  categoryNames?: Record<string, string>
}

// 3.6.1: 筛选条件摘要输出中文键名与中文枚举值。
export function summarizeFilters(filters: RecordFilters, names: FilterNameLookup = {}) {
  const parts: string[] = []
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || value === 'all') continue
    const label = filterKeyLabels[key] ?? key
    let display = String(value)
    if (key === 'status') display = reimbursementStatusLabels[String(value)] ?? display
    if (key === 'invoiceStatus') display = invoiceStatusLabels[String(value)] ?? display
    if (key === 'paymentMode') display = paymentModeLabels[String(value)] ?? display
    if (key === 'categoryId') display = value === 'none' ? '未分类' : names.categoryNames?.[String(value)] ?? display
    if (key === 'creatorId') display = names.creatorNames?.[String(value)] ?? display
    if (key === 'purchaserId') display = names.purchaserNames?.[String(value)] ?? display
    parts.push(`${label}: ${display}`)
  }
  return parts.join(' | ')
}

function formatTitleMonth(value: string | undefined): string {
  if (!value) return ''
  const match = /^(\d{4})-(\d{1,2})/.exec(value)
  if (match) return `${Number(match[1])}年${Number(match[2])}月`
  return value
}

// 4.0.8: 导出文件大标题与文件名使用同一套规则：
// 分类名 + 各筛选框的已选内容 + 支出明细 + 时间区间。
export function buildExportTitle(filters: RecordFilters, names: FilterNameLookup = {}) {
  const parts: string[] = []
  if (filters.keyword) parts.push(String(filters.keyword).trim())
  if (filters.status && filters.status !== 'all') {
    parts.push(reimbursementStatusLabels[filters.status] ?? filters.status)
  }
  if (filters.invoiceStatus && filters.invoiceStatus !== 'all') {
    parts.push(invoiceStatusLabels[filters.invoiceStatus] ?? filters.invoiceStatus)
  }
  if (filters.paymentMode && filters.paymentMode !== 'all') {
    parts.push(paymentModeLabels[filters.paymentMode] ?? filters.paymentMode)
  }
  if (filters.categoryId) {
    parts.push(filters.categoryId === 'none' ? '未分类' : names.categoryNames?.[filters.categoryId] ?? '')
  }
  if (filters.creatorId) {
    const name = names.creatorNames?.[filters.creatorId]
    if (name) parts.push(`${name}填写`)
  }
  if (filters.purchaserId) {
    const name = names.purchaserNames?.[filters.purchaserId]
    if (name) parts.push(`${name}使用`)
  }

  const from = filters.createdFrom || filters.paymentFrom
  const to = filters.createdTo || filters.paymentTo
  const fromText = formatTitleMonth(from)
  const toText = formatTitleMonth(to)
  let timeRange = ''
  if (fromText && toText) {
    timeRange = fromText === toText ? fromText : `${fromText}~${toText}`
  } else if (fromText) {
    timeRange = `${fromText}之后`
  } else if (toText) {
    timeRange = `${toText}之前`
  }

  return `${parts.join('')}支出明细${timeRange}`
}
