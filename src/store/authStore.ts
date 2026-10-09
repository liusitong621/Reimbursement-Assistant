import { create } from 'zustand'
import { api } from '@/lib/api'
import type { SessionUser } from '@/lib/types'

type AuthState = {
  user: SessionUser | null
  initialized: boolean
  loginPending: boolean
  loadSession: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (data: { displayName?: string; currentPassword?: string; newPassword?: string }) => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  initialized: false,
  loginPending: false,
  loadSession: async () => {
    try {
      const user = await api.get<SessionUser | null>('/api/auth/me')
      set({
        user,
        initialized: true,
      })
    } catch {
      set({
        user: null,
        initialized: true,
      })
    }
  },
  login: async (username, password) => {
    set({ loginPending: true })
    try {
      const user = await api.post<SessionUser>('/api/auth/login', {
        username,
        password,
      })

      set({
        user,
        initialized: true,
        loginPending: false,
      })
    } catch (error) {
      set({ loginPending: false })
      throw error
    }
  },
  logout: async () => {
    await api.post('/api/auth/logout')
    set({ user: null })
  },
  updateProfile: async (data) => {
    const updated = await api.patch<SessionUser>('/api/auth/profile', data)
    set({ user: updated })
  },
}))
