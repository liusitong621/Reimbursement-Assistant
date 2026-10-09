import { cn } from '@/lib/utils'
import type { InvoiceStatus, PaymentMode, ReimbursementStatus } from '@/lib/types'
import {
  getInvoiceStatusLabel,
  getPaymentModeLabel,
  getReimbursementStatusLabel,
} from '@/utils/format'

const reimbursementClasses: Record<ReimbursementStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  unfinished: 'bg-sky-100 text-sky-700',
  pending_review: 'bg-amber-100 text-amber-700',
  needs_revision: 'bg-rose-100 text-rose-700',
  completed: 'bg-emerald-100 text-emerald-700',
  reimbursed: 'bg-indigo-100 text-indigo-700',
}

const invoiceClasses: Record<InvoiceStatus, string> = {
  none: 'bg-slate-100 text-slate-700',
  not_issued: 'bg-rose-100 text-rose-700',
  waiting_issued: 'bg-amber-100 text-amber-700',
  issued: 'bg-emerald-100 text-emerald-700',
}

const paymentModeClasses: Record<PaymentMode, string> = {
  personal_reimbursement: 'bg-violet-100 text-violet-700',
  reserve_fund: 'bg-cyan-100 text-cyan-700',
}

export function ReimbursementStatusBadge({ status }: { status: ReimbursementStatus }) {
  return (
    <span className={cn('inline-flex rounded-full px-3 py-1 text-xs font-semibold', reimbursementClasses[status])}>
      {getReimbursementStatusLabel(status)}
    </span>
  )
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={cn('inline-flex rounded-full px-3 py-1 text-xs font-semibold', invoiceClasses[status])}>
      {getInvoiceStatusLabel(status)}
    </span>
  )
}

export function PaymentModeBadge({ mode }: { mode: PaymentMode }) {
  return (
    <span className={cn('inline-flex rounded-full px-3 py-1 text-xs font-semibold', paymentModeClasses[mode])}>
      {getPaymentModeLabel(mode)}
    </span>
  )
}
