import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 金额输入过滤：只保留数字与一个小数点，最多两位小数；允许开头一个负号（备用金增减用）
export function sanitizeAmountInput(value: string): string {
  let v = value.replace(/[^0-9.-]/g, '')
  const negative = v.startsWith('-')
  v = v.replace(/-/g, '')
  const dotIndex = v.indexOf('.')
  if (dotIndex >= 0) {
    const intPart = v.slice(0, dotIndex)
    const decPart = v.slice(dotIndex + 1).replace(/\./g, '').slice(0, 2)
    v = `${intPart}.${decPart}`
  }
  return (negative ? '-' : '') + v
}

// 税率/百分比输入过滤：只保留数字与一个小数点，最多两位小数，去掉 % 等符号
export function sanitizePercentInput(value: string): string {
  return sanitizeAmountInput(value.replace(/%/g, '')).replace(/-/g, '')
}
