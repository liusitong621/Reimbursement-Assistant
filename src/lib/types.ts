export type Role = 'employee' | 'leader' | 'finance' | 'admin'

export type Category = {
  id: string
  name: string
  description: string
  sortOrder: number
  isActive: boolean
  isDefault: boolean
  createdById: string
  createdByName: string
  reimbursementCount: number
  totalAmount: number
  createdAt: string
  updatedAt: string
}
export type ReimbursementStatus =
  | 'draft'
  | 'unfinished'
  | 'pending_review'
  | 'needs_revision'
  | 'completed'
  | 'reimbursed'
export type InvoiceStatus = 'none' | 'not_issued' | 'waiting_issued' | 'issued'
export type PaymentMode = 'personal_reimbursement' | 'reserve_fund'
export type AmountStandard = 'invoice' | 'orders'

export type SessionUser = {
  id: string
  username: string
  displayName: string
  role: Role
  reserveFundBalance: number
  reserveFundNotice?: string
}

export type AttachmentRecord = {
  id: string
  kind: 'invoice' | 'order'
  fileName: string
  fileUrl: string
  mimeType: string
  sortOrder: number
}

export type OrderItemRecord = {
  id: string
  sequence: number
  platformCategory: string
  platformName: string
  merchantName: string
  itemDescription: string
  orderNumber: string
  paymentTime: string
  paymentAmount: number
  orderStatus: string
  note: string
  purchaserId?: string
  purchaserName: string
  paymentMode: PaymentMode
  isParentOrder: boolean
  userIds: string[]
  userNames: string[]
  attachments: AttachmentRecord[]
}

export type ReviewLogRecord = {
  id: string
  action: string
  reason: string
  fromStatus?: ReimbursementStatus
  toStatus?: ReimbursementStatus
  createdAt: string
  operatorName: string
}

export type ReimbursementRecord = {
  id: string
  title: string
  categoryId: string | null
  category: { id: string; name: string; sortOrder: number } | null
  status: ReimbursementStatus
  invoiceSellerName: string
  invoiceSellerTaxNo: string
  invoiceAmountExcludingTax: number
  invoiceTaxAmount: number
  invoiceTaxRate: string
  invoiceTotalAmount: number
  invoiceNumber: string
  invoiceStatus: InvoiceStatus
  rejectionReason: string
  amountStandard: AmountStandard
  amountMismatchNote: string
  createdAt: string
  updatedAt: string
  creator: SessionUser
  attachments: AttachmentRecord[]
  orders: OrderItemRecord[]
  reviewLogs: ReviewLogRecord[]
}

export type DashboardData = {
  stats: Record<string, number>
  recentEdited: Array<{
    id: string
    title: string
    invoiceNumber: string
    platformName: string
    paymentAmount: number
    status: ReimbursementStatus
    updatedAt: string
  }>
  recentReviewed: Array<{
    id: string
    reimbursementId: string
    title: string
    action: string
    reason: string
    operatorName: string
    createdAt: string
  }>
  reserveFund: {
    balance: number
    usedTotal: number
    year: number
    halfYear: number
    threeMonths: number
    month: number
    week: number
    notice: string
  }
}

export type UserOption = {
  id: string
  username: string
  displayName: string
  role: Role
  reserveFundBalance: number
}

export type RecordRow = {
  reimbursementId: string
  title: string
  creatorId: string
  creatorName: string
  status: ReimbursementStatus
  invoiceStatus: InvoiceStatus
  invoiceNumber: string
  invoiceTotalAmount: number
  ordersPaymentSum: number
  invoiceSellerName: string
  amountStandard: AmountStandard
  amountMismatchNote: string
  rejectionReason: string
  orderId: string
  sequence: number
  parentChildMarker: '母' | '子'
  parentInvoiceNumber: string
  categoryId: string
  categoryName: string
  platformCategory: string
  platformName: string
  merchantName: string
  itemDescription: string
  orderNumber: string
  paymentTime: string
  paymentAmount: number
  orderStatus: string
  note: string
  purchaserId?: string
  purchaserName: string
  userNames: string
  paymentMode: PaymentMode
  invoiceAttachmentUrl: string
  orderAttachmentUrl: string
  createdAt: string
  updatedAt: string
}

export type ReserveFundUser = UserOption & {
  logs: Array<{
    id: string
    deltaAmount: number
    note: string
    createdAt: string
    operatorName: string
  }>
}

export type AdminOverview = {
  users: UserOption[]
  recent: Array<{
    id: string
    title: string
    status: ReimbursementStatus
    creatorName: string
    updatedAt: string
  }>
}

// 3.1: 导出接口同时返回电子表格 URL 和"附件合集 PDF" URL。
export type ExportResult = {
  id: string
  recordCount: number
  fileUrl: string
  attachmentPdfUrl: string
}
