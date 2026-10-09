import { describe, expect, it } from 'vitest'
import {
  compareNumeric,
  parseTimeValue,
  sortDisplayValue,
  sortRecordRows,
  sortableColumnKeys,
} from './recordSort.js'

const baseRow = {
  reimbursementId: 'r1',
  title: '报销单',
  status: 'draft',
  invoiceStatus: 'issued',
  paymentMode: 'personal_reimbursement',
  amountStandard: 'orders',
  parentInvoiceNumber: '',
  invoiceTotalAmount: 0,
  paymentTime: '',
  paymentAmount: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

function row(overrides: Record<string, unknown>) {
  return { ...baseRow, ...overrides }
}

describe('sortDisplayValue', () => {
  it('把英文枚举值转为页面显示的中文后再排序', () => {
    expect(sortDisplayValue(row({ status: 'pending_review' }), 'status')).toBe('待审核')
    expect(sortDisplayValue(row({ invoiceStatus: 'not_issued' }), 'invoiceStatus')).toBe('未开票')
    expect(sortDisplayValue(row({ paymentMode: 'reserve_fund' }), 'paymentMode')).toBe('该订单使用备用金')
    expect(sortDisplayValue(row({ amountStandard: 'invoice' }), 'amountStandard')).toBe('以发票金额为准')
  })
})

describe('compareNumeric', () => {
  it('超长数字串用 BigInt 精确比较', () => {
    const longA = '26332000006652236931'
    const longB = '26332000006652236932'
    expect(compareNumeric(longA, longB)).toBeLessThan(0)
    expect(compareNumeric(longB, longA)).toBeGreaterThan(0)
  })

  it('普通金额按数值比较', () => {
    expect(compareNumeric(15000, 750.5)).toBeGreaterThan(0)
    expect(compareNumeric('', 1)).toBeLessThan(0)
  })
})

describe('parseTimeValue', () => {
  it('兼容补零与非补零时间格式', () => {
    const a = parseTimeValue('2026-08-05 15:05:00')
    const b = parseTimeValue('2026-8-4 9:5')
    expect(a).toBeGreaterThan(b)
    expect(parseTimeValue('')).toBe(Number.NEGATIVE_INFINITY)
    expect(parseTimeValue(new Date('2026-08-06T00:00:00.000Z'))).toBeGreaterThan(a)
  })
})

describe('sortRecordRows', () => {
  it('金额列升序/降序', () => {
    const rows = [
      row({ reimbursementId: 'a', paymentAmount: 300 }),
      row({ reimbursementId: 'b', paymentAmount: 100 }),
      row({ reimbursementId: 'c', paymentAmount: 200 }),
    ]
    expect(sortRecordRows(rows, 'paymentAmount', 'asc').map((r) => r.reimbursementId)).toEqual(['b', 'c', 'a'])
    expect(sortRecordRows(rows, 'paymentAmount', 'desc').map((r) => r.reimbursementId)).toEqual(['a', 'c', 'b'])
  })

  it('文字列按中文（拼音）排序', () => {
    const rows = [
      row({ reimbursementId: 'a', title: '张三' }),
      row({ reimbursementId: 'b', title: '李四' }),
      row({ reimbursementId: 'c', title: '王五' }),
    ]
    // zh-Hans-CN 拼音排序：李(li) < 王(wang) < 张(zhang)
    expect(sortRecordRows(rows, 'title', 'asc').map((r) => r.reimbursementId)).toEqual(['b', 'c', 'a'])
  })

  it('状态列按中文显示值排序', () => {
    const rows = [
      row({ reimbursementId: 'a', status: 'pending_review' }), // 待审核
      row({ reimbursementId: 'b', status: 'draft' }), // 草稿
      row({ reimbursementId: 'c', status: 'reimbursed' }), // 已报销
    ]
    // 草稿(cao) < 待审核(dai) < 已报销(yi)
    expect(sortRecordRows(rows, 'status', 'asc').map((r) => r.reimbursementId)).toEqual(['b', 'a', 'c'])
  })

  it('非可排序列直接返回原顺序', () => {
    const rows = [
      row({ reimbursementId: 'a', orderNumber: '2' }),
      row({ reimbursementId: 'b', orderNumber: '1' }),
    ]
    expect(sortRecordRows(rows, 'orderNumber', 'asc').map((r) => r.reimbursementId)).toEqual(['a', 'b'])
    expect(sortableColumnKeys.has('orderNumber')).toBe(false)
  })

  it('不可变：不修改原数组', () => {
    const rows = [row({ reimbursementId: 'b', paymentAmount: 1 }), row({ reimbursementId: 'a', paymentAmount: 2 })]
    const original = rows.map((r) => r.reimbursementId)
    sortRecordRows(rows, 'paymentAmount', 'asc')
    expect(rows.map((r) => r.reimbursementId)).toEqual(original)
  })
})
