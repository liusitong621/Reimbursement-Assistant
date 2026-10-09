import { describe, expect, it } from 'vitest'
import { calculateCategoryTotalAmount, roundMoney } from './categoryStats.js'

describe('calculateCategoryTotalAmount', () => {
  it('uses invoice total when amount standard is invoice', () => {
    const total = calculateCategoryTotalAmount([
      {
        amountStandard: 'invoice',
        invoiceTotalAmount: 128.4,
        orders: [{ paymentAmount: 99.5 }, { paymentAmount: 28.9 }],
      },
    ])
    expect(total).toBe(128.4)
  })

  it('uses order payment sum when amount standard is orders', () => {
    const total = calculateCategoryTotalAmount([
      {
        amountStandard: 'orders',
        invoiceTotalAmount: 0,
        orders: [{ paymentAmount: 99.5 }, { paymentAmount: 28.9 }],
      },
    ])
    expect(total).toBe(128.4)
  })

  it('rounds floating point sums to two decimal places', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
    expect(calculateCategoryTotalAmount([])).toBe(0)
  })
})
