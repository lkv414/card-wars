import { Navigate, Outlet } from 'react-router-dom'
import { useAdminAuth } from '../../context/useAdminAuth'

export function AdminRoute() {
  const { loading, session, isAdmin } = useAdminAuth()

  if (loading) {
    return (
      <div className="admin-login" role="status">
        Проверка доступа…
      </div>
    )
  }

  if (!session || !isAdmin) {
    return <Navigate to="/admin/login" replace />
  }

  return <Outlet />
}
