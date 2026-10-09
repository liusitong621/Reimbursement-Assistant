import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LockKeyhole, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, login, loginPending } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true })
    }
  }, [navigate, user])

  return (
    <div className="min-h-screen overflow-hidden bg-[#0b1220] px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col items-center justify-center">
        <section className="w-full max-w-3xl text-center">
          <h1 className="font-[CrimsonPro] text-5xl leading-tight text-white">
            报销信息整理识别系统
          </h1>
          <p className="mt-5 text-sm leading-7 text-slate-300">
            支持员工报销提交、同发票多子单、部门领导审批、财务核销、备用金管理和按订单行导出。
          </p>
        </section>

        <section className="mt-12 w-full max-w-xl rounded-[2rem] border border-white/10 bg-white px-8 py-9 text-slate-900 shadow-[0_30px_100px_rgba(15,23,42,0.35)]">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h2 className="mt-5 font-[CrimsonPro] text-4xl text-slate-950">账号密码登录</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">请输入已分配的账号和密码进入系统。</p>

          <form
            className="mt-8 space-y-4"
            onSubmit={async (event) => {
              event.preventDefault()
              setError('')
              try {
                await login(username, password)
                const rawFrom = (location.state as { from?: string } | null)?.from
                // 3.2: basename='/FP' 时 React Router v7 在 bare '/FP' 上不做 strip
                // 落到非法 from 时强制走 /dashboard，避免白屏
                const from =
                  rawFrom && rawFrom !== '/' && rawFrom !== '/FP' && rawFrom !== '/FP/' && !rawFrom.startsWith('/FP/')
                    ? rawFrom
                    : '/dashboard'
                navigate(from, { replace: true })
              } catch (submitError) {
                setError((submitError as Error).message)
              }
            }}
          >
            <label className="block">
              <div className="mb-2 text-sm font-medium text-slate-700">账号</div>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-amber-400 focus:bg-white"
              />
            </label>
            <label className="block">
              <div className="mb-2 text-sm font-medium text-slate-700">密码</div>
              <div className="relative">
                <LockKeyhole className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-amber-400 focus:bg-white"
                />
              </div>
            </label>

            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div> : null}

            <button
              type="submit"
              disabled={loginPending}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {loginPending ? '正在登录...' : '进入系统'}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
