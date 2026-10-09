import { api } from './api'
import type { Category } from './types'

export type CategoryCreatePayload = {
  name: string
  description?: string
}

export type CategoryUpdatePayload = {
  name?: string
  description?: string
  sortOrder?: number
}

export type CategoryDeletePayload = {
  transferToCategoryId: string
}

export type CategoryDeleteResult = {
  transferredCount: number
  targetCategoryId: string
}

export const categoriesApi = {
  list: () => api.get<Category[]>('/api/categories'),
  create: (payload: CategoryCreatePayload) => api.post<Category>('/api/categories', payload),
  update: (id: string, payload: CategoryUpdatePayload) => api.patch<Category>(`/api/categories/${id}`, payload),
  remove: (id: string, payload: CategoryDeletePayload) =>
    api.delete<CategoryDeleteResult>(`/api/categories/${id}`, payload),
}
