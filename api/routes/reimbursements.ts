import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { AttachmentKind, Prisma, ReimbursementStatus, Role, type InvoiceStatus, type PaymentMode } from '@prisma/client'

import { prisma } from '../db.js'
import { currentUser, requireAuth } from '../middleware/auth.js'
import {
  buildRecordWhere,
  filterRecordRows,
  flattenForRecords,
  reimbursementInclude,
  serializeReimbursement,
} from '../services/reimbursementData.js'
import { buildReserveFundLogData, calculateReserveFundUsage } from '../services/reserveFund.js'
import { uploadsDir } from '../services/storage.js'
import type { ReimbursementPayload, RecordFilters } from '../types.js'

type AmountStandard = 'invoice' | 'orders'

const router = Router()

// 4.1.1: 上传扩展名白名单——只允许图片与 PDF。
// 防止上传 .html/.svg 等经静态目录按扩展名设 Content-Type 造成存储型 XSS。
const UPLOAD_EXT_WHITELIST = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.pdf'])

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadsDir),
    filename: (_req, file, callback) => {
      const ext = path.extname(file.originalname).toLowerCase()
      callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
    },
  }),
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (UPLOAD_EXT_WHITELIST.has(ext)) {
      callback(null, true)
    } else {
      callback(new Error(`不支持的文件类型 ${ext}，仅允许图片（png/jpg/jpeg/webp/bmp/gif）与 PDF`))
    }
  },
})

function canViewReimbursement(
  currentUser: { id: string; role: Role },
  reimbursement: { creatorId: string; status: ReimbursementStatus },
) {
  if (currentUser.role === Role.admin || currentUser.role === Role.leader) {
    return true
  }

  if (currentUser.role === Role.finance) {
    return (
      reimbursement.creatorId === currentUser.id ||
      reimbursement.status === ReimbursementStatus.completed ||
      reimbursement.status === ReimbursementStatus.reimbursed
    )
  }

  return reimbursement.creatorId === currentUser.id
}

function canEditReimbursement(
  currentUser: { id: string; role: Role },
  reimbursement: { creatorId: string },
) {
  if (currentUser.role === Role.admin) {
    return true
  }

  if (currentUser.role === Role.finance) {
    return false
  }

  return reimbursement.creatorId === currentUser.id
}

function normalizeNumber(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function parsePayload(rawPayload: string | undefined) {
  if (!rawPayload) {
    throw new Error('缺少报销单数据。')
  }

  return JSON.parse(rawPayload) as ReimbursementPayload
}

function mapTransitionAction(fromStatus: ReimbursementStatus, toStatus: ReimbursementStatus) {
  if (fromStatus === ReimbursementStatus.draft && toStatus === ReimbursementStatus.unfinished) {
    return 'submit'
  }
  if (toStatus === ReimbursementStatus.pending_review) {
    return 'submit_for_review'
  }
  if (toStatus === ReimbursementStatus.unfinished) {
    return 'withdraw'
  }
  if (toStatus === ReimbursementStatus.needs_revision) {
    return 'reject'
  }
  if (toStatus === ReimbursementStatus.completed && fromStatus === ReimbursementStatus.pending_review) {
    return 'approve'
  }
  if (toStatus === ReimbursementStatus.reimbursed) {
    return 'mark_reimbursed'
  }
  if (toStatus === ReimbursementStatus.completed && fromStatus === ReimbursementStatus.reimbursed) {
    return 'undo_reimburse'
  }
  return 'status_change'
}

async function adjustReserveFundBalance(
  tx: Prisma.TransactionClient,
  creatorId: string,
  operatorId: string,
  previousUsage: number,
  nextUsage: number,
) {
  const delta = previousUsage - nextUsage
  if (delta === 0) {
    return
  }

  const user = await tx.user.findUnique({
    where: { id: creatorId },
  })

  if (!user) {
    throw new Error('没有找到报销单创建人。')
  }

  if (delta < 0 && user.reserveFundBalance < Math.abs(delta)) {
    throw new Error('当前备用金余额不足，请改为个人垫资需报销或调整金额。')
  }

  await tx.user.update({
    where: { id: creatorId },
    data: {
      reserveFundBalance: {
        increment: delta,
      },
      reserveFundNotice:
        delta < 0
          ? `你的备用金已扣减 ${Math.abs(delta).toFixed(2)} 元。`
          : `你的备用金已退回 ${delta.toFixed(2)} 元。`,
    },
  })

  await tx.reserveFundLog.create({
    data: buildReserveFundLogData(
      creatorId,
      operatorId,
      delta,
      delta < 0 ? '报销单进入非草稿状态扣减备用金' : '报销单回退或删除后退回备用金',
    ),
  })
}

router.get('/meta', requireAuth, async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: {
      createdAt: 'asc',
    },
  })

  res.status(200).json({
    success: true,
    data: {
      users: users.map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        reserveFundBalance: user.reserveFundBalance,
      })),
    },
  })
})

