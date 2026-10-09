import { useEffect, useMemo, useState } from 'react'
import { CheckCheck, FileText, RotateCcw, X } from 'lucide-react'
import { ShellLayout } from '@/components/ShellLayout'
import { InvoiceStatusBadge, PaymentModeBadge, ReimbursementStatusBadge } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import type { OrderItemRecord, ReimbursementRecord } from '@/lib/types'
import { formatCurrency, formatDateTime, getReviewActionLabel } from '@/utils/format'

function amountStandardLabel(standard: ReimbursementRecord['amountStandard']) {
  return standard === 'invoice' ? '以发票金额为准' : standard === 'orders' ? '以订单金额为准' : '-'
}

function attachmentView(url: string, name: string, mime?: string, onOpen?: () => void) {
  const isPdf = Boolean(mime?.startsWith('application/pdf')) || name.toLowerCase().endsWith('.pdf')
  return (
    <button
      key={`${name}-${url}`}
      type="button"
      onClick={onOpen}
      className="overflow-hidden rounded-2xl"
    >
      {isPdf ? (
        <div className="flex h-28 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-600 transition hover:scale-[1.02]">
          <FileText className="h-5 w-5 shrink-0 text-rose-500" />
          <span className="truncate">{name}</span>
        </div>
      ) : (
        <img src={url} alt={name} className="h-28 w-full rounded-2xl object-cover transition hover:scale-[1.02]" />
      )}
    </button>
  )
}

