import { describe, expect, it } from 'vitest'
import { findDuplicateNumbers } from './reimbursement'

const empty = { invoiceNumbers: [], orderNumbers: [] }

describe('findDuplicateNumbers', () => {
  it('空编号不判重', () => {
    const result = findDuplicateNumbers('', ['', '  '], empty)
    expect(result.invoice).toBeNull()
    expect(result.orders).toEqual({})
  })

  it('发票号与已有记录重复时返回该值', () => {
    const result = findDuplicateNumbers('26332000006652236931', [], {
      invoiceNumbers: ['26332000006652236931'],
      orderNumbers: [],
    })
    expect(result.invoice).toBe('26332000006652236931')
  })

  it('发票号不重复时返回 null', () => {
    const result = findDuplicateNumbers('999', [], {
      invoiceNumbers: ['111', '222'],
      orderNumbers: [],
    })
    expect(result.invoice).toBeNull()
  })

  it('编辑场景排除本单自身的发票号', () => {
    const result = findDuplicateNumbers('ABC123', [], {
      invoiceNumbers: ['ABC123'],
      orderNumbers: [],
    }, { invoiceNumber: 'ABC123' })
    expect(result.invoice).toBeNull()
  })

  it('订单号与已有记录重复时按序号标记', () => {
    const result = findDuplicateNumbers('', ['TB111', 'JD222', 'TB111'], {
      invoiceNumbers: [],
      orderNumbers: ['TB111', 'PDD333'],
    })
    // 第 0、2 个与已有记录/同单重复
    expect(result.orders[0]).toBe('TB111')
    expect(result.orders[2]).toBe('TB111')
    expect(result.orders[1]).toBeUndefined()
  })

  it('同单内订单号重复也标记', () => {
    const result = findDuplicateNumbers('', ['A', 'B', 'A'], empty)
    expect(result.orders[0]).toBe('A')
    expect(result.orders[2]).toBe('A')
    expect(result.orders[1]).toBeUndefined()
  })

  it('编辑场景排除本单自身已存在的订单号', () => {
    const result = findDuplicateNumbers('', ['M001', 'M002'], {
      invoiceNumbers: [],
      orderNumbers: ['M001', 'M002', 'OTHER'],
    }, { orderNumbers: ['M001', 'M002'] })
    expect(result.orders).toEqual({})
  })
})
