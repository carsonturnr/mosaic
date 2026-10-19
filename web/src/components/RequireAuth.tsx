import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'

export function RequireAuth() {
  const { session, loading } = useAuth()
  if (loading) return <p className="p-8 text-sm text-neutral-500">Loading…</p>
  if (!session) return <Navigate to="/sign-in" replace />
  return <Outlet />
}
