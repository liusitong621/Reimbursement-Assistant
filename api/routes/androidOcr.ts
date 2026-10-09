import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const bundlesDir = path.join(process.cwd(), 'storage', 'android-ocr', 'bundles')
const manifestPath = path.join(process.cwd(), 'storage', 'android-ocr', 'manifest.json')

fs.mkdirSync(bundlesDir, { recursive: true })

function safeVersion(version: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(version)
}

router.get('/manifest', requireAuth, (_req, res) => {
  if (!fs.existsSync(manifestPath)) {
    res.status(200).json({
      success: true,
      data: {
        available: false,
        version: null,
        minAppVersion: null,
        bundleFile: null,
        size: 0,
        sha256: null,
        releasedAt: null,
      },
    })
    return
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    res.status(200).json({
      success: true,
      data: {
        ...manifest,
        available: Boolean(manifest.version && manifest.bundleFile),
      },
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({
      success: false,
      error: '读取 OCR 更新清单失败。',
    })
  }
})

router.get('/bundle/:version', requireAuth, (req, res) => {
  const version = req.params.version
  if (!safeVersion(version)) {
    res.status(400).json({
      success: false,
      error: '版本号格式不正确。',
    })
    return
  }

  const fileName = `fp-ocr-bundle-${version}.zip`
  const filePath = path.join(bundlesDir, fileName)
  if (!fs.existsSync(filePath)) {
    res.status(404).json({
      success: false,
      error: 'OCR 更新包不存在。',
    })
    return
  }

  res.download(filePath, fileName)
})

export default router
