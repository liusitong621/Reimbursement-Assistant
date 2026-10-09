// Cross-platform font downloader for FP 3.1+
// Downloads the Chinese font needed for PDF export generation.
// Source: Adobe Source Han Sans (SIL Open Font License 1.1)
// Subset OTF (~8.4 MB) covering GB2312 - the subset actually used in the
// generated PDFs is far smaller because pdfkit embeds only used glyphs.

import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const fontDir = path.resolve(here, '..', 'assets', 'fonts')
const fontPath = path.join(fontDir, 'SourceHanSansCN-Regular.otf')

// Primary: Adobe-Fonts GitHub release (Subset OTF, GB2312 coverage, ~8.4 MB)
// License: SIL OFL 1.1
const PRIMARY_URL =
  'https://raw.githubusercontent.com/adobe-fonts/source-han-sans/release/SubsetOTF/CN/SourceHanSansCN-Regular.otf'

// Fallback: Noto CJK SC full (16 MB) - larger but guaranteed coverage
const FALLBACK_URL =
  'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf'

const FALLBACK_FONT_PATH = path.join(fontDir, 'NotoSansCJKsc-Regular.otf')

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const follow = (currentUrl, redirectsLeft = 5) => {
      https
        .get(currentUrl, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            if (redirectsLeft <= 0) {
              reject(new Error('Too many redirects'))
              return
            }
            res.resume()
            const next = new URL(res.headers.location, currentUrl).toString()
            follow(next, redirectsLeft - 1)
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`))
            return
          }
          const totalHeader = res.headers['content-length']
          const total = totalHeader ? Number(totalHeader) : null
          const file = fs.createWriteStream(destPath)
          let downloaded = 0
          let lastLog = Date.now()
          res.on('data', (chunk) => {
            downloaded += chunk.length
            if (Date.now() - lastLog > 2000) {
              const pct = total ? ` (${((downloaded / total) * 100).toFixed(1)}%)` : ''
              process.stdout.write(
                `\r  下载中... ${formatBytes(downloaded)}${total ? ' / ' + formatBytes(total) : ''}${pct}   `,
              )
              lastLog = Date.now()
            }
          })
          res.pipe(file)
          file.on('finish', () => {
            file.close(() => resolve(formatBytes(downloaded)))
          })
          file.on('error', (err) => {
            fs.unlink(destPath, () => reject(err))
          })
        })
        .on('error', reject)
    }
    follow(url)
  })
}

async function ensureFont() {
  if (fs.existsSync(fontPath) && fs.statSync(fontPath).size > 1_000_000) {
    console.log(`[fonts] 已存在: ${path.relative(process.cwd(), fontPath)} (${formatBytes(fs.statSync(fontPath).size)})`)
    return
  }
  fs.mkdirSync(fontDir, { recursive: true })
  try {
    console.log(`[fonts] 下载 Source Han Sans CN (SIL OFL 1.1) ...`)
    const size = await download(PRIMARY_URL, fontPath)
    console.log(`\n[fonts] 完成: ${size}`)
  } catch (err) {
    console.error(`\n[fonts] 主源下载失败: ${err.message}`)
    console.log(`[fonts] 尝试备用源 Noto CJK SC ...`)
    try {
      const size = await download(FALLBACK_URL, FALLBACK_FONT_PATH)
      console.log(`[fonts] 完成 (备用): ${size}`)
      console.log(
        `[fonts] 注意: 文件名是 NotoSansCJKsc-Regular.otf, ` +
          `导出服务会优先识别这个文件名.`,
      )
    } catch (err2) {
      console.error(`[fonts] 备用源也失败: ${err2.message}`)
      console.error(`[fonts] 请手动从以下任一地址下载后放入 ${fontDir}:`)
      console.error(`        - ${PRIMARY_URL}`)
      console.error(`        - ${FALLBACK_URL}`)
      process.exit(1)
    }
  }
}

ensureFont().catch((err) => {
  console.error(err)
  process.exit(1)
})
