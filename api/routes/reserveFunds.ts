import { Router } from 'express'
import { Role } from '@prisma/client'
import { prisma } from '../db.js'
import { currentUser, requireRoles } from '../middleware/auth.js'
import { buildReserveFundLogData } from '../services/reserveFund.js'

const router = Router()

router.get('/', requireRoles(Role.leader, Role.admin), async (req, res) => {
  const user = currentUser(req)!
  const users = await prisma.user.findMany({
    orderBy: {
      createdAt: 'asc',
    },
    include: {
      reserveFundLogs: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
        include: {
          operator: true,
        },
      },
    },
  })

  const visibleUsers =
    user.role === Role.admin
      ? users
      : users.filter((item) => item.role === Role.employee || item.id === user.id)

  res.status(200).json({
    success: true,
    data: visibleUsers.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      role: user.role,
      reserveFundBalance: user.reserveFundBalance,
      logs: user.reserveFundLogs.map((log) => ({
        id: log.id,
        deltaAmount: log.deltaAmount,
        note: log.note,
        createdAt: log.createdAt,
        operatorName: log.operator.displayName,
      })),
    })),
  })
})

router.post('/adjust', requireRoles(Role.leader, Role.admin), async (req, res) => {
  const user = currentUser(req)!
  const { targetUserId, deltaAmount, note } = req.body as {
    targetUserId?: string
    deltaAmount?: number
    note?: string
  }

  if (!targetUserId || !deltaAmount) {
    res.status(400).json({
      success: false,
      error: '请提供目标用户和调整金额。',
    })
    return
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
  })

  if (!targetUser) {
    res.status(404).json({
      success: false,
      error: '没有找到目标用户。',
    })
    return
  }

  if (user.role !== Role.admin && !(targetUser.role === Role.employee || targetUser.id === user.id)) {
    res.status(403).json({
      success: false,
      error: '当前账号不能调整该用户备用金。',
    })
    return
  }

  if (targetUser.reserveFundBalance + Number(deltaAmount) < 0) {
    res.status(400).json({
      success: false,
      error: '调整后备用金不能小于 0。',
    })
    return
  }

  const target = await prisma.$transaction(async (tx) => {
    await tx.reserveFundLog.create({
      data: buildReserveFundLogData(
        targetUserId,
        user.id,
        Number(deltaAmount),
        note || '手动调整备用金',
      ),
    })

    return tx.user.update({
      where: { id: targetUserId },
      data: {
        reserveFundBalance: {
          increment: Number(deltaAmount),
        },
        reserveFundNotice: `${user.displayName} 调整了你的备用金 ${Number(deltaAmount) > 0 ? '+' : ''}${Number(deltaAmount).toFixed(2)} 元。`,
      },
    })
  })

  res.status(200).json({
    success: true,
    data: {
      id: target.id,
      reserveFundBalance: target.reserveFundBalance,
    },
  })
})

export default router
