import path from 'node:path'
import { fromPublicFilePath } from './storage.js'
import ExcelJS from 'exceljs'

// 3.1: 编号列固定在最前；这一列也用于"附件合集 PDF"中的页眉编号。
// 表头固定为"编号"，由路由在构造行数据时写入 sequenceNumber 字段。
const SEQUENCE_COLUMN_KEY = 'sequenceNumber'

const columnMap: Record<string, { header: string; width: number }> = {
  sequenceNumber: { header: '编号', width: 10 },
  parentChildMarker: { header: '子单标识', width: 12 },
  categoryName: { header: '分类', width: 14 },
  parentInvoiceNumber: { header: '所属子单发票号', width: 24 },
  title: { header: '报销标题', width: 20 },
  creatorName: { header: '填单人', width: 14 },
  status: { header: '报销单状态', width: 14 },
  rejectionReason: { header: '驳回原因', width: 30 },
  invoiceStatus: { header: '开票状态', width: 14 },
  invoiceNumber: { header: '开票号码', width: 22 },
  invoiceSellerName: { header: '销售方名称', width: 22 },
  invoiceTotalAmount: { header: '发票价税合计', width: 14 },
  amountStandard: { header: '金额报销标准', width: 16 },
  amountMismatchNote: { header: '金额差异说明', width: 30 },
  platformCategory: { header: '平台分类', width: 14 },
  platformName: { header: '订单平台', width: 16 },
  merchantName: { header: '商家名称', width: 20 },
  itemDescription: { header: '订单商品信息', width: 24 },
  orderNumber: { header: '订单号', width: 22 },
  paymentTime: { header: '订单支付时间', width: 22 },
  paymentAmount: { header: '订单支付金额', width: 14 },
  orderStatus: { header: '订单状态', width: 14 },
  note: { header: '订单备注', width: 20 },
  purchaserName: { header: '采购人', width: 14 },
  userNames: { header: '使用人', width: 20 },
  paymentMode: { header: '报销方式', width: 14 },
  orderAttachmentUrl: { header: '订单截图', width: 16 },
  invoiceAttachmentUrl: { header: '发票截图', width: 16 },
  createdAt: { header: '创建时间', width: 20 },
  updatedAt: { header: '更新时间', width: 20 },
}

// 3.6.1: 导出 Excel 时把英文枚举值转换为网页上显示的中文文案。
const reimbursementStatusLabels: Record<string, string> = {
  draft: '草稿',
  unfinished: '未完结报销',
  pending_review: '待审核',
  needs_revision: '待修改',
  completed: '已办结',
  reimbursed: '已报销',
}

const invoiceStatusLabels: Record<string, string> = {
  none: '无发票',
  not_issued: '未开票',
  waiting_issued: '等待开票中',
  issued: '已开票',
}

const paymentModeLabels: Record<string, string> = {
  personal_reimbursement: '个人垫资需报销',
  reserve_fund: '该订单使用备用金',
}

const amountStandardLabels: Record<string, string> = {
  invoice: '以发票金额为准',
  orders: '以订单金额为准',
}

const valueFormatters: Record<string, (value: string | number) => string | number> = {
  status: (value) => reimbursementStatusLabels[String(value)] ?? value,
  invoiceStatus: (value) => invoiceStatusLabels[String(value)] ?? value,
  paymentMode: (value) => paymentModeLabels[String(value)] ?? value,
  amountStandard: (value) => amountStandardLabels[String(value)] ?? value,
}

type RecordRow = Record<string, string | number>

function exportPaymentAmountDisplay(row: RecordRow): number {
  const invoiceTotal = Number(row.invoiceTotalAmount || 0)
  const ordersSum = Number(row.ordersPaymentSum || 0)
  const mismatched = Math.abs(invoiceTotal - ordersSum) > 0.01
  if (mismatched && row.amountStandard === 'invoice') {
    return row.parentChildMarker === '母' ? invoiceTotal : 0
  }
  return Number(row.paymentAmount || 0)
}

// 把"编号"列固定到第一列；同时剔除掉无效列与重复的 sequenceNumber。
function normalizeColumns(columns: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const col of columns) {
    if (!columnMap[col]) continue
    if (seen.has(col)) continue
    seen.add(col)
    result.push(col)
  }
  // 编号列始终在最前, 分类列始终在第二列
  const withoutSequence = result.filter((c) => c !== SEQUENCE_COLUMN_KEY)
  return [SEQUENCE_COLUMN_KEY, 'categoryName', ...withoutSequence.filter((c) => c !== 'categoryName')]
}

function colLetter(index: number): string {
  let result = ''
  let n = index
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}

function allBorders() {
  const style = { style: 'thin' } as const
  return { top: style, left: style, bottom: style, right: style }
}

// 标题越长字号越小，避免文字溢出。
function titleFontSize(title: string): number {
  if (title.length > 70) return 16
  if (title.length > 55) return 20
  if (title.length > 40) return 26
  if (title.length > 28) return 34
  return 48
}

