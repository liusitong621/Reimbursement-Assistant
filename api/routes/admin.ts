import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { Role } from '@prisma/client'
import { prisma } from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()
const defaultPassword = 'Fp@2026'

function isCorruptedText(value?: string | null) {
  const text = String(value ?? '').trim()
  if (!text) {
    return true
  }

  return /^[?\uFFFD\s.·-]+$/.test(text)
}

function safeText(value: string | null | undefined, fallback: string) {
  return isCorruptedText(value) ? fallback : String(value).trim()
}

router.get('/users', requireRole(Role.admin), async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: {
      createdAt: 'asc',
    },
  })

  res.status(200).json({
    success: true,
    data: users.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      reserveFundBalance: user.reserveFundBalance,
      createdAt: user.createdAt,
    })),
  })
})

router.get('/overview', requireRole(Role.admin), async (_req, res) => {
  const [users, reimbursements] = await Promise.all([
    prisma.user.findMany({
      orderBy: {
        createdAt: 'asc',
      },
    }),
    prisma.reimbursement.findMany({
      include: {
        creator: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 20,
    }),
  ])

  res.status(200).json({
    success: true,
    data: {
      users: users.map((user) => ({
        id: user.id,
        displayName: user.displayName,
        username: user.username,
        role: user.role,
        reserveFundBalance: user.reserveFundBalance,
      })),
      recent: reimbursements.map((item) => ({
        id: item.id,
        title: safeText(item.title, item.invoiceNumber || '未命名报销单'),
        status: item.status,
        creatorName: safeText(item.creator.displayName, item.creator.username || '未知账号'),
        updatedAt: item.updatedAt,
      })),
    },
  })
})

router.post('/users', requireRole(Role.admin), async (req, res) => {
  const { username, displayName, role } = req.body as {
    username?: string
    displayName?: string
    role?: Role
  }

  if (!username || !displayName || !role) {
    res.status(400).json({
      success: false,
      error: '请填写完整的用户信息。',
    })
    return
  }

  const passwordHash = await bcrypt.hash(defaultPassword, 10)
  const user = await prisma.user.create({
    data: {
      username,
      displayName,
      role,
      passwordHash,
    },
  })

  res.status(201).json({
    success: true,
    data: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      reserveFundBalance: user.reserveFundBalance,
      createdAt: user.createdAt,
      defaultPassword,
    },
  })
})

router.patch('/users/:id', requireRole(Role.admin), async (req, res) => {
  const { username, displayName, role } = req.body as {
    username?: string
    displayName?: string
    role?: Role
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(username ? { username } : {}),
      ...(displayName ? { displayName } : {}),
      ...(role ? { role } : {}),
    },
  })

  res.status(200).json({
    success: true,
    data: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      reserveFundBalance: user.reserveFundBalance,
      createdAt: user.createdAt,
    },
  })
})

router.post('/users/:id/reset-password', requireRole(Role.admin), async (req, res) => {
  const passwordHash = await bcrypt.hash(defaultPassword, 10)
  await prisma.user.update({
    where: { id: req.params.id },
    data: { passwordHash },
  })

  res.status(200).json({
    success: true,
    data: {
      defaultPassword,
    },
  })
})

router.delete('/users/:id', requireRole(Role.admin), async (req, res) => {
  await prisma.user.delete({
    where: { id: req.params.id },
  })

  res.status(200).json({
    success: true,
  })
})

export default router
