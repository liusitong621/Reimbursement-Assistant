import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { Banknote, Bell, CircleUserRound, FileCheck2, FileSpreadsheet, Files, LayoutDashboard, LogOut, Settings2, Shield, Tag, UserCog } from "lucide-react"
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { ReimbursementStatusBadge } from '@/components/StatusBadge'
import { useAuthStore } from '@/store/authStore'
import { formatDateTime, getRoleLabel } from '@/utils/format'
import type { ReimbursementStatus } from '@/lib/types'

type NotificationItem = {
  id: string
  title: string
  status: ReimbursementStatus
  updatedAt: string
  creatorName: string
}

export function ShellLayout({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const showReserveFundInfo = user?.role !== 'finance'
  const [notificationCount, setNotificationCount] = useState(0)
  const [notificationItems, setNotificationItems] = useState<NotificationItem[]>([])
  const [showNotifications, setShowNotifications] = useState(false)

  // 3.6：待处理提醒轮询：被驳回/待审核/已办结待核销等需要处理的报销单。
  useEffect(() => {
    let active = true

    async function refreshNotifications() {
      try {
        const data = await api.get<{ count: number; items: NotificationItem[] }>('/api/dashboard/notifications')
        if (!active) {
          return
        }
        setNotificationCount(data.count)
        setNotificationItems(data.items)
      } catch {
        // 轮询失败时保持原状态，不打扰用户
      }
    }

    void refreshNotifications()
    const timer = window.setInterval(refreshNotifications, 15000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  function handleNotificationClick(item: NotificationItem) {
    setShowNotifications(false)
    if (item.status === 'pending_review') {
      navigate('/approvals')
      return
    }
    navigate(item.status === 'completed' ? '/records?status=completed' : '/records?status=needs_revision')
  }

  const navItems = [
    { to: '/dashboard', label: '工作台', icon: LayoutDashboard, visible: true },
    { to: '/reimbursements/new', label: '新建报销', icon: Files, visible: user?.role !== 'finance' },
    { to: '/records', label: '查看与导出', icon: FileSpreadsheet, visible: true },
    { to: '/approvals', label: '审批系统', icon: FileCheck2, visible: user?.role === 'leader' || user?.role === 'admin' },
    { to: '/reserve-funds', label: '备用金', icon: Banknote, visible: user?.role === 'leader' || user?.role === 'admin' },
    { to: '/admin/users', label: '系统管理', icon: Settings2, visible: user?.role === 'admin' },
    { to: '/admin/categories', label: '报销分类', icon: Tag, visible: user?.role === 'leader' || user?.role === 'admin' },
    { to: '/admin/overview', label: '全局总览', icon: Shield, visible: user?.role === 'admin' },
    { to: '/profile', label: '个人设置', icon: UserCog, visible: true },
  ].filter((item) => item.visible)

  return (
    <div className="min-h-screen bg-[#f2f4f8] text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-[1680px] grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-[#0f172a] px-6 py-8 text-slate-100 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-8">
          <Link to="/dashboard" className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="h-12 w-12 shrink-0 rounded-2xl border border-white/15 bg-white/10 p-1 object-contain" />
            <span className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-[0.36em] text-amber-300">Expense Ledger</div>
              <div className="mt-2 font-[CrimsonPro] text-2xl leading-snug tracking-tight">报销信息整理识别系统</div>
            </span>
          </Link>

          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowNotifications((current) => !current)}
                className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
                title="待处理提醒"
              >
                <Bell className="h-4 w-4" />
                {notificationCount > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {notificationCount > 99 ? '99+' : notificationCount}
                  </span>
                ) : null}
              </button>
              {showNotifications ? (
                <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border border-white/10 bg-slate-900 p-3 shadow-2xl">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">待处理提醒</div>
                  {notificationItems.length === 0 ? (
                    <div className="mt-3 text-xs text-slate-400">暂无需要处理的报销单。</div>
                  ) : (
                    <div className="mt-2 max-h-80 space-y-1 overflow-y-auto">
                      {notificationItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleNotificationClick(item)}
                          className="block w-full rounded-xl px-3 py-2 text-left transition hover:bg-white/10"
                        >
                          <div className="truncate text-xs text-slate-200">{item.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                            <ReimbursementStatusBadge status={item.status} />
                            <span>{item.creatorName}</span>
                            <span>{formatDateTime(item.updatedAt)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                <CircleUserRound className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium">{user?.displayName ?? '-'}</div>
                <div className="text-xs text-slate-400">
                  {user?.username ?? '-'} · {user ? getRoleLabel(user.role) : '-'}
                </div>
              </div>
            </div>
            {showReserveFundInfo ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                当前备用金：{user?.reserveFundBalance?.toFixed(2) ?? '0.00'} 元
              </div>
            ) : null}
          </div>
          </div>

          <div className="mt-8 space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition hover:bg-white/10',
                      isActive ? 'bg-white/10 text-white shadow-lg' : 'text-slate-300',
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              )
            })}
          </div>

          <button
            type="button"
            onClick={async () => {
              await logout()
              navigate('/login')
            }}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </aside>

        <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
          <div className="min-w-0 rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)]">
            <div className="mb-8 flex flex-col gap-3 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-slate-500">角色工作区</div>
                <h1 className="mt-3 font-[CrimsonPro] text-4xl leading-none text-slate-950">{title}</h1>
                <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-500">{subtitle}</p>
              </div>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