function OrderCard({ order, onOpenAttachment }: { order: OrderItemRecord; onOpenAttachment: (url: string, name: string, mime?: string) => void }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-medium text-slate-900">
          子订单 {order.sequence} {order.isParentOrder ? '（母单）' : '（子单）'}
        </div>
        <PaymentModeBadge mode={order.paymentMode} />
      </div>

      {/* 备注放在每个审批单详细信息的 UI 组靠前位置 */}
      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
        <div className="text-xs font-semibold text-amber-800">订单备注</div>
        <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{order.note || '（无）'}</div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="text-sm"><span className="text-slate-500">平台分类：</span>{order.platformCategory || '-'}</div>
        <div className="text-sm"><span className="text-slate-500">平台：</span>{order.platformName || '-'}</div>
        <div className="text-sm"><span className="text-slate-500">商家名称：</span>{order.merchantName || '-'}</div>
        <div className="text-sm"><span className="text-slate-500">商品信息：</span>{order.itemDescription || '-'}</div>
        <div className="text-sm"><span className="text-slate-500">订单号：</span>{order.orderNumber || '-'}</div>
        <div className="text-sm"><span className="text-slate-500">支付时间：</span>{order.paymentTime || '-'}</div>
        <div className="text-sm"><span className="text-slate-500">支付金额：</span>{formatCurrency(order.paymentAmount)}</div>
        <div className="text-sm"><span className="text-slate-500">订单状态：</span>{order.orderStatus || '-'}</div>
        <div className="text-sm"><span className="text-slate-500">采购人：</span>{order.purchaserName || '-'}</div>
        <div className="text-sm"><span className="text-slate-500">使用人：</span>{order.userNames.join('、') || '-'}</div>
        <div className="text-sm"><span className="text-slate-500">报销方式：</span>{order.paymentMode === 'reserve_fund' ? '该订单使用备用金' : '个人垫资需报销'}</div>
      </div>

      {order.attachments.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 text-xs text-slate-500">订单截图（{order.attachments.length} 张）</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {order.attachments.map((attachment) =>
              attachmentView(attachment.fileUrl, attachment.fileName, attachment.mimeType, () =>
                onOpenAttachment(attachment.fileUrl, attachment.fileName, attachment.mimeType),
              ),
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function ApprovalsPage() {
  const [records, setRecords] = useState<ReimbursementRecord[]>([])
  const [selected, setSelected] = useState<ReimbursementRecord | null>(null)
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [timeMode, setTimeMode] = useState<'range' | 'point'>('range')
  const [timeFrom, setTimeFrom] = useState('')
  const [timeTo, setTimeTo] = useState('')
  const [timePoint, setTimePoint] = useState('')
  const [timeDirection, setTimeDirection] = useState<'after' | 'before'>('after')
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string; mime?: string } | null>(null)

  const filteredRecords = useMemo(() => {
    const keywordLower = keyword.trim().toLowerCase()
    const pointTime = timePoint ? new Date(`${timePoint}T00:00:00`) : null
    const fromTime = timeFrom ? new Date(`${timeFrom}T00:00:00`) : null
    const toTime = timeTo ? new Date(`${timeTo}T23:59:59.999`) : null

    return records.filter((item) => {
      if (keywordLower) {
        const haystack = [
          item.title,
          item.invoiceNumber,
          item.invoiceSellerName,
          item.creator.displayName,
          ...item.orders.flatMap((order) => [order.platformName, order.merchantName, order.itemDescription, order.orderNumber, order.note]),
        ].join(' ').toLowerCase()
        if (!haystack.includes(keywordLower)) {
          return false
        }
      }

      const updatedAt = new Date(item.updatedAt)
      if (fromTime && updatedAt < fromTime) return false
      if (toTime && updatedAt > toTime) return false
      if (pointTime) {
        if (timeDirection === 'after' && updatedAt < pointTime) return false
        if (timeDirection === 'before' && updatedAt > new Date(`${timePoint}T23:59:59.999`)) return false
      }
      return true
    })
  }, [records, keyword, timeFrom, timeTo, timeMode, timePoint, timeDirection])

  useEffect(() => {
    setCheckedIds((current) => current.filter((id) => filteredRecords.some((item) => item.id === id)))
  }, [filteredRecords])

  async function load() {
    const data = await api.get<ReimbursementRecord[]>('/api/approvals')
    setRecords(data)
    setSelected((current) => data.find((item) => item.id === current?.id) ?? data[0] ?? null)
    setCheckedIds((current) => current.filter((id) => data.some((item) => item.id === id)))
  }

  async function runSingleAction(action: 'approve' | 'reject') {
    if (!selected) {
      return
    }

    if (action === 'reject' && !reason.trim()) {
      setError('驳回时请填写原因。')
      return
    }

    try {
      setSubmitting(true)
      setError('')
      setMessage('')
      await api.post(`/api/reimbursements/${selected.id}/review`, {
        action,
        reason: reason.trim(),
      })
      setReason('')
      await load()
      setMessage(action === 'approve' ? '审批通过成功，列表已刷新。' : '驳回成功，列表已刷新。')
    } catch (submitError) {
      setError((submitError as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function runBatchAction(action: 'approve' | 'reject') {
    if (!checkedIds.length) {
      setError('请先勾选需要批量处理的报销单。')
      return
    }

    if (action === 'reject' && !reason.trim()) {
      setError('批量驳回时请填写原因。')
      return
    }

    try {
      setSubmitting(true)
      setError('')
      setMessage('')
      const result = await api.post<{ processedCount: number }>('/api/approvals/batch-review', {
        ids: checkedIds,
        action,
        reason: reason.trim(),
      })
      setReason('')
      setCheckedIds([])
      await load()
      setMessage(
        action === 'approve'
          ? `批量审批通过成功，共处理 ${result.processedCount} 条。`
          : `批量驳回成功，共处理 ${result.processedCount} 条。`,
      )
    } catch (submitError) {
      setError((submitError as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <ShellLayout
      title="审批系统"
      subtitle="部门领导与管理员可以在这里查看待审报销单、阅读明细并执行通过或驳回。"
    >
      {message ? <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div> : null}
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-4">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="模糊搜索：标题、发票号、销售方、平台、商品、订单号、备注、填写人"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr]">
              <select
                value={timeMode}
                onChange={(event) => setTimeMode(event.target.value as 'range' | 'point')}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none"
              >
                <option value="range">时间段选择</option>
                <option value="point">时间节点选择</option>
              </select>
              {timeMode === 'range' ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <input type="date" value={timeFrom} onChange={(event) => setTimeFrom(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none" />
                  <div className="text-center text-sm text-slate-500">至</div>
                  <input type="date" value={timeTo} onChange={(event) => setTimeTo(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none" />
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                  <select
                    value={timeDirection}
                    onChange={(event) => setTimeDirection(event.target.value as 'after' | 'before')}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none"
                  >
                    <option value="after">之后</option>
                    <option value="before">之前</option>
                  </select>
                  <input type="date" value={timePoint} onChange={(event) => setTimePoint(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none" />
                </div>
              )}
            </div>
            <div className="mt-2 text-xs text-slate-500">时间段按报销单的更新时间筛选。</div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-600">已勾选 {checkedIds.length} 条待审报销单（当前筛选 {filteredRecords.length} 条）</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCheckedIds(filteredRecords.map((item) => item.id))}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                >
                  全选当前列表
                </button>
                <button
                  type="button"
                  onClick={() => setCheckedIds([])}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                >
                  清空勾选
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={submitting || checkedIds.length === 0}
                onClick={() => runBatchAction('approve')}
                className="flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckCheck className="h-4 w-4" />{submitting ? '处理中...' : '批量通过'}
              </button>
              <button
                type="button"
                disabled={submitting || checkedIds.length === 0}
                onClick={() => runBatchAction('reject')}
                className="flex items-center gap-2 rounded-2xl border border-rose-200 px-4 py-3 text-sm text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RotateCcw className="h-4 w-4" />{submitting ? '处理中...' : '批量驳回'}
              </button>
            </div>
          </div>

          {filteredRecords.length > 0 ? (
            <div className="space-y-3">
              {filteredRecords.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-3xl border bg-white p-4 transition ${selected?.id === item.id ? 'border-amber-400 ring-2 ring-amber-200' : 'border-slate-200'}`}
                >
                  <div className="flex items-start gap-3">
                    <label className="mt-1 flex items-center">
                      <input
                        type="checkbox"
                        checked={checkedIds.includes(item.id)}
                        onChange={(event) => {
                          setCheckedIds((current) =>
                            event.target.checked
                              ? [...current, item.id]
                              : current.filter((id) => id !== item.id),
                          )
                        }}
                      />
                    </label>
                    <button type="button" onClick={() => setSelected(item)} className="flex-1 text-left">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-slate-900">{item.title || item.invoiceNumber || '未命名报销单'}</div>
                        <ReimbursementStatusBadge status={item.status} />
                      </div>
                      <div className="mt-2 text-xs text-slate-500">{item.creator.displayName} · {item.orders.length} 个子订单 · {formatCurrency(item.invoiceTotalAmount)}</div>
                      {item.orders.some((order) => order.note) ? (
                        <div className="mt-2 line-clamp-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          备注：{item.orders.filter((order) => order.note).map((order) => order.note).join('；')}
                        </div>
                      ) : null}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
              当前没有符合筛选条件的待审报销单。
            </div>
          )}
        </section>

        {selected ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-center gap-3">
              <ReimbursementStatusBadge status={selected.status} />
              <InvoiceStatusBadge status={selected.invoiceStatus} />
            </div>
            <h2 className="mt-4 font-[CrimsonPro] text-3xl text-slate-950">{selected.title || '未命名报销单'}</h2>
            <div className="mt-2 text-sm text-slate-500">
              填写人：{selected.creator.displayName} · 创建时间：{formatDateTime(selected.createdAt)} · 更新时间：{formatDateTime(selected.updatedAt)}
              {selected.category ? <> · 分类：{selected.category.name}</> : null}
            </div>

            {/* 发票主信息 */}
            <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-medium text-slate-900">发票主信息</div>
                <InvoiceStatusBadge status={selected.invoiceStatus} />
              </div>

              {/* 备注类信息放发票组靠前 */}
              {selected.amountMismatchNote ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
                  <div className="text-xs font-semibold text-amber-800">金额差异说明</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{selected.amountMismatchNote}</div>
                </div>
              ) : null}
              {selected.rejectionReason ? (
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3">
                  <div className="text-xs font-semibold text-rose-800">驳回原因</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{selected.rejectionReason}</div>
                </div>
              ) : null}

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="text-sm"><span className="text-slate-500">发票号码：</span>{selected.invoiceNumber || '-'}</div>
                <div className="text-sm"><span className="text-slate-500">销售方名称：</span>{selected.invoiceSellerName || '-'}</div>
                <div className="text-sm"><span className="text-slate-500">销售方税号：</span>{selected.invoiceSellerTaxNo || '-'}</div>
                <div className="text-sm"><span className="text-slate-500">金额合计（不含税）：</span>{formatCurrency(selected.invoiceAmountExcludingTax)}</div>
                <div className="text-sm"><span className="text-slate-500">税额合计：</span>{formatCurrency(selected.invoiceTaxAmount)}</div>
                <div className="text-sm"><span className="text-slate-500">税率：</span>{selected.invoiceTaxRate || '-'}</div>
                <div className="text-sm"><span className="text-slate-500">价税合计：</span>{formatCurrency(selected.invoiceTotalAmount)}</div>
                <div className="text-sm"><span className="text-slate-500">金额报销标准：</span>{amountStandardLabel(selected.amountStandard)}</div>
              </div>

              {selected.attachments.length > 0 ? (
                <div className="mt-4">
                  <div className="mb-2 text-xs text-slate-500">发票截图（{selected.attachments.length} 张）</div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {selected.attachments.map((attachment) =>
                      attachmentView(attachment.fileUrl, attachment.fileName, attachment.mimeType, () =>
                        setPreviewImage({ src: attachment.fileUrl, name: attachment.fileName, mime: attachment.mimeType }),
                      ),
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {/* 子订单 */}
            <div className="mt-6 space-y-4">
              {selected.orders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onOpenAttachment={(url, name, mime) => setPreviewImage({ src: url, name, mime })}
                />
              ))}
            </div>

            {/* 审核记录 */}
            {selected.reviewLogs.length > 0 ? (
              <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <div className="font-medium text-slate-900">审核记录</div>
                <div className="mt-3 space-y-2">
                  {selected.reviewLogs.map((log) => (
                    <div key={log.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <span>{getReviewActionLabel(log.action)} · {log.operatorName}</span>
                        <span>{formatDateTime(log.createdAt)}</span>
                      </div>
                      {log.reason ? <div className="mt-1 text-slate-700">{log.reason}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="驳回时请填写原因" rows={4} className="mt-6 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none" />

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => runSingleAction('approve')}
                className="flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckCheck className="h-4 w-4" />{submitting ? '处理中...' : '审批通过'}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => runSingleAction('reject')}
                className="flex items-center gap-2 rounded-2xl border border-rose-200 px-4 py-3 text-sm text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RotateCcw className="h-4 w-4" />{submitting ? '处理中...' : '审批驳回'}
              </button>
            </div>
          </section>
        ) : (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            当前没有可查看的审批详情。
          </section>
        )}
      </div>

      {previewImage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-6">
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute right-6 top-6 rounded-full border border-white/20 bg-white/10 p-2 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {previewImage.mime?.startsWith('application/pdf') ? (
            <iframe src={previewImage.src} title={previewImage.name} className="h-[85vh] w-[85vw] rounded-3xl bg-white" />
          ) : (
            <img src={previewImage.src} alt={previewImage.name} className="max-h-[88vh] max-w-[88vw] rounded-3xl object-contain" />
          )}
        </div>
      ) : null}
    </ShellLayout>
  )
}
