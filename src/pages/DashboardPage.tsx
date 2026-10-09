import { useEffect, useState } from 'react'
import { Activity, Banknote, FileCheck2, Files, PencilLine, Wallet } from 'lucide-react'
import { ShellLayout } from '@/components/ShellLayout'
import { ReimbursementStatusBadge } from '@/components/StatusBadge'
import { StatCard } from '@/components/StatCard'
import { api } from '@/lib/api'
import type { DashboardData } from '@/lib/types'
import { useAuthStore } from '@/store/authStore'
import { fallbackDisplayText } from '@/utils/display'
import { formatCurrency, formatDateTime, getReviewActionLabel } from '@/utils/format'

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [noticeAcknowledged, setNoticeAcknowledged] = useState(false)
  const user = useAuthStore((state) => state.user)
  const loadSession = useAuthStore((state) => state.loadSession)

  useEffect(() => {
    api.get<DashboardData>('/api/dashboard').then(setData)
  }, [])

  const isFinance = user?.role === 'finance'
  const notice = isFinance || noticeAcknowledged ? '' : data?.reserveFund.notice
  const dashboardSubtitle = isFinance
    ? '财务工作台聚焦已办结与已报销记录，方便集中核销与回看处理情况。'
    : '根据新蓝图重构后的首页同时服务员工、部门领导、财务和管理员，突出状态流转、最近操作和备用金信息。'
  const statCards = isFinance
    ? [
        { label: '全部记录', value: data?.stats.all ?? 0, helper: '仅统计已办结与已报销', icon: <Activity className="h-5 w-5" /> },
        { label: '已办结', value: data?.stats.completed ?? 0, helper: '等待财务核销', icon: <Wallet className="h-5 w-5" /> },
        { label: '已报销', value: data?.stats.reimbursed ?? 0, helper: '财务已核销', icon: <Banknote className="h-5 w-5" /> },
      ]
    : [
        { label: '全部记录', value: data?.stats.all ?? 0, helper: '当前角色可见', icon: <Activity className="h-5 w-5" /> },
        { label: '草稿', value: data?.stats.draft ?? 0, helper: '仍可继续编辑', icon: <PencilLine className="h-5 w-5" /> },
        { label: '未完结', value: data?.stats.unfinished ?? 0, helper: '已提交待送审', icon: <Files className="h-5 w-5" /> },
        { label: '待审核', value: data?.stats.pending_review ?? 0, helper: '等待领导处理', icon: <FileCheck2 className="h-5 w-5" /> },
        { label: '已办结', value: data?.stats.completed ?? 0, helper: '审批已通过', icon: <Wallet className="h-5 w-5" /> },
        { label: '已报销', value: data?.stats.reimbursed ?? 0, helper: '财务已核销', icon: <Banknote className="h-5 w-5" /> },
      ]

  return (
    <ShellLayout
      title="角色工作台"
      subtitle={dashboardSubtitle}
    >
      {notice ? (
        <div className="mb-6 rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          <div className="font-medium">备用金提醒</div>
          <div className="mt-1">{notice}</div>
          <button
            type="button"
            onClick={async () => {
              await api.post('/api/auth/acknowledge-reserve-notice')
              setNoticeAcknowledged(true)
              await loadSession()
            }}
            className="mt-3 rounded-xl bg-amber-500 px-3 py-2 text-xs font-medium text-white"
          >
            我知道了
          </button>
        </div>
      ) : null}

      <div className={`grid gap-4 md:grid-cols-2 ${isFinance ? 'xl:grid-cols-3' : 'xl:grid-cols-6'}`}>
        {statCards.map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} helper={card.helper} icon={card.icon} />
        ))}
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-[CrimsonPro] text-2xl text-slate-950">最近编辑</h2>
            <div className="text-xs text-slate-400">最近 5 条</div>
          </div>
          <div className="space-y-3">
            {(data?.recentEdited ?? []).length ? (
              (data?.recentEdited ?? []).map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900">{fallbackDisplayText(item.title, item.invoiceNumber || '未命名报销单')}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {fallbackDisplayText(item.platformName, item.invoiceNumber || '未填写平台')} · {formatCurrency(item.paymentAmount)}
                      </div>
                    </div>
                    <ReimbursementStatusBadge status={item.status} />
                  </div>
                  <div className="mt-2 text-xs text-slate-400">{formatDateTime(item.updatedAt)}</div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                还没有最近编辑记录。
              </div>
            )}
          </div>
        </section>

        <section className="space-y-6">
          {!isFinance ? (
            <div className="rounded-3xl border border-slate-200 bg-[#111827] p-6 text-slate-100">
              <div className="text-xs uppercase tracking-[0.3em] text-amber-300">备用金概览</div>
              <div className="mt-4 text-4xl font-semibold">{formatCurrency(data?.reserveFund.balance ?? 0)}</div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm text-slate-300">
                <div>已使用：{formatCurrency(data?.reserveFund.usedTotal ?? 0)}</div>
                <div>近一年：{formatCurrency(data?.reserveFund.year ?? 0)}</div>
                <div>近半年：{formatCurrency(data?.reserveFund.halfYear ?? 0)}</div>
                <div>近三月：{formatCurrency(data?.reserveFund.threeMonths ?? 0)}</div>
                <div>近一月：{formatCurrency(data?.reserveFund.month ?? 0)}</div>
                <div>近一周：{formatCurrency(data?.reserveFund.week ?? 0)}</div>
              </div>
            </div>
          ) : null}

          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <h2 className="font-[CrimsonPro] text-2xl text-slate-950">审核信息</h2>
            <div className="mt-4 space-y-3">
              {(data?.recentReviewed ?? []).length ? (
                (data?.recentReviewed ?? []).map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <div className="font-medium text-slate-900">{fallbackDisplayText(item.title, '未命名报销单')}</div>
                    <div className="mt-1 text-slate-500">{item.operatorName} · {getReviewActionLabel(item.action)}</div>
                    <div className="mt-1 text-xs text-slate-400">{formatDateTime(item.createdAt)}</div>
                    {item.reason ? <div className="mt-2 text-xs text-rose-500">原因：{fallbackDisplayText(item.reason, '未填写')}</div> : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  还没有审核记录。
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </ShellLayout>
  )
}
