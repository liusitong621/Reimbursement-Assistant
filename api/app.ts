import fs from 'node:fs'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import session from 'express-session'
import authRoutes from './routes/auth.js'
import dashboardRoutes from './routes/dashboard.js'
import reimbursementsRoutes from './routes/reimbursements.js'
import exportsRoutes from './routes/exports.js'
import adminRoutes from './routes/admin.js'
import approvalsRoutes from './routes/approvals.js'
import reserveFundsRoutes from './routes/reserveFunds.js'
import recognitionRoutes from './routes/recognition.js'
import categoriesRoutes from './routes/categories.js'
import androidOcrRoutes from './routes/androidOcr.js'
import apiKeysRoutes from './routes/apiKeys.js'
import { apiAuditLog, apiKeyAuth, requireAuth } from './middleware/auth.js'
import { openapiSpec } from './services/openapi.js'
import { renderOpenApiDocsHtml } from './services/openapiDocs.js'
import { PrismaSessionStore, SESSION_TTL_MS } from './services/sessionStore.js'
import { ensureStorageDirs, exportsDir, uploadsDir } from './services/storage.js'

dotenv.config()
ensureStorageDirs()

// 4.0.9: 进程级兜底——任何路由里未捕获的 async 异常只记录日志，绝不允许打崩服务
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error)
})

const app = express()
// 4.1.1: 信任 Caddy 反代的 X-Forwarded-* 头——否则 Express 看到的是 HTTP，
// secure cookie 不会下发、req.ip 恒为 127.0.0.1
app.set('trust proxy', 1)
const distPath = path.join(process.cwd(), 'dist')
const hasBuiltClient = fs.existsSync(path.join(distPath, 'index.html'))
const downloadsDir = path.join(process.cwd(), 'downloads')
fs.mkdirSync(downloadsDir, { recursive: true })

// 4.1.1: CORS 收敛——前后端同源部署（网页与 API 同一站点，vite dev 走代理也是同源），
// 默认不再放行任意跨域；如确需跨域调用，在 .env 配置 CORS_ORIGINS（逗号分隔白名单）。
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
if (corsOrigins.length > 0) {
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    }),
  )
}

app.use(express.json({ limit: '12mb' }))
app.use(express.urlencoded({ extended: true, limit: '12mb' }))
app.use(
  session({
    name: 'fp.sid',
    secret: process.env.SESSION_SECRET ?? 'fp-local-session-secret',
    resave: false,
    saveUninitialized: false,
    store: new PrismaSessionStore(),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // 4.1.1: 全站已强制 HTTPS（80 一律 301 到 443），cookie 仅经加密信道传输
      secure: process.env.COOKIE_SECURE === 'false' ? false : true,
      maxAge: SESSION_TTL_MS,
    },
  }),
)

// 4.1.0: API Key 解析（无 Key 时直接放行走 session）；4.1.1 提升为全局——
// /uploads、/exports 等非 /api 路径也要能用 API Key 访问
app.use(apiKeyAuth)
app.use('/api', apiAuditLog)

// 4.1.1: 上传附件与导出文件属于敏感内容（发票/订单截图含税号、个人信息），
// 必须登录（网页 session 或 API Key）才能访问；网页端 <img> 同源请求自动带 cookie，不受影响。
app.use('/uploads', requireAuth, express.static(uploadsDir))
app.use('/exports', requireAuth, express.static(exportsDir))
app.use('/FP/downloads', express.static(downloadsDir))

// 4.1.0: OpenAPI 规范与文档页（Agent / 第三方接入说明）
app.get('/api/openapi.json', (_req, res) => {
  res.status(200).json(openapiSpec)
})
app.get('/api/openapi', (_req, res) => {
  res.status(200).type('html').send(renderOpenApiDocsHtml())
})

app.use('/api/auth', authRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/reimbursements', reimbursementsRoutes)
app.use('/api/exports', exportsRoutes)
app.use('/api/approvals', approvalsRoutes)
app.use('/api/reserve-funds', reserveFundsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/recognition', recognitionRoutes)
app.use('/api/categories', categoriesRoutes)
app.use('/api/android/ocr', androidOcrRoutes)
app.use('/api/api-keys', apiKeysRoutes)

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'ok',
  })
})

// 本地 OCR 一键安装包下载信息（未配置时不展示下载入口，不影响功能）
app.get('/api/system/ocr-download-info', (_req, res) => {
  const url = process.env.OCR_INSTALLER_URL ?? ''
  res.json({
    success: true,
    data: {
      enabled: Boolean(url),
      url,
      driveUrl: process.env.OCR_INSTALLER_DRIVE_URL ?? '',
      driveCode: process.env.OCR_INSTALLER_DRIVE_CODE ?? '',
      version: process.env.OCR_INSTALLER_VERSION ?? '1.0.0',
      sizeMB: Number(process.env.OCR_INSTALLER_SIZE_MB ?? 0),
      md5: process.env.OCR_INSTALLER_MD5 ?? '',
      guideText:
        '下载后双击安装包，按提示点击【下一步 → 立即安装 → 完成】。若出现“Windows 已保护你的电脑”，请点击【更多信息】→【仍要运行】。安装完成后回到本页，识别会自动改用本地服务。',
    },
  })
})

if (hasBuiltClient) {
  app.use('/FP', express.static(distPath))
  app.get(/^\/FP(?:\/.*)?$/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
  void next
  console.error(error)
  res.status(500).json({
    success: false,
    error: '服务器内部处理失败，请稍后重试。',
  })
})

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: '请求的接口不存在。',
  })
})

export default app
