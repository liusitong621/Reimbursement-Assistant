import { describe, expect, it } from 'vitest'
import { buildRecognitionCandidates, mergeRecognitionSuggestions } from './recognition.js'

describe('buildRecognitionCandidates', () => {
  it('从文件名中提取平台、订单号和金额', () => {
    const result = buildRecognitionCandidates('taobao-orderTB123456-amount268.80.png')

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldName: 'platform', candidateValue: '淘宝' }),
        expect.objectContaining({ fieldName: 'orderNumber', candidateValue: 'TB123456' }),
        expect.objectContaining({ fieldName: 'totalAmount', candidateValue: '268.80' }),
      ]),
    )
  })

  it('从文件名中提取发票号', () => {
    const result = buildRecognitionCandidates('jd-invoicefp99887766.jpg')

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldName: 'platform', candidateValue: '京东' }),
        expect.objectContaining({ fieldName: 'invoiceNumber', candidateValue: 'FP99887766' }),
      ]),
    )
  })
})

describe('mergeRecognitionSuggestions', () => {
  it('合并多张图片候选值并按字段去重', () => {
    const result = mergeRecognitionSuggestions([
      'tb-orderTB123456.png',
      'wechat-invoiceFP887766.jpg',
    ])

    expect(result.find((item) => item.fieldName === 'orderNumber')?.candidateValue).toBe('TB123456')
    expect(result.find((item) => item.fieldName === 'invoiceNumber')?.candidateValue).toBe('FP887766')
  })
})
