const platformMatchers = [
  { keyword: 'taobao', value: '淘宝' },
  { keyword: 'tb', value: '淘宝' },
  { keyword: 'jingdong', value: '京东' },
  { keyword: 'jd', value: '京东' },
  { keyword: 'pinduoduo', value: '拼多多' },
  { keyword: 'pdd', value: '拼多多' },
  { keyword: 'wechat', value: '微信支付' },
  { keyword: 'wx', value: '微信支付' },
]

export type RecognitionCandidate = {
  fieldName: string
  candidateValue: string
  confidence: number
  rawSnippet: string
}

function normalizeFileName(fileName: string) {
  return fileName.toLowerCase()
}

function detectPlatform(fileName: string) {
  const normalized = normalizeFileName(fileName)
  return platformMatchers.find((item) => normalized.includes(item.keyword))?.value
}

function findAmount(fileName: string) {
  const prioritizedPatterns = [
    /(?:amt|amount|金额|¥|￥)[_-]?(\d{1,5}(?:\.\d{1,2})?)/i,
    /[_-](\d{1,5}(?:\.\d{1,2})?)(?:\.[a-z]+)?$/i,
  ]

  for (const pattern of prioritizedPatterns) {
    const match = fileName.match(pattern)
    if (match) {
      return match[1]
    }
  }

  return ''
}

function findCode(fileName: string, prefix: 'order' | 'invoice') {
  const patterns =
    prefix === 'order'
      ? [/(?:order|订单|dd)[_-]?([a-z0-9]{6,})/i]
      : [/(?:invoice|发票|fp)[_-]?([a-z0-9]{6,})/i]

  for (const pattern of patterns) {
    const match = fileName.match(pattern)
    if (match) {
      return match[1].toUpperCase()
    }
  }

  return ''
}

export function buildRecognitionCandidates(fileName: string) {
  const candidates: RecognitionCandidate[] = []
  const platform = detectPlatform(fileName)
  const amount = findAmount(fileName)
  const orderNumber = findCode(fileName, 'order')
  const invoiceNumber = findCode(fileName, 'invoice')

  if (platform) {
    candidates.push({
      fieldName: 'platform',
      candidateValue: platform,
      confidence: 0.78,
      rawSnippet: fileName,
    })
  }

  if (amount) {
    candidates.push({
      fieldName: 'totalAmount',
      candidateValue: amount,
      confidence: 0.7,
      rawSnippet: amount,
    })
  }

  if (orderNumber) {
    candidates.push({
      fieldName: 'orderNumber',
      candidateValue: orderNumber,
      confidence: 0.82,
      rawSnippet: orderNumber,
    })
  }

  if (invoiceNumber) {
    candidates.push({
      fieldName: 'invoiceNumber',
      candidateValue: invoiceNumber,
      confidence: 0.82,
      rawSnippet: invoiceNumber,
    })
  }

  return candidates
}

export function mergeRecognitionSuggestions(fileNames: string[]) {
  const grouped = new Map<string, RecognitionCandidate>()

  for (const fileName of fileNames) {
    for (const item of buildRecognitionCandidates(fileName)) {
      const current = grouped.get(item.fieldName)
      if (!current || current.confidence < item.confidence) {
        grouped.set(item.fieldName, item)
      }
    }
  }

  return [...grouped.values()]
}
