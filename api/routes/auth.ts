import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../db.js'
import { currentUser, requireAuth } from '../middleware/auth.js'

const router = Router()

// 4.0.9: 登录接口限速（防口令爆破）——每 IP 每分钟最多 10 次尝试，超限返回 429
const loginAttempts = new Map<string, number[]>()

function loginRateAllow(ip: string): boolean {
  const now = Date.now()
  const windowStart = now - 60_000
  const bucket = (loginAttempts.get(ip) ?? []).filter((ts) => ts > windowStart)
  if (bucket.length >= 10) {
    loginAttempts.set(ip, bucket)
    return false
  }
  bucket.push(now)
  loginAttempts.set(ip, bucket)
  if (loginAttempts.size > 10_000) {
    for (const [key, timestamps] of loginAttempts) {
      if (timestamps.every((ts) => ts <= windowStart)) loginAttempts.delete(key)
    }
  }
  return true
}

router.get('/me', async (req, res) => {
  // API Key 请求：直接按 Key 所属账号返回，无需 session
  if (req.authUser) {
    const keyUser = await prisma.user.findUnique({ where: { id: req.authUser.id } })
    if (keyUser) {
      res.status(200).json({
        success: true,
        data: {
          id: keyUser.id,
          username: keyUser.username,
          displayName: keyUser.displayName,
          role: keyUser.role,
          reserveFundBalance: keyUser.reserveFundBalance,
          reserveFundNotice: keyUser.reserveFundNotice,
        },
      })
      return
    }
  }

  if (!req.session.user) {
    res.status(200).json({
      success: true,
      data: null,
    })
    return
  }

  const user = await prisma.user.findUnique({
    where: { id: req.session.user.id },
  })

  if (!user) {
    req.session.user = undefined
    res.status(200).json({
      success: true,
      data: null,
    })
    return
  }

  const data = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    reserveFundBalance: user.reserveFundBalance,
    reserveFundNotice: user.reserveFundNotice,
  }

  req.session.user = {
    id: data.id,
    username: data.username,
    displayName: data.displayName,
    role: data.role,
    reserveFundBalance: data.reserveFundBalance,
  }

  res.status(200).json({
    success: true,
    data,
  })
})

router.post('/login', async (req, res) => {
  // 4.0.9: 登录限速。生产走 Caddy 反代，req.ip 恒为 127.0.0.1，取 X-Forwarded-For 真实 IP
  const forwarded = req.headers['x-forwarded-for']
  const clientIp = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') || req.ip || 'unknown'
  if (!loginRateAllow(clientIp)) {
    res.status(429).json({
      success: false,
      error: '登录尝试过于频繁，请 1 分钟后再试。',
    })
    return
  }

  const { username, password } = req.body as { username?: string; password?: string }

  if (!username || !password) {
    res.status(400).json({
      success: false,
      error: '请输入账号和密码。',
    })
    return
  }

  const user = await prisma.user.findUnique({
    where: { username },
  })

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({
      success: false,
      error: '账号或密码不正确。',
    })
    return
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    reserveFundBalance: user.reserveFundBalance,
  }

  res.status(200).json({
    success: true,
    data: {
      ...req.session.user,
      reserveFundNotice: user.reserveFundNotice,
    },
  })
})

router.post('/acknowledge-reserve-notice', requireAuth, async (req, res) => {
  await prisma.user.update({
    where: { id: currentUser(req)!.id },
    data: {
      reserveFundNotice: '',
    },
  })

  res.status(200).json({
    success: true,
  })
})

router.patch('/profile', requireAuth, async (req, res) => {
  const { displayName, currentPassword, newPassword } = req.body as {
    displayName?: string
    currentPassword?: string
    newPassword?: string
  }

  const userId = currentUser(req)!.id
  const user = await prisma.user.findUnique({ where: { id: userId } })

  if (!user) {
    res.status(404).json({ success: false, error: '用户不存在。' })
    return
  }

  const updates: { displayName?: string; passwordHash?: string } = {}

  if (displayName !== undefined) {
    const trimmed = displayName.trim()
    if (!trimmed) {
      res.status(400).json({ success: false, error: '显示名称不能为空。' })
      return
    }
    if (trimmed.length > 30) {
      res.status(400).json({ success: false, error: '显示名称不能超过 30 个字符。' })
      return
    }
    updates.displayName = trimmed
  }

  if (newPassword !== undefined) {
    if (!currentPassword) {
      res.status(400).json({ success: false, error: '修改密码需要输入当前密码。' })
      return
    }
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      res.status(403).json({ success: false, error: '当前密码不正确。' })
      return
    }
    if (newPassword.length < 4) {
      res.status(400).json({ success: false, error: '新密码至少 4 个字符。' })
      return
    }
    updates.passwordHash = await bcrypt.hash(newPassword, 10)
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ success: false, error: '没有需要更新的内容。' })
    return
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: updates,
  })

  if (updates.displayName && req.session.user) {
    req.session.user = {
      ...req.session.user,
      displayName: updated.displayName,
    }
  }

  res.status(200).json({
    success: true,
    data: {
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      role: updated.role,
      reserveFundBalance: updated.reserveFundBalance,
      reserveFundNotice: updated.reserveFundNotice,
    },
  })
})

router.post('/logout', requireAuth, (req, res) => {
  // API Key 请求没有 session 可销毁，直接返回成功
  if (req.authUser && !req.session.user) {
    res.status(200).json({ success: true })
    return
  }

  req.session.destroy((error) => {
    if (error) {
      res.status(500).json({
        success: false,
        error: '退出失败，请稍后重试。',
      })
      return
    }

    res.clearCookie('fp.sid')
    res.status(200).json({
      success: true,
    })
  })
})

export default router
