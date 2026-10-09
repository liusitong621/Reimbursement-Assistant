// subset-font 没有自带类型声明，这里补充最小声明
declare module 'subset-font' {
  interface SubsetFontOptions {
    targetFormat?: 'sfnt' | 'woff' | 'woff2' | 'truetype'
    preserveNameIds?: number[]
    variationAxes?: Record<string, number | { min: number; max: number; default?: number }>
    noLayoutClosure?: boolean
  }

  export default function subsetFont(
    fontBuffer: Buffer | Uint8Array | ArrayBuffer,
    text: string,
    options?: SubsetFontOptions,
  ): Promise<Buffer>
}