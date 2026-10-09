import { useEffect, useState } from 'react'
import { UserCog, KeyRound, CheckCircle2, PlugZap, Copy, Ban, BookOpen } from 'lucide-react'
import { ShellLayout } from '@/components/ShellLayout'
import { useAuthStore } from '@/store/authStore'
import { getRoleLabel } from '@/utils/format'
import { api } from '@/lib/api'

type ApiKeyItem = {
  id: string
  name: string
  prefix: string
  rateLimitPerMin: number
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

function ApiAccessCard() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([])
  const [name, setName] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  async function loadKeys() {
    try {
      setKeys(await api.get<ApiKeyItem[]>('/api/api-keys'))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadKeys()
  }, [])

  async function handleCreate() {
    setError('')
    if (!name.trim()) {
      setError('请填写 Key 的用途名称。')
      return
    }
    setCreating(true)
    try {
      const data = await api.post<{ apiKey: string }>('/api/api-keys', {
        name: name.trim(),
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
      })
      setNewKey(data.apiKey)
      setCopied(false)
      setName('')
      setExpiresInDays('')
      await loadKeys()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm('确定吊销这个 Key 吗？吊销后使用该 Key 的程序将立即无法访问系统。')) return
    setError('')
    try {
      await api.delete(`/api/api-keys/${id}`)
      await loadKeys()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(newKey)
      setCopied(true)
    } catch {
      window.prompt('请手动复制：', newKey)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-2">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <PlugZap className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">API 接入（Agent / 程序调用）</h2>
          <p className="text-xs text-slate-500">
            Key 的权限与你当前账号完全相等；调用会限速（每分钟 120 次）并记录审计日志
          </p>
        </div>
        <a
          href="/api/openapi"
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
        >
          <BookOpen className="h-3.5 w-3.5" />
          接口文档
        </a>
      </div>

      {newKey ? (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-800">新 Key 已创建（明文只显示这一次，请立即复制保存）</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 text-xs text-slate-800">{newKey}</code>
            <button
              type="button"
              onClick={handleCopy}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-800"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? '已复制' : '复制'}
            </button>
            <button
              type="button"
              onClick={() => setNewKey('')}
              className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 transition hover:border-slate-300"
            >
              我已保存
            </button>
          </div>
          <div className="mt-2 text-xs text-amber-700">
            调用方式：请求头 <code className="rounded bg-white px-1.5 py-0.5">Authorization: Bearer {'<Key>'}</code> 或{' '}
            <code className="rounded bg-white px-1.5 py-0.5">X-API-Key: {'<Key>'}</code>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-48 flex-1">
          <div className="mb-1.5 text-sm font-medium text-slate-700">用途名称</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            placeholder="例如：Codex 接入、定时脚本"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:bg-white"
          />
        </label>
        <label className="w-40">
          <div className="mb-1.5 text-sm font-medium text-slate-700">有效期（天，可空）</div>
          <input
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value.replace(/\D/g, ''))}
            placeholder="永久"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:bg-white"
          />
        </label>
        <button
          type="button"
          disabled={creating}
          onClick={handleCreate}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
        >
          {creating ? '创建中...' : '创建 Key'}
        </button>
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="py-4 text-center text-sm text-slate-400">加载中...</div>
        ) : keys.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-400">还没有创建过 Key</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2 pr-4 font-medium">用途</th>
                  <th className="py-2 pr-4 font-medium">Key 前缀</th>
                  <th className="py-2 pr-4 font-medium">创建时间</th>
                  <th className="py-2 pr-4 font-medium">最后使用</th>
                  <th className="py-2 pr-4 font-medium">状态</th>
                  <th className="py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100">
                    <td className="py-2.5 pr-4 font-medium text-slate-800">{item.name}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-slate-500">{item.prefix}…</td>
                    <td className="py-2.5 pr-4 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-xs text-slate-500">
                      {item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString() : '从未使用'}
                    </td>
                    <td className="py-2.5 pr-4">
                      {item.revokedAt ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">已吊销</span>
                      ) : item.expiresAt && new Date(item.expiresAt).getTime() < Date.now() ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">已过期</span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">有效</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      {!item.revokedAt ? (
                        <button
                          type="button"
                          onClick={() => handleRevoke(item.id)}
                          className="flex items-center gap-1 text-xs font-medium text-rose-600 transition hover:text-rose-500"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          吊销
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error ? <div className="mt-3 text-sm text-rose-600">{error}</div> : null}
    </section>
  )
}

export default function ProfilePage() {
  const { user, updateProfile } = useAuthStore()
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSaveName() {
    setError('')
    setSuccess('')
    if (!displayName.trim()) {
      setError('显示名称不能为空。')
      return
    }
    setSaving(true)
    try {
      await updateProfile({ displayName: displayName.trim() })
      setSuccess('显示名称已更新。')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePassword() {
    setError('')
    setSuccess('')
    if (!currentPassword) {
      setError('请输入当前密码。')
      return
    }
    if (newPassword.length < 4) {
      setError('新密码至少 4 个字符。')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致。')
      return
    }
    setSaving(true)
    try {
      await updateProfile({ currentPassword, newPassword })
      setSuccess('密码已更新。')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ShellLayout title="个人设置" subtitle="修改显示名称和登录密码。">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <UserCog className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">显示名称</h2>
              <p className="text-xs text-slate-500">修改后在系统各处展示的名称</p>
            </div>
          </div>

          <label className="block">
            <div className="mb-1.5 text-sm font-medium text-slate-700">账号</div>
            <input
              value={user?.username ?? ''}
              disabled
              className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm text-slate-500"
            />
          </label>

          <label className="mt-4 block">
            <div className="mb-1.5 text-sm font-medium text-slate-700">角色</div>
            <input
              value={user ? getRoleLabel(user.role) : ''}
              disabled
              className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm text-slate-500"
            />
          </label>

          <label className="mt-4 block">
            <div className="mb-1.5 text-sm font-medium text-slate-700">显示名称</div>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={30}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-amber-400 focus:bg-white"
            />
          </label>

          <button
            type="button"
            disabled={saving}
            onClick={handleSaveName}
            className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? '保存中...' : '保存显示名称'}
          </button>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">修改密码</h2>
              <p className="text-xs text-slate-500">修改后需使用新密码登录</p>
            </div>
          </div>

          <label className="block">
            <div className="mb-1.5 text-sm font-medium text-slate-700">当前密码</div>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-amber-400 focus:bg-white"
            />
          </label>

          <label className="mt-4 block">
            <div className="mb-1.5 text-sm font-medium text-slate-700">新密码</div>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-amber-400 focus:bg-white"
            />
          </label>

          <label className="mt-4 block">
            <div className="mb-1.5 text-sm font-medium text-slate-700">确认新密码</div>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-amber-400 focus:bg-white"
            />
          </label>

          <button
            type="button"
            disabled={saving}
            onClick={handleSavePassword}
            className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? '保存中...' : '保存新密码'}
          </button>
        </section>
      </div>

      <ApiAccessCard />

      {error ? (
        <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div>
      ) : null}
      {success ? (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {success}
        </div>
      ) : null}
    </ShellLayout>
  )
}