export async function buildExportWorkbook(
  filePath: string,
  rows: RecordRow[],
  columns: string[],
  title: string,
) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('报销导出')
  const normalizedColumns = normalizeColumns(columns)

  sheet.columns = normalizedColumns.map((column) => ({
    key: column,
    width: columnMap[column].width,
  }))

  // 1) 大标题行
  const titleRow = sheet.getRow(1)
  titleRow.height = 85
  const titleCell = titleRow.getCell(1)
  titleCell.value = title
  titleCell.font = { name: '宋体', size: titleFontSize(title) }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  titleCell.border = allBorders()
  sheet.mergeCells(1, 1, 1, sheet.columnCount)

  // 2) 表头行（第 2 行）
  const headerRow = sheet.getRow(2)
  normalizedColumns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = columnMap[column].header
    cell.font = { name: '宋体', size: 11, bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = allBorders()
  })
  sheet.views = [{ state: 'frozen', ySplit: 2 }]

  // 3) 数据行
  const dataStartRow = 3
  for (const rowData of rows) {
    const row = sheet.addRow(
      Object.fromEntries(
        normalizedColumns
          .filter((column) => !column.endsWith('AttachmentUrl'))
          .map((column) => {
            const value = rowData[column] ?? ''
            if (column === 'paymentAmount') {
              return [column, exportPaymentAmountDisplay(rowData)]
            }
            const format = valueFormatters[column]
            return [column, format ? format(value) : value]
          }),
      ),
    )

    row.height = 44

    for (let index = 1; index <= normalizedColumns.length; index += 1) {
      const cell = row.getCell(index)
      cell.font = { name: '宋体', size: 11 }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = allBorders()
    }

    for (const imageColumn of [
      { key: 'orderAttachmentUrl', value: rowData.orderAttachmentUrl },
      { key: 'invoiceAttachmentUrl', value: rowData.invoiceAttachmentUrl },
    ]) {
      const columnIndex = normalizedColumns.indexOf(imageColumn.key)
      if (columnIndex === -1 || !imageColumn.value) {
        continue
      }

      // 3.1.1 修复: 用 storage 的反向函数解析 URL -> 绝对路径,避免 dev/prod cwd 不一致
      const fullPath = fromPublicFilePath(String(imageColumn.value))
      const extension = path.extname(fullPath).replace('.', '').toLowerCase()

      if (!['png', 'jpg', 'jpeg'].includes(extension)) {
        row.getCell(columnIndex + 1).value = String(imageColumn.value)
        continue
      }

      const imageId = workbook.addImage({
        filename: fullPath,
        extension: extension === 'jpg' ? 'jpeg' : (extension as 'png' | 'jpeg'),
      })

      sheet.addImage(imageId, {
        tl: { col: columnIndex + 0.08, row: row.number - 0.8 },
        ext: { width: 72, height: 48 },
      })
      row.getCell(columnIndex + 1).value = ''
    }
  }

  // 4) 合计行：发票价税合计、订单支付金额两列求和
  const dataEndRow = dataStartRow + rows.length - 1
  const totalRowNumber = dataEndRow + 1
  const invoiceAmountIndex = normalizedColumns.indexOf('invoiceTotalAmount') + 1
  const paymentAmountIndex = normalizedColumns.indexOf('paymentAmount') + 1
  const totalLabelIndex = invoiceAmountIndex > 1 ? invoiceAmountIndex - 1 : invoiceAmountIndex

  const totalRow = sheet.getRow(totalRowNumber)
  const labelCell = totalRow.getCell(totalLabelIndex)
  labelCell.value = '共计'
  labelCell.font = { name: '宋体', size: 11 }
  labelCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

  const invoiceCell = totalRow.getCell(invoiceAmountIndex)
  invoiceCell.value = { formula: `SUM(${colLetter(invoiceAmountIndex)}${dataStartRow}:${colLetter(invoiceAmountIndex)}${dataEndRow})` }
  invoiceCell.font = { name: '宋体', size: 11 }
  invoiceCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

  const paymentCell = totalRow.getCell(paymentAmountIndex)
  paymentCell.value = { formula: `SUM(${colLetter(paymentAmountIndex)}${dataStartRow}:${colLetter(paymentAmountIndex)}${dataEndRow})` }
  paymentCell.font = { name: '宋体', size: 11 }
  paymentCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

  // 5) 空三行
  sheet.addRow([])
  sheet.addRow([])
  sheet.addRow([])

  // 6) 签字行
  const signatureRow = sheet.getRow(sheet.rowCount + 1)
  signatureRow.height = 25.5
  const signatureCell = signatureRow.getCell(1)
  signatureCell.value =
    '董事长签字：                 总经理签字：                  财务总监签字：                       部门经理：                    '
  signatureCell.font = { name: '宋体', size: 20 }
  signatureCell.alignment = { horizontal: 'center', vertical: 'middle' }
  sheet.mergeCells(signatureRow.number, 1, signatureRow.number, sheet.columnCount)

  // 7) 日期行：后 7 列合并，列数不足时按规则缩减
  const dateRow = sheet.getRow(sheet.rowCount + 1)
  dateRow.height = 25.5
  const lastColumn = sheet.columnCount
  let dateStartColumn = lastColumn - 6
  if (lastColumn < 15) dateStartColumn = lastColumn - 4
  if (lastColumn < 10) dateStartColumn = lastColumn - 2
  if (lastColumn < 5) dateStartColumn = lastColumn
  if (dateStartColumn < 1) dateStartColumn = 1

  const dateCell = dateRow.getCell(dateStartColumn)
  dateCell.value = '日期：'
  dateCell.font = { name: '宋体', size: 20 }
  dateCell.alignment = { horizontal: 'left', vertical: 'middle' }
  if (lastColumn >= 5) {
    sheet.mergeCells(dateRow.number, dateStartColumn, dateRow.number, lastColumn)
  }

  sheet.pageSetup.orientation = 'portrait'
  sheet.pageSetup.paperSize = 9

  await workbook.xlsx.writeFile(filePath)
}
