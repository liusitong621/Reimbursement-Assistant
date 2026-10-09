import crypto from 'node:crypto'
import { Router } from 'express'
import { prisma } from '../db.js'
import { currentUser, requireAuth, requireRole } from '../middleware/auth.js'
import { Role } from '@prisma/client'

const router = Router()

// 明文 Key 只在创建响应里出现一次，数据库仅存 SHA-256 哈希
function generateApiKey(): { raw: string; keyHash: string; prefix: string } {
  const raw = `fpak_${crypto.randomBytes(32).toString('base64url')}`
  const keyHash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex')
  return { raw, keyHash, prefix: raw.slice(0, 16) }
}

// 我的 API Key 列表（不含哈希）
router.get('/', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  const keys = await prisma.apiKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      rateLimitPerMin: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  })
  res.json({ success: true, data: keys })
})

// 管理员：全部用户的 Key
router.get('/all', requireRole(Role.admin), async (_req, res) => {
  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      rateLimitPerMin: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      user: { select: { username: true, displayName: true, role: true } },
    },
  })
  res.json({ success: true, data: keys })
})

// 管理员：该 Key 最近的 API 调用审计
router.get('/audit', requireRole(Role.admin), async (req, res) => {
  const keyId = String(req.query.keyId ?? '')
  const take = Math.min(Number(req.query.take ?? 50) || 50, 200)
  const logs = await prisma.apiAuditLog.findMany({
    where: keyId ? { keyId } : undefined,
    orderBy: { createdAt: 'desc' },
    take,
  })
  res.json({ success: true, data: logs })
})

// 创建 Key：权限与当前账号完全相等（系统不做任何收窄/放大）
router.post('/', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  const { name, expiresInDays } = req.body as { name?: string; expiresInDays?: number }

  const trimmed = (name ?? '').trim()
  if (!trimmed) {
    res.status(400).json({ success: false, error: '请填写 Key 的用途名称。' })
    return
  }
  if (trimmed.length > 50) {
    res.status(400).json({ success: false, error: '用途名称不能超过 50 个字符。' })
    return
  }

  const activeCount = await prisma.apiKey.count({ where: { userId: user.id, revokedAt: null } })
  if (activeCount >= 10) {
    res.status(400).json({ success: false, error: '每个账号最多同时持有 10 个有效 Key，请先吊销不用的 Key。' })
    return
  }

  let expiresAt: Date | null = null
  if (expiresInDays !== undefined && expiresInDays !== null && Number(expiresInDays) > 0) {
    expiresAt = new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000)
  }

  const { raw, keyHash, prefix } = generateApiKey()
  const created = await prisma.apiKey.create({
    data: {
      name: trimmed,
      keyHash,
      prefix,
      userId: user.id,
      expiresAt,
    },
  })

  res.status(201).json({
    success: true,
    data: {
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      expiresAt: created.expiresAt,
      createdAt: created.createdAt,
      apiKey: raw,
      notice: '明文 Key 只显示这一次，请立即复制保存。调用方式：请求头 Authorization: Bearer fpak_xxx 或 X-API-Key: fpak_xxx',
    },
  })
})

// 吊销 Key（仅本人或管理员）
router.delete('/:id', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  const key = await prisma.apiKey.findUnique({ where: { id: req.params.id } })

  if (!key) {
    res.status(404).json({ success: false, error: 'Key 不存在。' })
    return
  }
  if (key.userId !== user.id && user.role !== Role.admin) {
    res.status(403).json({ success: false, error: '只能吊销自己的 Key。' })
    return
  }
  if (key.revokedAt) {
    res.status(400).json({ success: false, error: '该 Key 已被吊销。' })
    return
  }

  await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } })
  res.json({ success: true })
})

export default router
