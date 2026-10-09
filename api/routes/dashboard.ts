import { Router } from 'express'
import { ReimbursementStatus, Role, type Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { currentUser, requireAuth } from '../middleware/auth.js'

const router = Router()

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

function roleWhere(role: Role, userId: string) {
  if (role === Role.employee) {
    return { creatorId: userId }
  }

  if (role === Role.finance) {
    return {
      status: {
        in: [ReimbursementStatus.completed, ReimbursementStatus.reimbursed],
      },
    }
  }

  return {}
}

router.get('/notifications', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  const orConditions: Prisma.ReimbursementWhereInput[] = []

  if (user.role !== Role.finance) {
    // 被驳回需要修改的报销单（自己的）
    orConditions.push({
      creatorId: user.id,
      status: ReimbursementStatus.needs_revision,
    })
  }

  if (user.role === Role.leader || user.role === Role.admin) {
    // 待审批
    orConditions.push({ status: ReimbursementStatus.pending_review })
  }

  if (user.role === Role.finance || user.role === Role.admin) {
    // 已办结待核销
    orConditions.push({ status: ReimbursementStatus.completed })
  }

  const items = await prisma.reimbursement.findMany({
    where: orConditions.length > 0 ? { OR: orConditions } : { id: 'never-match' },
    select: {
      id: true,
      title: true,
      invoiceNumber: true,
      status: true,
      updatedAt: true,
      creator: { select: { displayName: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })

  res.status(200).json({
    success: true,
    data: {
      count: items.length,
      items: items.map((item) => ({
        id: item.id,
        title: item.title || item.invoiceNumber || '未命名报销单',
        status: item.status,
        updatedAt: item.updatedAt,
        creatorName: item.creator.displayName,
      })),
    },
  })
})
router.get('/', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  const where = roleWhere(user.role, user.id)

  const [stats, recentEdited, recentReviewed, reserveLogs, me] = await Promise.all([
    prisma.reimbursement.groupBy({
      by: ['status'],
      where,
      _count: {
        _all: true,
      },
    }),
    prisma.reimbursement.findMany({
      where,
      orderBy: {
        updatedAt: 'desc',
      },
      take: 5,
      include: {
        orders: {
          take: 1,
          orderBy: {
            sequence: 'asc',
          },
        },
      },
    }),
    prisma.reviewLog.findMany({
      where:
        user.role === Role.employee
          ? { reimbursement: { creatorId: user.id } }
          : {},
      include: {
        operator: true,
        reimbursement: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,
    }),
    prisma.reserveFundLog.findMany({
      where: {
        targetUserId: user.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
    }),
    prisma.user.findUnique({
      where: { id: user.id },
    }),
  ])

  const countMap = Object.fromEntries(
    stats.map((item) => [item.status, item._count._all]),
  )

  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000
  const halfYearAgo = Date.now() - 182 * 24 * 60 * 60 * 1000
  const threeMonthsAgo = Date.now() - 90 * 24 * 60 * 60 * 1000
  const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

  const usageInRange = (fromTime: number) =>
    reserveLogs
      .filter((item) => item.deltaAmount < 0 && new Date(item.createdAt).getTime() >= fromTime)
      .reduce((sum, item) => sum + Math.abs(item.deltaAmount), 0)

  const usedTotal = reserveLogs
    .filter((item) => item.deltaAmount < 0)
    .reduce((sum, item) => sum + Math.abs(item.deltaAmount), 0)

  res.status(200).json({
    success: true,
    data: {
      stats: {
        all: Object.values(countMap).reduce((sum, value) => sum + Number(value), 0),
        draft: countMap.draft ?? 0,
        unfinished: countMap.unfinished ?? 0,
        pending_review: countMap.pending_review ?? 0,
        needs_revision: countMap.needs_revision ?? 0,
        completed: countMap.completed ?? 0,
        reimbursed: countMap.reimbursed ?? 0,
      },
      recentEdited: recentEdited.map((item) => ({
        id: item.id,
        title: safeText(item.title, item.invoiceNumber || '未命名报销单'),
        invoiceNumber: item.invoiceNumber,
        platformName: safeText(item.orders[0]?.platformName, item.orders[0]?.orderNumber || '未填写平台'),
        paymentAmount: item.orders[0]?.paymentAmount ?? 0,
        status: item.status,
        updatedAt: item.updatedAt,
      })),
      recentReviewed: recentReviewed.map((item) => ({
        id: item.id,
        reimbursementId: item.reimbursementId,
        title: safeText(item.reimbursement.title, item.reimbursement.invoiceNumber || '未命名报销单'),
        action: item.action,
        reason: safeText(item.reason, ''),
        operatorName: item.operator.displayName,
        createdAt: item.createdAt,
      })),
      reserveFund: {
        balance: me?.reserveFundBalance ?? 0,
        usedTotal,
        year: usageInRange(oneYearAgo),
        halfYear: usageInRange(halfYearAgo),
        threeMonths: usageInRange(threeMonthsAgo),
        month: usageInRange(oneMonthAgo),
        week: usageInRange(oneWeekAgo),
        notice: me?.reserveFundNotice ?? '',
      },
    },
  })
})

export default router
