import type { InvoiceStatus, PaymentMode, ReimbursementStatus, Role } from '@/lib/types'

const reimbursementStatusLabels: Record<ReimbursementStatus, string> = {
  draft: '草稿',
  unfinished: '未完结报销',
  pending_review: '待审核',
  needs_revision: '待修改',
  completed: '已办结',
  reimbursed: '已报销',
}

const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  none: '无发票',
  not_issued: '未开票',
  waiting_issued: '等待开票中',
  issued: '已开票',
}

const paymentModeLabels: Record<PaymentMode, string> = {
  personal_reimbursement: '个人垫资需报销',
  reserve_fund: '该订单使用备用金',
}

const roleLabels: Record<Role, string> = {
  employee: '员工',
  leader: '部门领导',
  finance: '财务',
  admin: '管理员',
}

const reviewActionLabels: Record<string, string> = {
  create: '创建报销单',
  update: '更新报销单',
  submit: '提交为未完结',
  submit_for_review: '送审',
  approve: '审批通过',
  reject: '驳回',
  withdraw: '撤回送审',
  mark_reimbursed: '标记为已报销',
  undo_reimburse: '退回为已办结',
  status_change: '状态变更',
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(value || 0)
}

export function formatDateTime(value: string) {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function getReimbursementStatusLabel(status: ReimbursementStatus) {
  return reimbursementStatusLabels[status]
}

export function getInvoiceStatusLabel(status: InvoiceStatus) {
  return invoiceStatusLabels[status]
}

export function getPaymentModeLabel(mode: PaymentMode) {
  return paymentModeLabels[mode]
}

export function getRoleLabel(role: Role) {
  return roleLabels[role]
}

export function getReviewActionLabel(action: string) {
  return reviewActionLabels[action] ?? action
}
