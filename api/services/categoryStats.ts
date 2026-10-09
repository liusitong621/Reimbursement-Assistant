export type CategoryAmountReimbursement = {
  amountStandard: 'invoice' | 'orders'
  invoiceTotalAmount: number
  orders: Array<{ paymentAmount: number }>
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateCategoryTotalAmount(reimbursements: CategoryAmountReimbursement[] = []) {
  const total = reimbursements.reduce((sum, item) => {
    const orderTotal = item.orders.reduce((orderSum, order) => {
      return orderSum + (Number(order.paymentAmount) || 0)
    }, 0)

    const amount = item.amountStandard === 'invoice'
      ? (Number(item.invoiceTotalAmount) || 0)
      : orderTotal

    return sum + amount
  }, 0)

  return roundMoney(total)
}