router.get('/', requireAuth, async (req, res) => {
  const filters: RecordFilters = {
    keyword: req.query.keyword as string | undefined,
    status: req.query.status as ReimbursementStatus | 'all' | undefined,
    invoiceStatus: req.query.invoiceStatus as InvoiceStatus | 'all' | undefined,
    paymentMode: req.query.paymentMode as PaymentMode | 'all' | undefined,
    creatorId: req.query.creatorId as string | undefined,
    purchaserId: req.query.purchaserId as string | undefined,
    createdFrom: req.query.createdFrom as string | undefined,
    createdTo: req.query.createdTo as string | undefined,
    paymentFrom: req.query.paymentFrom as string | undefined,
    paymentTo: req.query.paymentTo as string | undefined,
    categoryId: (req.query.categoryId as string | undefined) || undefined,
  }

  const where = buildRecordWhere(filters, currentUser(req)!.role, currentUser(req)!.id)
  const records = await prisma.reimbursement.findMany({
    where,
    include: reimbursementInclude,
    orderBy: {
      updatedAt: 'desc',
    },
  })

  res.status(200).json({
    success: true,
    data: records.map((item) => serializeReimbursement(item)),
  })
})

router.get('/records', requireAuth, async (req, res) => {
  const filters: RecordFilters = {
    keyword: req.query.keyword as string | undefined,
    status: req.query.status as ReimbursementStatus | 'all' | undefined,
    invoiceStatus: req.query.invoiceStatus as InvoiceStatus | 'all' | undefined,
    paymentMode: req.query.paymentMode as PaymentMode | 'all' | undefined,
    creatorId: req.query.creatorId as string | undefined,
    purchaserId: req.query.purchaserId as string | undefined,
    createdFrom: req.query.createdFrom as string | undefined,
    createdTo: req.query.createdTo as string | undefined,
    paymentFrom: req.query.paymentFrom as string | undefined,
    paymentTo: req.query.paymentTo as string | undefined,
    categoryId: (req.query.categoryId as string | undefined) || undefined,
  }

  const where = buildRecordWhere(filters, currentUser(req)!.role, currentUser(req)!.id)
  const records = await prisma.reimbursement.findMany({
    where,
    include: reimbursementInclude,
    orderBy: {
      updatedAt: 'desc',
    },
  })

  res.status(200).json({
    success: true,
    data: filterRecordRows(
      records.flatMap((item) => flattenForRecords(serializeReimbursement(item))),
      filters,
    ),
  })
})

// 4.0.3: 检查发票号 / 订单号是否与已有记录重复（可选排除某个报销单本身，用于编辑场景）。
async function findNumberCollisions(
  invoiceNumber: string,
  orderNumbers: string[],
  excludeReimbursementId?: string,
): Promise<{ invoice: string[]; orders: string[] }> {
  const invoice = invoiceNumber.trim()
  const orders = [...new Set(orderNumbers.map((n) => n.trim()).filter(Boolean))]
  const result: { invoice: string[]; orders: string[] } = { invoice: [], orders: [] }

  if (invoice) {
    const count = await prisma.reimbursement.count({
      where: {
        invoiceNumber: invoice,
        ...(excludeReimbursementId ? { id: { not: excludeReimbursementId } } : {}),
      },
    })
    if (count > 0) result.invoice.push(invoice)
  }

  if (orders.length > 0) {
    const rows = await prisma.orderItem.findMany({
      where: {
        orderNumber: { in: orders },
        ...(excludeReimbursementId ? { reimbursementId: { not: excludeReimbursementId } } : {}),
      },
      select: { orderNumber: true },
    })
    const found = new Set(rows.map((row) => row.orderNumber))
    result.orders = orders.filter((orderNumber) => found.has(orderNumber))
  }

  // 同一张报销单内订单号重复也视为冲突
  const seen = new Set<string>()
  const intraDuplicates = new Set<string>()
  for (const orderNumber of orderNumbers.map((n) => n.trim()).filter(Boolean)) {
    if (seen.has(orderNumber)) intraDuplicates.add(orderNumber)
    seen.add(orderNumber)
  }
  for (const orderNumber of intraDuplicates) {
    if (!result.orders.includes(orderNumber)) result.orders.push(orderNumber)
  }

  return result
}

router.get('/numbers', requireAuth, async (_req, res) => {
  const [invoiceRows, orderRows] = await Promise.all([
    prisma.reimbursement.findMany({
      where: { invoiceNumber: { not: '' } },
      select: { invoiceNumber: true },
    }),
    prisma.orderItem.findMany({
      where: { orderNumber: { not: '' } },
      select: { orderNumber: true },
    }),
  ])
  const invoiceNumbers = [...new Set(invoiceRows.map((row) => row.invoiceNumber.trim()).filter(Boolean))]
  const orderNumbers = [...new Set(orderRows.map((row) => row.orderNumber.trim()).filter(Boolean))]
  res.status(200).json({ success: true, data: { invoiceNumbers, orderNumbers } })
})

