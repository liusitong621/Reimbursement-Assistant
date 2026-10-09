import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { checkLocalOcrHealth, getLocalOcrVersion, LOCAL_OCR_BASE } from '@/utils/invoiceOcr'
import type { OcrPreference } from '@/utils/invoiceOcr'

export type LocalOcrDownloadInfo = {
  enabled: boolean
  url: string
  driveUrl: string
  driveCode: string
  version: string
  sizeMB: number
  md5: string
  guideText: string
}

const DISMISS_KEY = 'fpLocalOcrGuideDismissed'
const CHECK_KEY = 'fpLocalOcrGuideLastCheck'

async function fetchDownloadInfo(): Promise<LocalOcrDownloadInfo> {
  try {
    const data = await api.get<LocalOcrDownloadInfo>('/api/system/ocr-download-info')
    return data
  } catch {
    return { enabled: false, url: '', driveUrl: '', driveCode: '', version: '', sizeMB: 0, md5: '', guideText: '' }
  }
}

export default function LocalOcrGuide({ preference }: { preference: OcrPreference }) {
  const [phase, setPhase] = useState<'checking' | 'available' | 'unavailable'>('checking')
  const [downloadInfo, setDownloadInfo] = useState<LocalOcrDownloadInfo | null>(null)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')
  const [starting, setStarting] = useState(false)
  const [startFailed, setStartFailed] = useState(false)
  const [localVersion, setLocalVersion] = useState('')

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  // 用户选择“服务器端识别”时不渲染任何提示
  if (preference === 'server') return null

  const probe = useCallback(async () => {
    const [ok, info] = await Promise.all([checkLocalOcrHealth(1200), fetchDownloadInfo()])
    setDownloadInfo(info)
    setPhase(ok ? 'available' : 'unavailable')
    setLocalVersion(ok ? await getLocalOcrVersion() : '')
  }, [])

  useEffect(() => {
    if (dismissed) return
    void probe()
  }, [dismissed, probe])

  // 检查过且被用户关闭过，直接隐藏
  if (dismissed) return null
  if (phase === 'checking') {
    return (
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        正在检测本地 OCR 加速服务...
      </div>
    )
  }

  if (phase === 'available') {
    const outdated = Boolean(
      downloadInfo?.version && localVersion && localVersion !== downloadInfo.version,
    )
    if (outdated) {
      const sizeText = downloadInfo?.sizeMB ? `（约 ${downloadInfo.sizeMB} MB）` : ''
      return (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm font-medium text-amber-900">
              本地 OCR 加速服务有新版本
              <span className="ml-2 text-xs font-normal text-amber-700">
                当前 {localVersion} · 最新 {downloadInfo.version}（建议更新，修复 PDF 发票识别字段错乱等问题）
              </span>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              className="text-xs text-amber-700 hover:text-amber-900"
              title="不再提示"
            >
              关闭
            </button>
          </div>
          <div className="mt-2 text-xs leading-5 text-amber-800">
            点击下方按钮下载新版本，直接双击安装即可覆盖升级（原有数据不受影响）。
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {downloadInfo?.enabled && downloadInfo.url ? (
              <a
                href={downloadInfo.url}
                download
                className="inline-flex items-center gap-1 rounded-xl bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-700"
              >
                从服务器下载新版本{sizeText}
              </a>
            ) : null}
            {downloadInfo?.driveUrl ? (
              <a
                href={downloadInfo.driveUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                从网盘下载新版本
              </a>
            ) : null}
          </div>
        </div>
      )
    }
    return (
      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        本地 OCR 加速服务已启用，发票与订单识别将优先使用本机识别（更快更准）。
      </div>
    )
  }

  // unavailable：引导下载 / 启动
  const guideText =
    downloadInfo?.guideText ||
    '下载后双击安装包，按提示点击【下一步 → 立即安装 → 完成】。若出现“Windows 已保护你的电脑”，请点击【更多信息】→【仍要运行】。'
  const sizeText = downloadInfo?.sizeMB ? `（约 ${downloadInfo.sizeMB} MB）` : ''

  const handleStartLocal = () => {
    // 通过协议唤起本机程序（已安装但未运行时），随后重新检测
    try {
      window.location.href = 'fp-ocr://start'
    } catch {
      /* 忽略协议唤起失败 */
    }
    // 打包版程序冷启动到服务就绪通常需要 3~8 秒，这里每 2 秒轮询一次，最长等 30 秒
    let attempts = 0
    const maxAttempts = 15
    const timer = window.setInterval(async () => {
      attempts += 1
      const ok = await checkLocalOcrHealth(1200)
      if (ok) {
        window.clearInterval(timer)
        setStarting(false)
        setPhase('available')
        setLocalVersion(await getLocalOcrVersion())
        return
      }
      if (attempts >= maxAttempts) {
        window.clearInterval(timer)
        setStarting(false)
        setStartFailed(true)
      }
    }, 2000)
  }

  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium text-amber-900">
          未检测到本地 OCR 加速服务
          <span className="ml-2 text-xs font-normal text-amber-700">不安装也不影响使用，识别会走服务器，只是稍慢。</span>
        </div>
        <button type="button" onClick={handleDismiss} className="text-xs text-amber-700 hover:text-amber-900" title="不再提示">
          关闭
        </button>
      </div>
      <div className="mt-2 text-xs leading-5 text-amber-800">{guideText}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {downloadInfo?.enabled && downloadInfo.url ? (
          <a
            href={downloadInfo.url}
            download
            className="inline-flex items-center gap-1 rounded-xl bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-700"
          >
            从服务器下载安装包{sizeText}
          </a>
        ) : null}
        {downloadInfo?.driveUrl ? (
          <a
            href={downloadInfo.driveUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100"
          >
            从网盘下载安装包
          </a>
        ) : null}
        {downloadInfo?.driveCode ? (
          <span className="text-xs text-amber-700">网盘提取码：{downloadInfo.driveCode}（复制后填到网盘页面）</span>
        ) : null}
        <button
          type="button"
          onClick={handleStartLocal}
          disabled={starting}
          className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {starting ? '正在启动本地服务…' : '我已安装，点此启动'}
        </button>
        <a
          href={`${LOCAL_OCR_BASE}/api/v1/health`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100"
        >
          检测服务状态
        </a>
      </div>
      {startFailed ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs leading-5 text-rose-700">
          仍未检测到本地服务。请确认已双击安装过“本地OCR一键安装包”；可直接在浏览器打开{' '}
          <a href={`${LOCAL_OCR_BASE}/api/v1/health`} target="_blank" rel="noreferrer" className="font-medium underline">http://127.0.0.1:8001/api/v1/health</a>
          查看是否返回正常，若仍不行请检查是否被安全软件拦截。
        </div>
      ) : null}
    </div>
  )
}
