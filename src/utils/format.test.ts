import { describe, expect, it } from 'vitest'
import { formatCurrency, getInvoiceStatusLabel, getPaymentModeLabel, getReimbursementStatusLabel } from './format'

describe('format helpers', () => {
  it('格式化人民币金额', () => {
    expect(formatCurrency(268.8)).toContain('268.80')
  })

  it('返回状态中文标签', () => {
    expect(getReimbursementStatusLabel('completed')).toBe('已办结')
    expect(getReimbursementStatusLabel('pending_review')).toBe('待审核')
    expect(getInvoiceStatusLabel('issued')).toBe('已开票')
    expect(getPaymentModeLabel('reserve_fund')).toBe('该订单使用备用金')
  })
})