router.get('/:id', requireAuth, async (req, res) => {

  const reimbursement = await prisma.reimbursement.findUnique({
    where: { id: req.params.id },
    include: reimbursementInclude,
  })

  if (!reimbursement || !canViewReimbursement(currentUser(req)!, reimbursement)) {
    res.status(404).json({
      success: false,
      error: '没有找到对应报销单。',
    })
    return
  }

  res.status(200).json({
    success: true,
    data: serializeReimbursement(reimbursement),
  })
})

router.post('/', requireAuth, upload.any(), async (req, res) => {
  try {
    const user = currentUser(req)!
    if (user.role === Role.finance) {
      res.status(403).json({
        success: false,
        error: '财务账号不能新建报销单。',
      })
      return
    }

    const payload = parsePayload(req.body.payload as string | undefined)
    const files = (req.files as Express.Multer.File[]) ?? []
    const invoiceFiles = files.filter((file) => file.fieldname === 'invoiceImages')
    const orderFilesBySequence = new Map<number, Express.Multer.File[]>()

    for (const file of files.filter((item) => item.fieldname.startsWith('orderImages_'))) {
      const sequence = Number(file.fieldname.replace('orderImages_', ''))
      orderFilesBySequence.set(sequence, [...(orderFilesBySequence.get(sequence) ?? []), file])
    }

    const orderPaymentSum = payload.orders.reduce((sum, order) => sum + (Number(order.paymentAmount) || 0), 0)
    const amountMismatched = Math.abs(normalizeNumber(payload.invoiceTotalAmount) - orderPaymentSum) > 0.01
    if (payload.status === ReimbursementStatus.pending_review && amountMismatched && !payload.amountMismatchNote?.trim()) {
      res.status(400).json({
        success: false,
        error: '发票金额与订单金额不一致时必须填写情况说明',
      })
      return
    }
    if (amountMismatched && payload.amountStandard !== 'invoice' && payload.amountStandard !== 'orders') {
      res.status(400).json({
        success: false,
        error: '发票金额与订单金额不一致时必须选择报销标准',
      })
      return
    }

    // 4.0.3: 发票号 / 订单号与已有记录重复时禁止保存
    const collision = await findNumberCollisions(
      payload.invoiceNumber,
      payload.orders.map((order) => order.orderNumber),
    )
    const collisionMessages: string[] = []
    if (collision.invoice.length) {
      collisionMessages.push(`发票号码 ${collision.invoice.map((number) => `“${number}”`).join('、')} 已存在，禁止保存`)
    }
    if (collision.orders.length) {
      collisionMessages.push(`订单号 ${collision.orders.map((number) => `“${number}”`).join('、')} 已存在，禁止保存`)
    }
    if (collisionMessages.length) {
      res.status(400).json({ success: false, error: collisionMessages.join('；') })
      return
    }

    const reserveUsage = payload.status === ReimbursementStatus.draft ? 0 : calculateReserveFundUsage(payload.orders, payload.amountStandard, normalizeNumber(payload.invoiceTotalAmount))

    const reimbursement = await prisma.$transaction(async (tx) => {
      if (reserveUsage > 0) {
        await adjustReserveFundBalance(tx, user.id, user.id, 0, reserveUsage)
      }

      return tx.reimbursement.create({
        data: {
          title: payload.title,
          creatorId: user.id,
          categoryId: payload.categoryId || null,
          status: payload.status,
          invoiceSellerName: payload.invoiceSellerName,
          invoiceSellerTaxNo: payload.invoiceSellerTaxNo,
          invoiceAmountExcludingTax: normalizeNumber(payload.invoiceAmountExcludingTax),
          invoiceTaxAmount: normalizeNumber(payload.invoiceTaxAmount),
          invoiceTaxRate: payload.invoiceTaxRate,
          invoiceTotalAmount: normalizeNumber(payload.invoiceTotalAmount),
          invoiceNumber: payload.invoiceNumber,
          invoiceStatus: payload.invoiceStatus,
          amountStandard: payload.amountStandard || ('orders' as AmountStandard),
          amountMismatchNote: payload.amountMismatchNote ?? '',
          orders: {
            create: payload.orders.map((order, index) => ({
              sequence: order.sequence || index + 1,
              platformCategory: order.platformCategory,
              platformName: order.platformName,
              merchantName: order.merchantName,
              itemDescription: order.itemDescription,
              orderNumber: order.orderNumber,
              paymentTime: order.paymentTime,
              paymentAmount: normalizeNumber(order.paymentAmount),
              orderStatus: order.orderStatus,
              note: order.note,
              purchaserId: order.purchaserId || null,
              paymentMode: order.paymentMode,
              isParentOrder: index === 0,
              participants: {
                create: (order.userIds ?? []).map((userId) => ({ userId })),
              },
              attachments: {
                create: (orderFilesBySequence.get(order.sequence) ?? []).slice(0, 2).map((file, fileIndex) => ({
                  kind: AttachmentKind.order,
                  fileName: file.originalname,
                  filePath: file.path,
                  mimeType: file.mimetype,
                  sortOrder: fileIndex,
                })),
              },
            })),
          },
          attachments: {
            create: invoiceFiles.map((file, index) => ({
              kind: AttachmentKind.invoice,
              fileName: file.originalname,
              filePath: file.path,
              mimeType: file.mimetype,
              sortOrder: index,
            })),
          },
          reviewLogs: {
            create: {
              operatorId: user.id,
              action: 'create',
              toStatus: payload.status,
            },
          },
        },
        include: reimbursementInclude,
      })
    })

    res.status(201).json({
      success: true,
      data: serializeReimbursement(reimbursement),
    })
  } catch (error) {
    res.status(400).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

// 编辑报销单同样支持上传附件：与 POST 共用 upload.any() 文件处理逻辑。
router.patch('/:id', requireAuth, upload.any(), async (req, res) => {
  try {
    const user = currentUser(req)!
    // 编辑走 multipart：payload JSON 放在 req.body.payload，文件在 req.files
    const payload = parsePayload(req.body.payload as string | undefined)
    const files = (req.files as Express.Multer.File[]) ?? []
    const invoiceFiles = files.filter((file) => file.fieldname === 'invoiceImages')
    const orderFilesBySequence = new Map<number, Express.Multer.File[]>()

    for (const file of files.filter((item) => item.fieldname.startsWith('orderImages_'))) {
      const sequence = Number(file.fieldname.replace('orderImages_', ''))
      orderFilesBySequence.set(sequence, [...(orderFilesBySequence.get(sequence) ?? []), file])
    }

    const existing = await prisma.reimbursement.findUnique({
      where: { id: req.params.id },
      include: reimbursementInclude,
    })

    if (!existing || !canEditReimbursement(user, existing)) {
      res.status(404).json({
        success: false,
        error: '没有找到对应报销单。',
      })
      return
    }

    const orderPaymentSum = payload.orders.reduce((sum, order) => sum + (Number(order.paymentAmount) || 0), 0)
    const amountMismatched = Math.abs(normalizeNumber(payload.invoiceTotalAmount) - orderPaymentSum) > 0.01
    if (payload.status === ReimbursementStatus.pending_review && amountMismatched && !payload.amountMismatchNote?.trim()) {
      res.status(400).json({
        success: false,
        error: '发票金额与订单金额不一致时必须填写情况说明',
      })
      return
    }
    if (amountMismatched && payload.amountStandard !== 'invoice' && payload.amountStandard !== 'orders') {
      res.status(400).json({
        success: false,
        error: '发票金额与订单金额不一致时必须选择报销标准',
      })
      return
    }

    const previousUsage =
      existing.status === ReimbursementStatus.draft ? 0 : calculateReserveFundUsage(existing.orders, existing.amountStandard, existing.invoiceTotalAmount)

    // 4.0.3: 发票号 / 订单号与已有记录重复时禁止保存（编辑时排除本单自身）
    const collision = await findNumberCollisions(
      payload.invoiceNumber,
      payload.orders.map((order) => order.orderNumber),
      existing.id,
    )
    const collisionMessages: string[] = []
    if (collision.invoice.length) {
      collisionMessages.push(`发票号码 ${collision.invoice.map((number) => `“${number}”`).join('、')} 已存在，禁止保存`)
    }
    if (collision.orders.length) {
      collisionMessages.push(`订单号 ${collision.orders.map((number) => `“${number}”`).join('、')} 已存在，禁止保存`)
    }
    if (collisionMessages.length) {
      res.status(400).json({ success: false, error: collisionMessages.join('；') })
      return
    }
    const nextUsage = payload.status === ReimbursementStatus.draft ? 0 : calculateReserveFundUsage(payload.orders, payload.amountStandard, normalizeNumber(payload.invoiceTotalAmount))
    // 已有发票附件保留：新追加的发票附件排在已有附件之后
    const invoiceBaseSort = existing.attachments.length ? Math.max(...existing.attachments.map((item) => item.sortOrder)) + 1 : 0

    // 3.0 修复：编辑报销单时按 OrderItem.id 做 upsert，而不是 delete+recreate，
    // 否则用户没新传订单截图时，旧的订单附件会被一起清空（红框消失的根因）。
    const existingOrderById = new Map(existing.orders.map((item) => [item.id, item]))
    const incomingOrderIds = new Set(
      payload.orders.filter((item) => item.id).map((item) => item.id as string),
    )
    const orderIdsToDelete = existing.orders.map((item) => item.id).filter((id) => !incomingOrderIds.has(id))

    const updated = await prisma.$transaction(async (tx) => {
      await adjustReserveFundBalance(tx, existing.creatorId, user.id, previousUsage, nextUsage)

      // 删除报销单中已经被移除的子订单：cascade 会清掉它们的附件与参与人
      if (orderIdsToDelete.length > 0) {
        await tx.orderItem.deleteMany({
          where: { id: { in: orderIdsToDelete } },
        })
      }

      // 逐个按 id upsert 子订单：保留已有附件，仅追加本次新传的附件
      for (let index = 0; index < payload.orders.length; index += 1) {
        const order = payload.orders[index]
        const isParentOrder = index === 0
        const newAttachments = (orderFilesBySequence.get(order.sequence) ?? []).slice(0, 2)

        if (order.id && existingOrderById.has(order.id)) {
          await tx.orderItem.update({
            where: { id: order.id },
            data: {
              sequence: order.sequence,
              platformCategory: order.platformCategory,
              platformName: order.platformName,
              merchantName: order.merchantName,
              itemDescription: order.itemDescription,
              orderNumber: order.orderNumber,
              paymentTime: order.paymentTime,
              paymentAmount: normalizeNumber(order.paymentAmount),
              orderStatus: order.orderStatus,
              note: order.note,
              purchaserId: order.purchaserId || null,
              paymentMode: order.paymentMode,
              isParentOrder,
              participants: {
                deleteMany: {},
                create: (order.userIds ?? []).map((userId) => ({ userId })),
              },
              ...(newAttachments.length > 0
                ? {
                    attachments: {
                      create: newAttachments.map((file, fileIndex) => ({
                        kind: AttachmentKind.order,
                        fileName: file.originalname,
                        filePath: file.path,
                        mimeType: file.mimetype,
                        // sortOrder 留出大量间隔，避免与已有附件冲突
                        sortOrder: 1000 + fileIndex,
                      })),
                    },
                  }
                : {}),
            },
          })
        } else {
          await tx.orderItem.create({
            data: {
              reimbursementId: existing.id,
              sequence: order.sequence,
              platformCategory: order.platformCategory,
              platformName: order.platformName,
              merchantName: order.merchantName,
              itemDescription: order.itemDescription,
              orderNumber: order.orderNumber,
              paymentTime: order.paymentTime,
              paymentAmount: normalizeNumber(order.paymentAmount),
              orderStatus: order.orderStatus,
              note: order.note,
              purchaserId: order.purchaserId || null,
              paymentMode: order.paymentMode,
              isParentOrder,
              participants: {
                create: (order.userIds ?? []).map((userId) => ({ userId })),
              },
              attachments: {
                create: newAttachments.map((file, fileIndex) => ({
                  kind: AttachmentKind.order,
                  fileName: file.originalname,
                  filePath: file.path,
                  mimeType: file.mimetype,
                  sortOrder: fileIndex,
                })),
              },
            },
          })
        }
      }

      return tx.reimbursement.update({
        where: { id: existing.id },
        data: {
          title: payload.title,
          categoryId: payload.categoryId || null,
          status: payload.status,
          invoiceSellerName: payload.invoiceSellerName,
          invoiceSellerTaxNo: payload.invoiceSellerTaxNo,
          invoiceAmountExcludingTax: normalizeNumber(payload.invoiceAmountExcludingTax),
          invoiceTaxAmount: normalizeNumber(payload.invoiceTaxAmount),
          invoiceTaxRate: payload.invoiceTaxRate,
          invoiceTotalAmount: normalizeNumber(payload.invoiceTotalAmount),
          invoiceNumber: payload.invoiceNumber,
          invoiceStatus: payload.invoiceStatus,
          amountStandard: payload.amountStandard || ('orders' as AmountStandard),
          amountMismatchNote: payload.amountMismatchNote ?? '',
          attachments: {
            create: invoiceFiles.map((file, index) => ({
              kind: AttachmentKind.invoice,
              fileName: file.originalname,
              filePath: file.path,
              mimeType: file.mimetype,
              sortOrder: invoiceBaseSort + index,
            })),
          },
          reviewLogs: {
            create: {
              operatorId: user.id,
              action: 'update',
              fromStatus: existing.status,
              toStatus: payload.status,
            },
          },
        },
        include: reimbursementInclude,
      })
    })

    res.status(200).json({
      success: true,
      data: serializeReimbursement(updated),
    })
  } catch (error) {
    res.status(400).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.post('/:id/withdraw', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  const existing = await prisma.reimbursement.findUnique({
    where: { id: req.params.id },
  })

  if (!existing || existing.creatorId !== user.id) {
    res.status(404).json({
      success: false,
      error: '没有找到对应报销单。',
    })
    return
  }

  if (existing.status !== ReimbursementStatus.pending_review && existing.status !== ReimbursementStatus.needs_revision) {
    res.status(400).json({
      success: false,
      error: '当前状态不能撤回送审。',
    })
    return
  }

  const updated = await prisma.reimbursement.update({
    where: { id: existing.id },
    data: {
      status: ReimbursementStatus.unfinished,
      rejectionReason: '',
      reviewLogs: {
        create: {
          operatorId: user.id,
          action: 'withdraw',
          fromStatus: existing.status,
          toStatus: ReimbursementStatus.unfinished,
        },
      },
    },
    include: reimbursementInclude,
  })

  res.status(200).json({
    success: true,
    data: serializeReimbursement(updated),
  })
})

router.post('/:id/review', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  if (user.role !== Role.leader && user.role !== Role.admin) {
    res.status(403).json({
      success: false,
      error: '当前账号没有审批权限。',
    })
    return
  }

  const { action, reason } = req.body as { action: 'approve' | 'reject'; reason?: string }
  const existing = await prisma.reimbursement.findUnique({
    where: { id: req.params.id },
  })

  if (!existing) {
    res.status(404).json({
      success: false,
      error: '没有找到对应报销单。',
    })
    return
  }

  const nextStatus =
    action === 'approve' ? ReimbursementStatus.completed : ReimbursementStatus.needs_revision

  const updated = await prisma.reimbursement.update({
    where: { id: existing.id },
    data: {
      status: nextStatus,
      rejectionReason: action === 'reject' ? reason ?? '' : '',
      reviewLogs: {
        create: {
          operatorId: user.id,
          action,
          reason: reason ?? '',
          fromStatus: existing.status,
          toStatus: nextStatus,
        },
      },
    },
    include: reimbursementInclude,
  })

  res.status(200).json({
    success: true,
    data: serializeReimbursement(updated),
  })
})

router.post('/:id/reimburse', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  if (user.role !== Role.finance && user.role !== Role.admin) {
    res.status(403).json({
      success: false,
      error: '当前账号没有核销权限。',
    })
    return
  }

  const existing = await prisma.reimbursement.findUnique({
    where: { id: req.params.id },
    include: reimbursementInclude,
  })

  if (!existing) {
    res.status(404).json({
      success: false,
      error: '没有找到对应报销单。',
    })
    return
  }

  const updated = await prisma.reimbursement.update({
    where: { id: existing.id },
    data: {
      status: ReimbursementStatus.reimbursed,
      reviewLogs: {
        create: {
          operatorId: user.id,
          action: 'mark_reimbursed',
          fromStatus: existing.status,
          toStatus: ReimbursementStatus.reimbursed,
        },
      },
    },
    include: reimbursementInclude,
  })

  res.status(200).json({
    success: true,
    data: serializeReimbursement(updated),
  })
})

router.post('/:id/undo-reimburse', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  if (user.role !== Role.admin) {
    res.status(403).json({
      success: false,
      error: '仅管理员可以将已报销状态的报销单退回为已办结。',
    })
    return
  }

  const existing = await prisma.reimbursement.findUnique({
    where: { id: req.params.id },
  })

  if (!existing) {
    res.status(404).json({
      success: false,
      error: '没有找到对应报销单。',
    })
    return
  }

  if (existing.status !== ReimbursementStatus.reimbursed) {
    res.status(400).json({
      success: false,
      error: '当前状态不能退回为已办结。',
    })
    return
  }

  const updated = await prisma.reimbursement.update({
    where: { id: existing.id },
    data: {
      status: ReimbursementStatus.completed,
      reviewLogs: {
        create: {
          operatorId: user.id,
          action: 'undo_reimburse',
          fromStatus: existing.status,
          toStatus: ReimbursementStatus.completed,
        },
      },
    },
    include: reimbursementInclude,
  })

  res.status(200).json({
    success: true,
    data: serializeReimbursement(updated),
  })
})
router.post('/batch-reimburse', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  if (user.role !== Role.finance && user.role !== Role.admin) {
    res.status(403).json({
      success: false,
      error: '当前账号没有批量核销权限。',
    })
    return
  }

  const { ids } = req.body as { ids?: string[] }

  if (!ids?.length) {
    res.status(400).json({
      success: false,
      error: '请先勾选需要批量处理的报销单。',
    })
    return
  }

  const records = await prisma.reimbursement.findMany({
    where: {
      id: {
        in: [...new Set(ids)],
      },
      status: ReimbursementStatus.completed,
    },
    select: {
      id: true,
      status: true,
    },
  })

  if (!records.length) {
    res.status(400).json({
      success: false,
      error: '当前没有可批量核销的已办结报销单。',
    })
    return
  }

  await prisma.$transaction(async (tx) => {
    for (const record of records) {
      await tx.reimbursement.update({
        where: { id: record.id },
        data: {
          status: ReimbursementStatus.reimbursed,
          reviewLogs: {
            create: {
              operatorId: user.id,
              action: 'mark_reimbursed',
              fromStatus: record.status,
              toStatus: ReimbursementStatus.reimbursed,
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

// 批量改变报销单状态：按状态流转规则逐单校验，合法流转才处理，其余跳过
router.post('/batch-status', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  const { ids, status, reason } = req.body as {
    ids?: string[]
    status?: ReimbursementStatus
    reason?: string
  }

  if (!ids?.length || !status) {
    res.status(400).json({
      success: false,
      error: '请先勾选需要处理的报销单并指定目标状态。',
    })
    return
  }

  const records = await prisma.reimbursement.findMany({
    where: {
      id: {
        in: [...new Set(ids)],
      },
    },
    include: {
      orders: {
        select: { paymentMode: true, paymentAmount: true },
      },
    },
  })

  const skippedReasons: string[] = []
  const targets: typeof records = []

  for (const record of records) {
    const from = record.status
    const to = status

    // 权限：admin 可操作任意报销单，其余仅限自己创建
    if (user.role !== Role.admin && record.creatorId !== user.id) {
      skippedReasons.push(`${record.title || record.invoiceNumber || record.id}：非本人创建的报销单`)
      continue
    }

    const allowedTransition =
      (from === ReimbursementStatus.draft && to === ReimbursementStatus.unfinished) ||
      ((from === ReimbursementStatus.unfinished || from === ReimbursementStatus.needs_revision) &&
        to === ReimbursementStatus.pending_review) ||
      (from === ReimbursementStatus.pending_review &&
        (to === ReimbursementStatus.completed ||
          to === ReimbursementStatus.needs_revision ||
          to === ReimbursementStatus.unfinished)) ||
      (from === ReimbursementStatus.needs_revision && to === ReimbursementStatus.unfinished) ||
      (from === ReimbursementStatus.completed && to === ReimbursementStatus.reimbursed) ||
      (from === ReimbursementStatus.reimbursed && to === ReimbursementStatus.completed)

    if (!allowedTransition) {
      skippedReasons.push(`${record.title || record.invoiceNumber || record.id}：状态流转 ${from} → ${to} 不符合规则`)
      continue
    }

    // 驳回必须填原因
    if (to === ReimbursementStatus.needs_revision && !reason?.trim()) {
      skippedReasons.push(`${record.title || record.invoiceNumber || record.id}：驳回到待修改必须填写原因`)
      continue
    }

    // 审批 / 核销 / 退回的角色权限
    if (
      (to === ReimbursementStatus.completed || to === ReimbursementStatus.needs_revision) &&
      user.role !== Role.leader &&
      user.role !== Role.admin
    ) {
      skippedReasons.push(`${record.title || record.invoiceNumber || record.id}：没有审批权限`)
      continue
    }

    if (to === ReimbursementStatus.reimbursed && user.role !== Role.finance && user.role !== Role.admin) {
      skippedReasons.push(`${record.title || record.invoiceNumber || record.id}：没有核销权限`)
      continue
    }

    if (to === ReimbursementStatus.completed && from === ReimbursementStatus.reimbursed && user.role !== Role.admin) {
      skippedReasons.push(`${record.title || record.invoiceNumber || record.id}：仅管理员可将已报销退回为已办结`)
      continue
    }

    // 送审时金额不一致必须已有差异说明
    if (to === ReimbursementStatus.pending_review && !record.amountMismatchNote?.trim()) {
      const orderPaymentSum = record.orders.reduce((sum, order) => sum + Number(order.paymentAmount || 0), 0)
      if (Math.abs(normalizeNumber(record.invoiceTotalAmount) - orderPaymentSum) > 0.01) {
        skippedReasons.push(`${record.title || record.invoiceNumber || record.id}：金额不一致且未填写差异说明`)
        continue
      }
    }

    targets.push(record)
  }

  if (targets.length === 0) {
    res.status(400).json({
      success: false,
      error: `所选报销单均无法转为该状态：${skippedReasons.slice(0, 3).join('；')}`, 
    })
    return
  }

  const processedIds: string[] = []

  for (const record of targets) {
    try {
      await prisma.$transaction(async (tx) => {
        // 从草稿进入非草稿状态时按规则扣减备用金（余额不足会在此抛出，跳过该单）
        if (record.status === ReimbursementStatus.draft) {
          const reserveUsage = calculateReserveFundUsage(
            record.orders,
            record.amountStandard,
            record.invoiceTotalAmount,
          )
          if (reserveUsage > 0) {
            await adjustReserveFundBalance(tx, record.creatorId, user.id, 0, reserveUsage)
          }
        }

        await tx.reimbursement.update({
          where: { id: record.id },
          data: {
            status,
            rejectionReason: status === ReimbursementStatus.needs_revision ? (reason?.trim() ?? '') : '',
            reviewLogs: {
              create: {
                operatorId: user.id,
                action: mapTransitionAction(record.status, status),
                reason: reason?.trim() ?? '',
                fromStatus: record.status,
                toStatus: status,
              },
            },
          },
        })
      })
      processedIds.push(record.id)
    } catch (error) {
      skippedReasons.push(`${record.title || record.invoiceNumber || record.id}：${(error as Error).message}`)
    }
  }

  res.status(200).json({
    success: true,
    data: {
      processedCount: processedIds.length,
      skippedCount: records.length - processedIds.length,
      skippedReasons,
    },
  })
})
router.post('/batch-delete', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  const { ids } = req.body as { ids?: string[] }

  if (!ids?.length) {
    res.status(400).json({
      success: false,
      error: '请先勾选需要删除的报销单。',
    })
    return
  }

  const records = await prisma.reimbursement.findMany({
    where: {
      id: {
        in: [...new Set(ids)],
      },
    },
    include: reimbursementInclude,
  })

  // 与单条删除一致：员工 / 部门负责人只能删除自己创建的草稿 / 未完结报销单，管理员可删除任意报销单。
  const deletable = records.filter((record) => {
    if (user.role === Role.admin) {
      return true
    }

    if (record.creatorId !== user.id) {
      return false
    }

    return (
      record.status === ReimbursementStatus.draft ||
      record.status === ReimbursementStatus.unfinished
    )
  })

  if (deletable.length === 0) {
    res.status(400).json({
      success: false,
      error: '所选报销单均不可删除：仅可删除自己创建的草稿或未完结报销单（管理员可删除任意报销单）。',
    })
    return
  }

  await prisma.$transaction(async (tx) => {
    for (const record of deletable) {
      const refundAmount =
        record.status === ReimbursementStatus.draft
          ? 0
          : calculateReserveFundUsage(record.orders, record.amountStandard, record.invoiceTotalAmount)

      if (refundAmount > 0) {
        await adjustReserveFundBalance(tx, record.creatorId, user.id, refundAmount, 0)
      }

      await tx.reimbursement.delete({
        where: { id: record.id },
      })
    }
  })

  for (const record of deletable) {
    for (const file of [...record.attachments, ...record.orders.flatMap((order) => order.attachments)]) {
      if (fs.existsSync(file.filePath)) {
        fs.unlinkSync(file.filePath)
      }
    }
  }

  res.status(200).json({
    success: true,
    data: {
      processedCount: deletable.length,
    },
  })
})

router.delete('/attachments/:id', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  const attachment = await prisma.attachment.findUnique({
    where: { id: req.params.id },
    include: {
      reimbursement: { select: { id: true, creatorId: true } },
      orderItem: {
        include: {
          reimbursement: { select: { id: true, creatorId: true } },
        },
      },
    },
  })
  const reimbursement = attachment?.reimbursement ?? attachment?.orderItem?.reimbursement
  if (!attachment || !reimbursement || !canEditReimbursement(user, reimbursement)) {
    res.status(404).json({ success: false, error: '没有找到对应附件。' })
    return
  }
  await prisma.attachment.delete({ where: { id: attachment.id } })
  const resolvedPath = path.resolve(attachment.filePath)
  const uploadRoot = path.resolve(uploadsDir)
  if (resolvedPath.startsWith(uploadRoot + path.sep) && fs.existsSync(resolvedPath)) {
    try {
      fs.unlinkSync(resolvedPath)
    } catch {
      // 文件已被移动或删除时不影响附件记录删除结果
    }
  }
  res.status(200).json({ success: true, data: { id: attachment.id } })
})
router.delete('/:id', requireAuth, async (req, res) => {
  const user = currentUser(req)!
  const existing = await prisma.reimbursement.findUnique({
    where: { id: req.params.id },
    include: reimbursementInclude,
  })

  if (!existing || !canEditReimbursement(user, existing)) {
    res.status(404).json({
      success: false,
      error: '没有找到对应报销单。',
    })
    return
  }

  if (
    user.role !== Role.admin &&
    existing.status !== ReimbursementStatus.draft &&
    existing.status !== ReimbursementStatus.unfinished
  ) {
    res.status(400).json({
      success: false,
      error: '当前状态不能删除，请先撤回为未完结。',
    })
    return
  }

  const refundAmount =
    existing.status === ReimbursementStatus.draft ? 0 : calculateReserveFundUsage(existing.orders, existing.amountStandard, existing.invoiceTotalAmount)

  await prisma.$transaction(async (tx) => {
    if (refundAmount > 0) {
      await adjustReserveFundBalance(tx, existing.creatorId, user.id, refundAmount, 0)
    }

    await tx.reimbursement.delete({
      where: { id: existing.id },
    })
  })

  for (const file of [...existing.attachments, ...existing.orders.flatMap((order) => order.attachments)]) {
    if (fs.existsSync(file.filePath)) {
      fs.unlinkSync(file.filePath)
    }
  }

  res.status(200).json({
    success: true,
  })
})

export default router
