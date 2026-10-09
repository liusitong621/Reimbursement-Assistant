import type { InvoiceStatus, PaymentMode, ReimbursementStatus, Role } from '@prisma/client'

export type AmountStandard = 'invoice' | 'orders'

export type SessionUser = {
  id: string
  username: string
  displayName: string
  role: Role
  reserveFundBalance: number
}

export type RecordFilters = {
  keyword?: string
  status?: ReimbursementStatus | 'all'
  invoiceStatus?: InvoiceStatus | 'all'
  paymentMode?: PaymentMode | 'all'
  creatorId?: string
  purchaserId?: string
  createdFrom?: string
  createdTo?: string
  paymentFrom?: string
  paymentTo?: string
  categoryId?: string | 'none'
}

export type OrderPayload = {
  id?: string
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
  userIds: string[]
  paymentMode: PaymentMode
}

export type ReimbursementPayload = {
  title: string
  categoryId?: string | null
  invoiceSellerName: string
  invoiceSellerTaxNo: string
  invoiceAmountExcludingTax: number
  invoiceTaxAmount: number
  invoiceTaxRate: string
  invoiceTotalAmount: number
  invoiceNumber: string
  invoiceStatus: InvoiceStatus
  status: ReimbursementStatus
  amountStandard: AmountStandard
  amountMismatchNote: string
  orders: OrderPayload[]
}

export type ExportSort = {
  column: string
  direction: 'asc' | 'desc'
}

export type ExportPayload = {
  filters: RecordFilters
  columns: string[]
  sort?: ExportSort
}
