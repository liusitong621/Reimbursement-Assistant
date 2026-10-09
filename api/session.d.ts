import 'express-session'

declare module 'express-session' {
  interface SessionData {
    user?: {
      id: string
      username: string
      displayName: string
      role: 'employee' | 'leader' | 'finance' | 'admin'
      reserveFundBalance: number
    }
  }
}
