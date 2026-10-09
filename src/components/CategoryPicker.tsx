import { useEffect, useRef, useState } from 'react'
import { Lock, LockOpen, Plus, X, Tag } from 'lucide-react'
import { api } from '@/lib/api'
import type { Category, Role } from '@/lib/types'

type Props = {
  value: string | null | undefined
  onChange: (categoryId: string | null) => void
  role: Role
  disabled?: boolean
  locked?: boolean
  onToggleLock?: () => void
}

export function CategoryPicker({ value, onChange, role, disabled = false, locked = false, onToggleLock }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const selectRef = useRef<HTMLSelectElement>(null)

  // 财务不能创建分类
  const canCreate = role !== 'finance'

  async function loadCategories() {
    setLoading(true)
    try {
      const data = await api.get<Category[]>('/api/categories')
      setCategories(data)
      // 如果当前没选，自动选第一个（默认类型）
      if (!value && data.length > 0) {
        const def = data.find((c) => c.isDefault) ?? data[0]
        onChange(def.id)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 监听 value 变化：若当前选中的分类已不存在（例如被删除），则提示重选
  useEffect(() => {
    if (!loading && value && !categories.some((c) => c.id === value)) {
      // 自动重选默认分类，并提示
      const def = categories.find((c) => c.isDefault) ?? categories[0]
      if (def) {
        onChange(def.id)
        // eslint-disable-next-line no-alert
        window.alert('之前选择的报销分类已被删除，已自动重选为默认类型，请重新确认。')
      }
    }
  }, [loading, value, categories, onChange])

  async function handleCreate() {
    if (!newName.trim()) {
      setCreateError('请输入分类名称')
      return
    }
    setCreating(true)
    setCreateError('')
    try {
      const created = await api.post<Category>('/api/categories', {
        name: newName.trim(),
        description: newDescription.trim() || undefined,
      })
      await loadCategories()
      onChange(created.id)
      setModalOpen(false)
      setNewName('')
      setNewDescription('')
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
        <Tag className="h-4 w-4 text-slate-500" />
        <span className="text-sm font-medium text-slate-700">报销分类</span>
        {onToggleLock && !disabled && (
          <button
            type="button"
            onClick={onToggleLock}
            title={locked ? '已锁定：点击解锁，新建报销单时此字段将清空' : '点击锁定：新建报销单时保留此字段，避免重复输入'}
            className="rounded-lg p-1 transition hover:bg-slate-100"
          >
            {locked ? (
              <Lock className="h-3.5 w-3.5 text-amber-500" />
            ) : (
              <LockOpen className="h-3.5 w-3.5 text-slate-400" />
            )}
          </button>
        )}
      </div>
      <select
        ref={selectRef}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled || loading}
        className="min-w-[180px] flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition focus:border-amber-400 disabled:bg-slate-50"
      >
        {loading && <option value="">加载中…</option>}
        {!loading && categories.length === 0 && <option value="">暂无可选分类</option>}
        {!loading &&
          categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.isDefault ? '（系统默认）' : ''}
            </option>
          ))}
      </select>
      {canCreate && !disabled && (
        <button
          type="button"
          onClick={() => {
            setModalOpen(true)
            setCreateError('')
            setNewName('')
            setNewDescription('')
          }}
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-300 bg-amber-50 text-amber-700 transition hover:bg-amber-100"
          title="新建分类"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">新建报销分类</h3>
                <p className="mt-1 text-sm text-slate-500">
                  新分类将立即对所有用户可见。默认类型不可修改或删除。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <div>
                <label className="text-sm font-medium text-slate-700">
                  分类名称 <span className="text-red-500">*</span>
                </label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如：办公用品采购"
                  maxLength={30}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">描述（选填）</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="例如：办公电脑、文具、耗材等"
                  rows={2}
                  maxLength={200}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-amber-400"
                />
              </div>
              {createError && <p className="text-sm text-red-600">{createError}</p>}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                disabled={creating}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="rounded-2xl bg-amber-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-300 disabled:bg-slate-200 disabled:text-slate-400"
              >
                {creating ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
