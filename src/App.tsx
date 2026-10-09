import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from '@/components/RequireAuth'
import DashboardPage from '@/pages/DashboardPage'
import LoginPage from '@/pages/LoginPage'
import RecordsPage from '@/pages/RecordsPage'
import ReimbursementEditorPage from '@/pages/ReimbursementEditorPage'
import ApprovalsPage from '@/pages/ApprovalsPage'
import ReserveFundsPage from '@/pages/ReserveFundsPage'
import AdminPage from '@/pages/AdminPage'
import ProfilePage from '@/pages/ProfilePage'
import { useAuthStore } from '@/store/authStore'

export default function App() {
  const loadSession = useAuthStore((state) => state.loadSession)

  useEffect(() => {
    loadSession()
  }, [loadSession])

  return (
    <BrowserRouter basename={(import.meta.env.VITE_BASE_PATH as string | undefined) || '/FP'}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/reimbursements/:id" element={<ReimbursementEditorPage mode="edit" />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route element={<RequireAuth allowedRoles={['employee', 'leader', 'admin']} />}>
            <Route path="/reimbursements/new" element={<ReimbursementEditorPage mode="create" />} />
          </Route>
          <Route element={<RequireAuth allowedRoles={['leader', 'admin']} />}>
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/reserve-funds" element={<ReserveFundsPage />} />
          </Route>
          <Route element={<RequireAuth allowedRoles={['leader', 'admin']} />}>
            <Route path="/admin/categories" element={<AdminPage mode="categories" />} />
          </Route>
          <Route element={<RequireAuth allowedRoles={['admin']} />}>
            <Route path="/admin/users" element={<AdminPage mode="users" />} />
            <Route path="/admin/overview" element={<AdminPage mode="overview" />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
