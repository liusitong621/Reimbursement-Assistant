import { prisma } from '../db.js'
import { ensureStorageDirs } from './storage.js'
import { DEFAULT_CATEGORY_DESCRIPTION, DEFAULT_CATEGORY_NAME } from '../routes/categories.js'

const FALLBACK_CREATOR_USERNAME = 'admin'

export async function bootstrapApp() {
  ensureStorageDirs()
  await prisma.$connect()
  await ensureDefaultCategory()
  await backfillReimbursementCategories()
}

async function ensureDefaultCategory() {
  const existing = await prisma.reimbursementCategory.findFirst({
    where: { name: DEFAULT_CATEGORY_NAME },
  })
  if (existing) {
    if (!existing.isActive) {
      await prisma.reimbursementCategory.update({
        where: { id: existing.id },
        data: { isActive: true },
      })
    }
    return existing
  }

  // Find a creator: prefer admin, otherwise any user
  let creator = await prisma.user.findFirst({
    where: { username: FALLBACK_CREATOR_USERNAME },
    select: { id: true },
  })
  if (!creator) {
    creator = await prisma.user.findFirst({ select: { id: true } })
  }
  if (!creator) {
    console.warn('[bootstrap] no users found; skipping default category creation')
    return null
  }

  return prisma.reimbursementCategory.create({
    data: {
      name: DEFAULT_CATEGORY_NAME,
      description: DEFAULT_CATEGORY_DESCRIPTION,
      sortOrder: 0,
      isActive: true,
      createdById: creator.id,
    },
  })
}

async function backfillReimbursementCategories() {
  const defaultCategory = await prisma.reimbursementCategory.findFirst({
    where: { name: DEFAULT_CATEGORY_NAME },
  })
  if (!defaultCategory) return

  const result = await prisma.reimbursement.updateMany({
    where: { categoryId: null },
    data: { categoryId: defaultCategory.id },
  })

  if (result.count > 0) {
    console.log(`[bootstrap] backfilled ${result.count} reimbursement(s) to "${DEFAULT_CATEGORY_NAME}"`)
  }
}
