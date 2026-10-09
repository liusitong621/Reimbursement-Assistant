export function isCorruptedDisplayText(value?: string | null) {
  const text = String(value ?? '').trim()
  if (!text) {
    return true
  }

  return /^[?\uFFFD\s.·-]+$/.test(text)
}

export function fallbackDisplayText(value: string | null | undefined, fallback: string) {
  return isCorruptedDisplayText(value) ? fallback : String(value).trim()
}
