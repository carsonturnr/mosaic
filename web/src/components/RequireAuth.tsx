import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'

export function RequireAuth() {
  const { session, loading } = useAuth()
  if (loading) return <div className="app flex min-h-screen items-center justify-center text-sm text-[var(--muted)]">Loading…</div>
  if (!session) return <Navigate to="/sign-in" replace />
  return <Outlet />
}
