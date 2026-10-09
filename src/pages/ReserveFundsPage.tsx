import { useCallback, useEffect, useState } from 'react'
import { Banknote } from 'lucide-react'
import { ShellLayout } from '@/components/ShellLayout'
import { api } from '@/lib/api'
import type { ReserveFundUser } from '@/lib/types'
import { formatCurrency, formatDateTime, getRoleLabel } from '@/utils/format'
import { sanitizeAmountInput } from '@/lib/utils'

export default function ReserveFundsPage() {
  const [users, setUsers] = useState<ReserveFundUser[]>([])
  const [form, setForm] = useState({ targetUserId: '', deltaAmount: '', note: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    const data = await api.get<ReserveFundUser[]>('/api/reserve-funds')
    setUsers(data)
    if (!form.targetUserId && data[0]) {
      const preferredTarget = data.find((user) => user.role === 'employee') ?? data[0]
      setForm((current) => ({ ...current, targetUserId: preferredTarget.id }))
    }
  }, [form.targetUserId])

  useEffect(() => {
    load()
  }, [load])

  return (
    <ShellLayout
      title="备用金子系统"
      subtitle="部门领导和管理员可以查看员工备用金余额、最近变动，并执行增加或减少金额的操作。"
    >
      <div className="grid gap-6 xl:grid-cols-[0.86fr_1.14fr]">
        <section className="rounded-3xl border border-slate-200 bg-[#111827] p-6 text-white">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10"><Banknote className="h-5 w-5" /></div>
          <h2 className="mt-5 font-[CrimsonPro] text-3xl">调整备用金</h2>
          <div className="mt-6 space-y-4">
            <select value={form.targetUserId} onChange={(event) => setForm((current) => ({ ...current, targetUserId: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none">
              {users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
            </select>
            <input value={form.deltaAmount} onChange={(event) => setForm((current) => ({ ...current, deltaAmount: sanitizeAmountInput(event.target.value) }))} placeholder="调整金额，例如 500 或 -100" className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none" />
            <textarea rows={4} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="调整说明" className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none" />
            <button
              type="button"
              disabled={submitting}
              onClick={async () => {
                try {
                  setSubmitting(true)
                  setError('')
                  setMessage('')
                  const targetUser = users.find((user) => user.id === form.targetUserId)
                  const result = await api.post<{ id: string; reserveFundBalance: number }>('/api/reserve-funds/adjust', {
                    targetUserId: form.targetUserId,
                    deltaAmount: Number(form.deltaAmount),
                    note: form.note,
                  })
                  setForm((current) => ({ ...current, deltaAmount: '', note: '' }))
                  await load()
                  setMessage(`${targetUser?.displayName ?? '目标用户'} 的备用金已调整为 ${formatCurrency(result.reserveFundBalance)}。`)
                } catch (submitError) {
                  setError((submitError as Error).message)
                } finally {
                  setSubmitting(false)
                }
              }}
              className="w-full rounded-2xl bg-amber-400 px-4 py-3 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? '正在调整...' : '执行调整'}
            </button>
            {message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}
            {error ? <div className="rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
          </div>
        </section>

        <section className="space-y-4">
          {users.map((user) => (
            <div key={user.id} className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-slate-900">{user.displayName}</div>
                  <div className="mt-1 text-xs text-slate-500">{user.username} · {getRoleLabel(user.role)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-slate-500">当前余额</div>
                  <div className="text-xl font-semibold text-slate-950">{formatCurrency(user.reserveFundBalance)}</div>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {user.logs.map((log) => (
                  <div key={log.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <div className="font-medium text-slate-900">{log.deltaAmount > 0 ? '+' : ''}{formatCurrency(log.deltaAmount)}</div>
                    <div className="mt-1 text-slate-500">{log.note} · {log.operatorName}</div>
                    <div className="mt-1 text-xs text-slate-400">{formatDateTime(log.createdAt)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </ShellLayout>
  )
}
