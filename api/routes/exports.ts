import path from 'node:path'
import { Router } from 'express'
import { Role } from '@prisma/client'
import { prisma } from '../db.js'
import { currentUser, requireRole } from '../middleware/auth.js'
import { buildExportWorkbook } from '../services/exportWorkbook.js'
import { buildExportAttachments } from '../services/exportAttachments.js'
import {
  buildRecordWhere,
  filterRecordRows,
  flattenForRecords,
  reimbursementInclude,
  serializeReimbursement,
  buildExportTitle,
} from '../services/reimbursementData.js'
import { exportsDir } from '../services/storage.js'
import type { ExportPayload } from '../types.js'
import { sortRecordRows, sortableColumnKeys } from '../services/recordSort.js'

const router = Router()

const defaultColumns = [
  'parentChildMarker',
  'parentInvoiceNumber',
  'title',
  'platformName',
  'itemDescription',
  'orderNumber',
  'paymentTime',
  'paymentAmount',
  'note',
  'purchaserName',
  'invoiceStatus',
  'invoiceTotalAmount',
  'amountStandard',
  'amountMismatchNote',
  'invoiceNumber',
  'orderAttachmentUrl',
  'invoiceAttachmentUrl',
]

router.post('/', requireRole(Role.employee), async (req, res) => {
  const payload = req.body as ExportPayload
  const filters = payload.filters ?? {}
  const columns = payload.columns?.length ? payload.columns : defaultColumns

  const where = buildRecordWhere(filters, currentUser(req)!.role, currentUser(req)!.id)
  const reimbursements = await prisma.reimbursement.findMany({
    where,
    include: reimbursementInclude,
    orderBy: {
      updatedAt: 'desc',
    },
  })

  const flatRows = reimbursements.flatMap((item) => flattenForRecords(serializeReimbursement(item)))
  // 4.0.1: 导出顺序跟随页面当前选择的排序（列与方向均由前端传入），
  // 保证 xlsx 行顺序、附件 PDF 页面顺序与页面显示一致。
  const sort = payload.sort
  const rows = sort && sortableColumnKeys.has(sort.column)
    ? sortRecordRows(filterRecordRows(flatRows, filters), sort.column, sort.direction)
    : filterRecordRows(flatRows, filters)

  if (rows.length === 0) {
    res.status(400).json({
      success: false,
      error: '当前筛选条件下没有可导出的记录。',
    })
    return
  }

  // 3.1: 计算"组编号"。同一报销单的所有 order 行共享同一编号；
  // 编号 = 该报销单在本次结果中第一次出现的顺序（1, 2, 3 ...）。
  // 编号同时用于 xlsx 的第一列和 PDF 的页眉。
  const sequenceMap = new Map<string, number>()
  for (const row of rows) {
    if (!sequenceMap.has(row.reimbursementId)) {
      sequenceMap.set(row.reimbursementId, sequenceMap.size + 1)
    }
  }

  // 4.0.1: 附件合集 PDF 的页面顺序跟随导出行排序：按报销单在排序后行中首次出现的顺序排列。
  const reimbursementOrder = new Map<string, number>()
  for (const row of rows) {
    if (!reimbursementOrder.has(row.reimbursementId)) {
      reimbursementOrder.set(row.reimbursementId, reimbursementOrder.size)
    }
  }
  const orderedReimbursements = [...reimbursements].sort(
    (a, b) =>
      (reimbursementOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (reimbursementOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  )

  const exportRows: Record<string, string | number>[] = rows.map((row) => ({
    ...row,
    sequenceNumber: sequenceMap.get(row.reimbursementId) ?? 0,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString(),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : row.updatedAt.toISOString(),
  }))

  const [users, categories] = await Promise.all([
    prisma.user.findMany({ select: { id: true, displayName: true } }),
    prisma.reimbursementCategory.findMany({ select: { id: true, name: true } }),
  ])
  const filterNames = {
    creatorNames: Object.fromEntries(users.map((user) => [user.id, user.displayName])),
    purchaserNames: Object.fromEntries(users.map((user) => [user.id, user.displayName])),
    categoryNames: Object.fromEntries(categories.map((category) => [category.id, category.name])),
  }
  const exportTitle = buildExportTitle(filters, filterNames)
  const safeTitle = (exportTitle || '报销支出明细').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 180)
  const xlsxFileName = `${safeTitle}(系统导出版).xlsx`
  const xlsxFilePath = path.join(exportsDir, xlsxFileName)
  await buildExportWorkbook(xlsxFilePath, exportRows, columns, exportTitle)

  const pdfFileName = `${safeTitle}(附件).pdf`
  const pdfFilePath = path.join(exportsDir, pdfFileName)
  // 4.0.1: PDF 页面按排序后的报销单顺序生成，编号与 xlsx 完全对得上。
  await buildExportAttachments(pdfFilePath, orderedReimbursements, sequenceMap)

  const batch = await prisma.exportBatch.create({
    data: {
      exportedById: currentUser(req)!.id,
      filtersJson: JSON.stringify(filters),
      columnsJson: JSON.stringify(columns),
      filePath: xlsxFilePath,
      recordCount: rows.length,
    },
  })

  res.status(200).json({
    success: true,
    data: {
      id: batch.id,
      recordCount: rows.length,
      fileUrl: `/exports/${xlsxFileName}`,
      attachmentPdfUrl: `/exports/${pdfFileName}`,
    },
  })
})

export default router
