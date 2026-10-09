import type { ReactNode } from 'react'

export function StatCard({
  label,
  value,
  helper,
  icon,
}: {
  label: string
  value: string | number
  helper: string
  icon: ReactNode
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
        {icon}
      </div>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
      <div className="mt-2 text-xs text-slate-400">{helper}</div>
    </div>
  )
}
