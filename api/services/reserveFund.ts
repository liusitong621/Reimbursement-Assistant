import { PaymentMode, ReimbursementStatus, type Prisma } from '@prisma/client'

type AmountStandard = 'invoice' | 'orders'

export function calculateReserveFundUsage(
  orders: { paymentMode: PaymentMode; paymentAmount: number }[],
  amountStandard: AmountStandard = 'orders',
  invoiceTotalAmount: number = 0,
): number {
  const reserveFundOrderTotal = orders
    .filter((order) => order.paymentMode === PaymentMode.reserve_fund)
    .reduce((sum, order) => sum + Number(order.paymentAmount || 0), 0)

  if (amountStandard === 'invoice') {
    return Math.min(Math.max(invoiceTotalAmount, 0), reserveFundOrderTotal)
  }
  return reserveFundOrderTotal
}

export function shouldDeductReserveFund(previous: ReimbursementStatus | null, next: ReimbursementStatus) {
  return previous === ReimbursementStatus.draft && next !== ReimbursementStatus.draft
}

export function shouldRefundReserveFund(previous: ReimbursementStatus | null, next: ReimbursementStatus | null) {
  return previous !== null && previous !== ReimbursementStatus.draft && next === ReimbursementStatus.draft
}

export function buildReserveFundLogData(targetUserId: string, operatorId: string, deltaAmount: number, note: string): Prisma.ReserveFundLogUncheckedCreateInput {
  return {
    targetUserId,
    operatorId,
    deltaAmount,
    note,
  }
}
