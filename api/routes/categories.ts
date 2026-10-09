import { Router } from 'express'
import { Role } from '@prisma/client'
import { prisma } from '../db.js'
import { currentUser, requireAuth, requireRole, requireRoles } from '../middleware/auth.js'
import { calculateCategoryTotalAmount, type CategoryAmountReimbursement } from '../services/categoryStats.js'

const router = Router()

const DEFAULT_CATEGORY_NAME = '默认类型'
const DEFAULT_CATEGORY_DESCRIPTION = '系统内置的默认报销分类'

function serializeCategory(category: {
  id: string
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  createdById: string
  createdAt: Date
  updatedAt: Date
  createdBy?: { id: string; displayName: string; username: string } | null
  _count?: { reimbursements: number }
  reimbursements?: CategoryAmountReimbursement[]
}) {
  return {
    id: category.id,
    name: category.name,
    description: category.description ?? '',
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    isDefault: category.name === DEFAULT_CATEGORY_NAME,
    createdById: category.createdById,
    createdByName: category.createdBy?.displayName ?? category.createdBy?.username ?? '',
    reimbursementCount: category._count?.reimbursements ?? 0,
    totalAmount: calculateCategoryTotalAmount(category.reimbursements ?? []),
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  }
}

const categoryInclude = {
  createdBy: {
    select: { id: true, displayName: true, username: true },
  },
  _count: {
    select: { reimbursements: true },
  },
  reimbursements: {
    select: {
      amountStandard: true,
      invoiceTotalAmount: true,
      orders: {
        select: { paymentAmount: true },
      },
    },
  },
} as const

// GET /api/categories - list all active categories (any authenticated user)
router.get('/', requireAuth, async (_req, res) => {
  const categories = await prisma.reimbursementCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: categoryInclude,
  })
  res.status(200).json({
    success: true,
    data: categories.map(serializeCategory),
  })
})

// POST /api/categories - create new category
// 财务仅查看; 员工、部门负责人、管理员可创建
router.post('/', requireRoles(Role.employee, Role.leader, Role.admin), async (req, res) => {
  const { name, description } = req.body as { name?: string; description?: string }
  const user = currentUser(req)

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ success: false, error: '分类名称不能为空' })
    return
  }
  const trimmedName = name.trim()
  if (trimmedName.length > 30) {
 res.status(400).json({ success: false, error: '分类名称不能超过 30 个字符' })
    return
  }
  if (trimmedName === DEFAULT_CATEGORY_NAME) {
    res.status(400).json({ success: false, error: `"${DEFAULT_CATEGORY_NAME}" 是系统保留分类，无需创建` })
    return
  }

  // Determine next sortOrder
  const maxSort = await prisma.reimbursementCategory.aggregate({
    _max: { sortOrder: true },
  })
  const nextSortOrder = (maxSort._max.sortOrder ?? 0) + 1

  try {
    const created = await prisma.reimbursementCategory.create({
      data: {
        name: trimmedName,
        description: description?.trim() || null,
        sortOrder: nextSortOrder,
        createdById: user.id,
      },
      include: categoryInclude,
    })
    res.status(201).json({ success: true, data: serializeCategory(created) })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      res.status(409).json({ success: false, error: '已存在同名分类' })
      return
    }
    throw error
  }
})

// PATCH /api/categories/:id - update category (admin only)
router.patch('/:id', requireRole(Role.admin), async (req, res) => {
  const { id } = req.params
  const { name, description, sortOrder } = req.body as {
    name?: string
    description?: string
    sortOrder?: number
  }

  const existing = await prisma.reimbursementCategory.findUnique({ where: { id } })
  if (!existing) {
    res.status(404).json({ success: false, error: '分类不存在' })
    return
  }
  const isDefault = existing.name === DEFAULT_CATEGORY_NAME

  const data: { name?: string; description?: string | null; sortOrder?: number } = {}
  if (typeof name === 'string') {
    const trimmed = name.trim()
    if (!trimmed) {
      res.status(400).json({ success: false, error: '分类名称不能为空' })
      return
    }
    if (trimmed.length > 30) {
      res.status(400).json({ success: false, error: '分类名称不能超过 30 个字符' })
      return
    }
    if (isDefault && trimmed !== DEFAULT_CATEGORY_NAME) {
      res.status(400).json({ success: false, error: `"${DEFAULT_CATEGORY_NAME}" 是系统保留分类，名称不可修改` })
      return
    }
    if (!isDefault && trimmed === DEFAULT_CATEGORY_NAME) {
      res.status(400).json({ success: false, error: `"${DEFAULT_CATEGORY_NAME}" 是系统保留分类名称` })
      return
    }
    data.name = trimmed
  }
  if (description !== undefined) {
    data.description = typeof description === 'string' && description.trim() ? description.trim() : null
  }
  if (typeof sortOrder === 'number' && Number.isInteger(sortOrder)) {
    data.sortOrder = sortOrder
  }

  try {
    const updated = await prisma.reimbursementCategory.update({
      where: { id },
      data,
      include: categoryInclude,
    })
    res.status(200).json({ success: true, data: serializeCategory(updated) })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      res.status(409).json({ success: false, error: '已存在同名分类' })
      return
    }
    throw error
  }
})

// DELETE /api/categories/:id - delete with mandatory transfer (admin only)
router.delete('/:id', requireRole(Role.admin), async (req, res) => {
  const { id } = req.params
  const { transferToCategoryId } = req.body as { transferToCategoryId?: string }

  if (!transferToCategoryId) {
    res.status(400).json({ success: false, error: '必须指定目标分类用于迁移现有报销单' })
    return
  }
  if (transferToCategoryId === id) {
    res.status(400).json({ success: false, error: '目标分类不能是当前分类' })
    return
  }

  const source = await prisma.reimbursementCategory.findUnique({ where: { id } })
  if (!source) {
    res.status(404).json({ success: false, error: '分类不存在' })
    return
  }
  if (source.name === DEFAULT_CATEGORY_NAME) {
    res.status(400).json({ success: false, error: `"${DEFAULT_CATEGORY_NAME}" 是系统保留分类，不可删除` })
    return
  }
  const target = await prisma.reimbursementCategory.findUnique({ where: { id: transferToCategoryId } })
  if (!target || !target.isActive) {
    res.status(404).json({ success: false, error: '目标分类不存在或已停用' })
    return
  }

  // Refuse to delete the last non-default active category
  const otherActiveCount = await prisma.reimbursementCategory.count({
    where: { isActive: true, NOT: { id } },
  })
  if (otherActiveCount < 1) {
    res.status(400).json({ success: false, error: '至少需要保留一个其他分类作为迁移目标' })
    return
  }

  // Atomic transfer + delete
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.reimbursement.updateMany({
      where: { categoryId: id },
      data: { categoryId: transferToCategoryId },
    })
    await tx.reimbursementCategory.delete({ where: { id } })
    return updated.count
  })

  res.status(200).json({
    success: true,
    data: { transferredCount: result, targetCategoryId: transferToCategoryId },
  })
})

export { DEFAULT_CATEGORY_NAME, DEFAULT_CATEGORY_DESCRIPTION }
export default router
