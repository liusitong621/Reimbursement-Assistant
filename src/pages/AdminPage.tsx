import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, ShieldPlus, Tag, Trash2, X } from 'lucide-react'
import { ShellLayout } from '@/components/ShellLayout'
import { api } from '@/lib/api'
import { categoriesApi, type CategoryDeleteResult } from '@/lib/categories'
import { useAuthStore } from '@/store/authStore'
import type { AdminOverview, Category, Role, UserOption } from '@/lib/types'
import { fallbackDisplayText } from '@/utils/display'
import { formatCurrency, formatDateTime, getRoleLabel } from '@/utils/format'

export default function AdminPage({ mode }: { mode: 'users' | 'overview' | 'categories' }) {
  const [users, setUsers] = useState<UserOption[]>([])
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [form, setForm] = useState({ username: '', displayName: '', role: 'employee' as Role })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingForm, setEditingForm] = useState({ username: '', displayName: '', role: 'employee' as Role })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [editingCategoryForm, setEditingCategoryForm] = useState({ name: '', description: '' })
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null)
  const [transferTargetId, setTransferTargetId] = useState<string>('')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [newCategoryForm, setNewCategoryForm] = useState({ name: '', description: '' })
  const { user } = useAuthStore()
  const canManageCategories = user?.role === 'admin'

  const load = useCallback(async () => {
    setMessage('')
    setError('')
    if (mode === 'users') {
      setUsers(await api.get<UserOption[]>('/api/admin/users'))
      return
    }
    if (mode === 'categories') {
      setCategories(await categoriesApi.list())
      return
    }
    setOverview(await api.get<AdminOverview>('/api/admin/overview'))
  }, [mode])

  useEffect(() => {
    load()
  }, [load])

  return (
    <ShellLayout
      title={mode === 'users' ? '系统管理' : mode === 'categories' ? '报销分类管理' : '管理员全局总览'}
      subtitle={mode === 'users' ? '管理员可维护用户、账号、角色和密码。' : mode === 'categories' ? '管理员和部门负责人可查看分类及总金额；部门负责人可新建分类，管理员可编辑/删除。默认类型不可删除。' : '管理员可以查看所有账号的余额和最近报销状态。'}
    >
      {mode === 'categories' ? (
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-[#111827] p-6 text-white">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10"><Tag className="h-5 w-5" /></div>
            <h2 className="mt-5 font-[CrimsonPro] text-3xl">新建报销分类</h2>
            <p className="mt-2 text-sm text-white/70">员工、部门领导、管理员可创建分类；财务仅查看。分类名需全局唯一。</p>
            <div className="mt-6 space-y-4">
              <input
                value={newCategoryForm.name}
                onChange={(event) => setNewCategoryForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="分类名称（如：办公用品采购）"
                maxLength={30}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none"
              />
              <textarea
                value={newCategoryForm.description}
                onChange={(event) => setNewCategoryForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="描述（选填）"
                rows={2}
                maxLength={200}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none"
              />
              <button
                type="button"
                disabled={creatingCategory || !newCategoryForm.name.trim()}
                onClick={async () => {
                  try {
                    setCreatingCategory(true)
                    setError('')
                    await categoriesApi.create({
                      name: newCategoryForm.name.trim(),
                      description: newCategoryForm.description.trim() || undefined,
                    })
                    setNewCategoryForm({ name: '', description: '' })
                    await load()
                    setMessage('分类已创建。')
                  } catch (submitError) {
                    setError((submitError as Error).message)
                  } finally {
                    setCreatingCategory(false)
                  }
                }}
                className="w-full rounded-2xl bg-amber-400 px-4 py-3 text-sm font-medium text-slate-950 disabled:bg-slate-500 disabled:text-slate-300"
              >
                {creatingCategory ? '创建中…' : '创建分类'}
              </button>
            </div>
          </section>
          <section className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">分类名称</th>
                  <th className="px-4 py-3 font-medium">描述</th>
                  <th className="px-4 py-3 font-medium">排序</th>
                  <th className="px-4 py-3 font-medium">报销单数</th>
                  <th className="px-4 py-3 font-medium">该类目总金额</th>
                  <th className="px-4 py-3 font-medium">创建人</th>
                  {canManageCategories ? <th className="px-4 py-3 font-medium">操作</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{category.name}</span>
                        {category.isDefault ? (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">系统默认</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{category.description || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{category.sortOrder}</td>
                    <td className="px-4 py-3 text-slate-600">{category.reimbursementCount}</td>
                    <td className="px-4 py-3 text-slate-600">{formatCurrency(category.totalAmount)}</td>
                    <td className="px-4 py-3 text-slate-600">{category.createdByName || '-'}</td>
                    {canManageCategories ? (
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={category.isDefault}
                            onClick={() => {
                              setEditingCategory(category)
                              setEditingCategoryForm({ name: category.name, description: category.description })
                            }}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Pencil className="h-3.5 w-3.5" />编辑
                          </button>
                          <button
                            type="button"
                            disabled={category.isDefault}
                            onClick={() => {
                              setDeletingCategory(category)
                              const firstOther = categories.find((c) => c.id !== category.id)
                              setTransferTargetId(firstOther ? firstOther.id : '')
                            }}
                            className="inline-flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-2 text-xs text-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />删除
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
                {categories.length === 0 ? (
                  <tr><td colSpan={canManageCategories ? 7 : 6} className="px-4 py-8 text-center text-slate-400">暂无可用分类</td></tr>
                ) : null}
              </tbody>
            </table>
          </section>
        </div>
      ) : mode === 'users' ? (
        <div className="grid gap-6 xl:grid-cols-[0.86fr_1.14fr]">
          <section className="rounded-3xl border border-slate-200 bg-[#111827] p-6 text-white">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10"><ShieldPlus className="h-5 w-5" /></div>
            <h2 className="mt-5 font-[CrimsonPro] text-3xl">新增用户</h2>
            <div className="mt-6 space-y-4">
              <input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="登录账号" className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none" />
              <input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="显示名称" className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none" />
              <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as Role }))} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none">
                <option value="employee">员工</option><option value="leader">部门领导</option><option value="finance">财务</option><option value="admin">管理员</option>
              </select>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const result = await api.post<{ defaultPassword: string }>('/api/admin/users', form)
                    setMessage(`用户已创建，默认密码：${result.defaultPassword}`)
                    setForm({ username: '', displayName: '', role: 'employee' })
                    await load()
                  } catch (submitError) {
                    setError((submitError as Error).message)
                  }
                }}
                className="w-full rounded-2xl bg-amber-400 px-4 py-3 text-sm font-medium text-slate-950"
              >
                创建用户
              </button>
            </div>
          </section>
          <section className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-4 py-3 font-medium">账号</th><th className="px-4 py-3 font-medium">名称</th><th className="px-4 py-3 font-medium">角色</th><th className="px-4 py-3 font-medium">备用金</th><th className="px-4 py-3 font-medium">操作</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-4 py-3">
                      {editingId === user.id ? (
                        <input
                          value={editingForm.username}
                          onChange={(event) => setEditingForm((current) => ({ ...current, username: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2"
                        />
                      ) : user.username}
                    </td>
                    <td className="px-4 py-3">
                      {editingId === user.id ? (
                        <input
                          value={editingForm.displayName}
                          onChange={(event) => setEditingForm((current) => ({ ...current, displayName: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2"
                        />
                      ) : user.displayName}
                    </td>
                    <td className="px-4 py-3">
                      {editingId === user.id ? (
                        <select
                          value={editingForm.role}
                          onChange={(event) => setEditingForm((current) => ({ ...current, role: event.target.value as Role }))}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2"
                        >
                          <option value="employee">员工</option>
                          <option value="leader">部门领导</option>
                          <option value="finance">财务</option>
                          <option value="admin">管理员</option>
                        </select>
                      ) : getRoleLabel(user.role)}
                    </td>
                    <td className="px-4 py-3">{formatCurrency(user.reserveFundBalance)}</td>
                    <td className="px-4 py-3 flex flex-wrap gap-2">
                      {editingId === user.id ? (
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await api.patch(`/api/admin/users/${user.id}`, editingForm)
                                setMessage(`${editingForm.displayName} 的用户信息已更新。`)
                                setEditingId(null)
                                await load()
                              } catch (submitError) {
                                setError((submitError as Error).message)
                              }
                            }}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null)
                              setEditingForm({ username: '', displayName: '', role: 'employee' })
                            }}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(user.id)
                            setEditingForm({
                              username: user.username,
                              displayName: user.displayName,
                              role: user.role,
                            })
                          }}
                          className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                        >
                          编辑
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const result = await api.post<{ defaultPassword: string }>(`/api/admin/users/${user.id}/reset-password`)
                            setMessage(`${user.displayName} 已重置密码：${result.defaultPassword}`)
                          } catch (submitError) {
                            setError((submitError as Error).message)
                          }
                        }}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                      >
                        重置密码
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await api.delete(`/api/admin/users/${user.id}`)
                            if (editingId === user.id) {
                              setEditingId(null)
                            }
                            await load()
                          } catch (submitError) {
                            setError((submitError as Error).message)
                          }
                        }}
                        className="rounded-xl border border-rose-200 px-3 py-2 text-xs text-rose-500"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <section className="space-y-4">
            {overview?.users.map((user) => (
              <div key={user.id} className="rounded-3xl border border-slate-200 bg-white p-5">
                <div className="font-medium text-slate-900">{user.displayName}</div>
                <div className="mt-1 text-xs text-slate-500">{user.username} · {getRoleLabel(user.role)}</div>
                <div className="mt-3 text-sm text-slate-700">备用金：{formatCurrency(user.reserveFundBalance)}</div>
              </div>
            ))}
          </section>
          <section className="space-y-4">
            {overview?.recent.map((item) => (
              <div key={item.id} className="rounded-3xl border border-slate-200 bg-white p-5">
                <div className="font-medium text-slate-900">{fallbackDisplayText(item.title, '未命名报销单')}</div>
                <div className="mt-1 text-sm text-slate-500">{fallbackDisplayText(item.creatorName, '未知账号')}</div>
                <div className="mt-2 text-xs text-slate-400">{formatDateTime(item.updatedAt)}</div>
              </div>
            ))}
          </section>
        </div>
      )}
      {editingCategory ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setEditingCategory(null)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">编辑分类</h3>
                <p className="mt-1 text-sm text-slate-500">默认类型名称不可修改。</p>
              </div>
              <button type="button" onClick={() => setEditingCategory(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 space-y-3">
              <div>
                <label className="text-sm font-medium text-slate-700">分类名称 <span className="text-red-500">*</span></label>
                <input
                  value={editingCategoryForm.name}
                  onChange={(event) => setEditingCategoryForm((current) => ({ ...current, name: event.target.value }))}
                  maxLength={30}
                  disabled={editingCategory.isDefault}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-amber-400 disabled:bg-slate-50"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">描述</label>
                <textarea
                  value={editingCategoryForm.description}
                  onChange={(event) => setEditingCategoryForm((current) => ({ ...current, description: event.target.value }))}
                  rows={2}
                  maxLength={200}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-amber-400"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setEditingCategory(null)} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">取消</button>
              <button
                type="button"
                disabled={!editingCategoryForm.name.trim()}
                onClick={async () => {
                  try {
                    await categoriesApi.update(editingCategory.id, {
                      name: editingCategoryForm.name.trim(),
                      description: editingCategoryForm.description.trim() || undefined,
                    })
                    setMessage('分类已更新。')
                    setEditingCategory(null)
                    await load()
                  } catch (submitError) {
                    setError((submitError as Error).message)
                  }
                }}
                className="rounded-2xl bg-amber-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-300 disabled:bg-slate-200 disabled:text-slate-400"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deletingCategory ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setDeletingCategory(null)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-rose-600">删除分类</h3>
                <p className="mt-1 text-sm text-slate-500">
                  “{deletingCategory.name}”下有 {deletingCategory.reimbursementCount} 张报销单。请选择将它们迁移到哪个分类：
                </p>
              </div>
              <button type="button" onClick={() => setDeletingCategory(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 space-y-3">
              <label className="text-sm font-medium text-slate-700">迁移目标分类 <span className="text-red-500">*</span></label>
              <select
                value={transferTargetId}
                onChange={(event) => setTransferTargetId(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-amber-400"
              >
                {categories.filter((c) => c.id !== deletingCategory.id).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.isDefault ? '（系统默认）' : ''}</option>
                ))}
              </select>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setDeletingCategory(null)} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">取消</button>
              <button
                type="button"
                disabled={!transferTargetId}
                onClick={async () => {
                  try {
                    const result = await categoriesApi.remove(deletingCategory.id, { transferToCategoryId: transferTargetId })
                    const r = result as CategoryDeleteResult
                    setMessage(`已删除分类，原有 ${r.transferredCount} 张报销单已迁移。`)
                    setDeletingCategory(null)
                    await load()
                  } catch (submitError) {
                    setError((submitError as Error).message)
                  }
                }}
                className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:bg-slate-200 disabled:text-slate-400"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {error ? <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div> : null}
      {message ? <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">{message}</div> : null}
    </ShellLayout>
  )
}
