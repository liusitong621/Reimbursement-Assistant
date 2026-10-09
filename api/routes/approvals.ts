import { Router } from 'express'
import { ReimbursementStatus, Role } from '@prisma/client'
import { prisma } from '../db.js'
import { currentUser, requireRoles } from '../middleware/auth.js'
import { reimbursementInclude, serializeReimbursement } from '../services/reimbursementData.js'

const router = Router()

router.get('/', requireRoles(Role.leader, Role.admin), async (_req, res) => {
  const where = {
    status: ReimbursementStatus.pending_review,
  }

  const list = await prisma.reimbursement.findMany({
    where,
    include: reimbursementInclude,
    orderBy: {
      updatedAt: 'desc',
    },
  })

  res.status(200).json({
    success: true,
    data: list.map((item) => serializeReimbursement(item)),
  })
})

router.post('/batch-review', requireRoles(Role.leader, Role.admin), async (req, res) => {
  const user = currentUser(req)!
  const { ids, action, reason } = req.body as {
    ids?: string[]
    action?: 'approve' | 'reject'
    reason?: string
  }

  if (!ids?.length || !action) {
    res.status(400).json({
      success: false,
      error: '请先选择需要处理的报销单并指定审批动作。',
    })
    return
  }

  if (action === 'reject' && !reason?.trim()) {
    res.status(400).json({
      success: false,
      error: '批量驳回时请填写原因。',
    })
    return
  }

  const records = await prisma.reimbursement.findMany({
    where: {
      id: {
        in: ids,
      },
      status: ReimbursementStatus.pending_review,
    },
    select: {
      id: true,
      status: true,
    },
  })

  if (records.length === 0) {
    res.status(400).json({
      success: false,
      error: '当前没有可批量处理的待审报销单。',
    })
    return
  }

  const nextStatus =
    action === 'approve' ? ReimbursementStatus.completed : ReimbursementStatus.needs_revision

  await prisma.$transaction(async (tx) => {
    for (const item of records) {
      await tx.reimbursement.update({
        where: { id: item.id },
        data: {
          status: nextStatus,
          rejectionReason: action === 'reject' ? reason!.trim() : '',
          reviewLogs: {
            create: {
              operatorId: user.id,
              action,
              reason: reason?.trim() ?? '',
              fromStatus: item.status,
              toStatus: nextStatus,
            },
          },
        },
      })
    }
  })

  res.status(200).json({
    success: true,
    data: {
      processedCount: records.length,
    },
  })
})

export default router
