import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { Role } from '@prisma/client'
import { prisma } from '../db.js'

const roleRank: Record<Role, number> = {
  employee: 1,
  leader: 2,
  finance: 3,
  admin: 4,
}

// 与 session.user 完全同形状：API Key 用户与网页用户走同一套字段
export type AuthUser = {
  id: string
  username: string
  displayName: string
  role: Role
  reserveFundBalance: number
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser
      apiKey?: { id: string; name: string }
      apiBodySummary?: string
    }
  }
}

export function currentUser(req: Request): AuthUser | undefined {
  return req.authUser ?? req.session.user
}

// ---------------------------------------------------------------------------
// API Key 解析：Authorization: Bearer fpak_xxx 或 X-API-Key: fpak_xxx
// 权限设计：Key 只是账号的化身，解析出用户后与网页端走完全相同的角色检查，
// 不做任何额外的权限放大或收窄。
// ---------------------------------------------------------------------------

const API_KEY_PREFIX = 'fpak_'

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
}

// 简单内存滑动窗口限速（单进程部署足够；重启清零可接受）
const rateBuckets = new Map<string, number[]>()

function rateAllow(keyId: string, limitPerMin: number): boolean {
  const now = Date.now()
  const windowStart = now - 60_000
  const bucket = (rateBuckets.get(keyId) ?? []).filter((ts) => ts > windowStart)
  if (bucket.length >= limitPerMin) {
    rateBuckets.set(keyId, bucket)
    return false
  }
  bucket.push(now)
  rateBuckets.set(keyId, bucket)
  if (rateBuckets.size > 10_000) {
    for (const [id, timestamps] of rateBuckets) {
      if (timestamps.every((ts) => ts <= windowStart)) rateBuckets.delete(id)
    }
  }
  return true
}

const REDACTED_BODY_KEYS = new Set(['password', 'currentPassword', 'newPassword', 'confirmPassword', 'key'])

function summarizeBody(req: Request): string {
  if (req.method === 'GET' || req.method === 'HEAD') return ''
  try {
    const body = req.body as unknown
    if (!body || typeof body !== 'object') return ''
    const clone: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      clone[k] = REDACTED_BODY_KEYS.has(k) ? '***' : v
    }
    const text = JSON.stringify(clone)
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text
  } catch {
    return ''
  }
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    try {
      const header = req.headers.authorization
      const raw = header?.startsWith('Bearer ')
        ? header.slice(7).trim()
        : typeof req.headers['x-api-key'] === 'string'
          ? req.headers['x-api-key'].trim()
          : ''

      // 未携带 API Key：正常走网页 session
      if (!raw) {
        next()
        return
      }

      if (!raw.startsWith(API_KEY_PREFIX)) {
        res.status(401).json({ success: false, error: 'API Key 格式不正确，应以 fpak_ 开头。' })
        return
      }

      const key = await prisma.apiKey.findUnique({
        where: { keyHash: sha256Hex(raw) },
        include: { user: true },
      })

      if (!key || key.revokedAt || (key.expiresAt && key.expiresAt.getTime() < Date.now())) {
        res.status(401).json({ success: false, error: 'API Key 无效、已吊销或已过期。' })
        return
      }

      if (!rateAllow(key.id, key.rateLimitPerMin)) {
        res.status(429).json({ success: false, error: `请求过于频繁，该 Key 每分钟限 ${key.rateLimitPerMin} 次。` })
        return
      }

      // Key = 账号化身：字段与 session.user 完全一致
      req.authUser = {
        id: key.user.id,
        username: key.user.username,
        displayName: key.user.displayName,
        role: key.user.role,
        reserveFundBalance: key.user.reserveFundBalance,
      }
      req.apiKey = { id: key.id, name: key.name }
      req.apiBodySummary = summarizeBody(req)

      void prisma.apiKey
        .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined)

      next()
    } catch (error) {
      next(error)
    }
  })()
}

// API 调用审计：只记录 API Key 发起的请求，在响应结束后异步落库
export function apiAuditLog(req: Request, res: Response, next: NextFunction) {
  const startAt = Date.now()
  res.on('finish', () => {
    if (!req.apiKey) return
    void prisma.apiAuditLog
      .create({
        data: {
          keyId: req.apiKey.id,
          keyName: req.apiKey.name,
          userId: req.authUser?.id ?? null,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          durationMs: Date.now() - startAt,
          ip: req.ip ?? '',
          bodySummary: req.apiBodySummary ?? '',
        },
      })
      .catch(() => undefined)
  })
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!currentUser(req)) {
    res.status(401).json({
      success: false,
      error: '请先登录。',
    })
    return
  }

  next()
}

export function requireRole(minRole: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = currentUser(req)
    if (!user) {
      res.status(401).json({
        success: false,
        error: '请先登录。',
      })
      return
    }

    if (roleRank[user.role] < roleRank[minRole]) {
      res.status(403).json({
        success: false,
        error: '当前账号没有该操作权限。',
      })
      return
    }

    next()
  }
}

export function requireRoles(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = currentUser(req)
    if (!user) {
      res.status(401).json({
        success: false,
        error: '请先登录。',
      })
      return
    }

    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({
        success: false,
        error: '当前账号没有该操作权限。',
      })
      return
    }

    next()
  }
}
