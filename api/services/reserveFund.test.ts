import { PaymentMode } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { calculateReserveFundUsage } from './reserveFund.js'

describe('calculateReserveFundUsage', () => {
  it('个人垫资需报销订单不计入备用金，即使金额标准为发票', () => {
    const usage = calculateReserveFundUsage(
      [{ paymentMode: PaymentMode.personal_reimbursement, paymentAmount: 128.4 }],
      'invoice',
      128.4,
    )

    expect(usage).toBe(0)
  })

  it('按订单标准时只统计使用备用金的订单金额', () => {
    const usage = calculateReserveFundUsage(
      [
        { paymentMode: PaymentMode.reserve_fund, paymentAmount: 60 },
        { paymentMode: PaymentMode.personal_reimbursement, paymentAmount: 68.4 },
      ],
      'orders',
      0,
    )

    expect(usage).toBe(60)
  })

  it('按发票标准时只统计使用备用金订单金额，不超过发票金额', () => {
    const usage = calculateReserveFundUsage(
      [
        { paymentMode: PaymentMode.reserve_fund, paymentAmount: 60 },
        { paymentMode: PaymentMode.personal_reimbursement, paymentAmount: 68.4 },
      ],
      'invoice',
      128.4,
    )

    expect(usage).toBe(60)
  })

  it('备用金订单合计超过发票金额时按发票金额封顶', () => {
    const usage = calculateReserveFundUsage(
      [{ paymentMode: PaymentMode.reserve_fund, paymentAmount: 100 }],
      'invoice',
      80,
    )

    expect(usage).toBe(80)
  })

  it('没有使用备用金的订单时返回 0', () => {
    expect(calculateReserveFundUsage([], 'invoice', 100)).toBe(0)
    expect(calculateReserveFundUsage([], 'orders', 100)).toBe(0)
  })
})
