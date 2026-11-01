import {
  BarChart3,
  Check,
  ChevronsUpDown,
  FileText,
  FlaskConical,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  PenLine,
  Settings,
  Tags,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import { useAuth } from '../lib/useAuth'
import { useWorkspaceMode } from '../lib/workspaceBase'
import { LogoMark } from './Logo'
import { buttonClass } from './buttonClass'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  also?: string // another path segment that should highlight this item
}

const WORKSPACE_NAV: NavItem[] = [
  { to: '', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: 'library', label: 'Library', icon: LayoutGrid, also: '/ads/' },
  { to: 'analysis', label: 'Analysis', icon: BarChart3 },
  { to: 'report', label: 'Report', icon: FileText },
  { to: 'briefs', label: 'Briefs', icon: PenLine },
]
const OWNER_NAV: NavItem[] = [
  { to: 'settings', label: 'Settings', icon: Settings },
  { to: 'label', label: 'Label ads', icon: Tags },
]

/** Layout for every signed-in and demo page: sidebar on desktop, drawer on mobile. */
export function AppShell() {
  const { id } = useParams<{ id: string }>()
  const { pathname } = useLocation()
  // the drawer belongs to the page it was opened on, so navigating closes it
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === pathname
  const setOpen = (o: boolean) => setOpenOn(o ? pathname : null)

  return (
    <div className="app min-h-screen font-sans antialiased">
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--line)] bg-[var(--bg)]/85 px-4 backdrop-blur-xl lg:hidden">
        <Link to="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <LogoMark className="h-5 w-5" /> Mosaic
        </Link>
        <button type="button" onClick={() => setOpen(true)} className={buttonClass('ghost', 'sm')} aria-label="Open navigation">
          <Menu size={18} />
        </button>
      </div>

      {open && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-[var(--line)] bg-[#0a0a0d] transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar workspaceId={id} onClose={() => setOpen(false)} />
      </aside>

      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 lg:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function Sidebar({ workspaceId, onClose }: { workspaceId: string | undefined; onClose: () => void }) {
  const { base, readOnly } = useWorkspaceMode()
  const { pathname } = useLocation()
  const root = workspaceId ? `${base}/w/${workspaceId}` : ''

  const item = (n: NavItem) => {
    const extra = n.also && pathname.includes(n.also)
    return (
      <NavLink key={n.label} to={n.to.startsWith('/') ? n.to : `${root}${n.to ? `/${n.to}` : ''}`} end={n.end}
        className={({ isActive }) =>
          `group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition ${isActive || extra ? 'bg-white/[0.07] text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'}`
        }>
        {({ isActive }) => (
          <>
            <n.icon size={16} strokeWidth={1.75} className={isActive || extra ? 'text-[var(--accent-2)]' : ''} />
            {n.label}
          </>
        )}
      </NavLink>
    )
  }

  return (
    <>
      <div className="flex h-14 items-center justify-between px-4">
        <Link to={readOnly ? '/' : '/app'} className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <LogoMark className="h-5 w-5" /> Mosaic
        </Link>
        <button type="button" onClick={onClose} className={`${buttonClass('ghost', 'sm')} lg:hidden`} aria-label="Close navigation">
          <X size={16} />
        </button>
      </div>

      <div className="px-3">
        {workspaceId && (readOnly ? <DemoWorkspace id={workspaceId} /> : <WorkspaceSwitcher id={workspaceId} />)}
      </div>

      <nav className="mt-4 flex-1 space-y-6 overflow-y-auto px-3 pb-4" aria-label="Main">
        {workspaceId && <div className="space-y-0.5">{WORKSPACE_NAV.map(item)}</div>}
        {workspaceId && !readOnly && (
          <div>
            <p className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--faint)]">Workspace</p>
            <div className="space-y-0.5">{OWNER_NAV.map(item)}</div>
          </div>
        )}
        {!readOnly && (
          <div>
            <p className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--faint)]">Mosaic</p>
            <div className="space-y-0.5">
              {item({ to: '/app', label: 'All workspaces', icon: Layers, end: true })}
              {item({ to: '/app/evals', label: 'Evals', icon: FlaskConical })}
            </div>
          </div>
        )}
      </nav>

      <div className="border-t border-[var(--line)] p-3">{readOnly ? <DemoFooter /> : <AccountFooter />}</div>
    </>
  )
}

function WorkspaceSwitcher({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const list = useAsync(async () => {
    const { data } = await supabase.from('workspaces').select('id, name, is_demo').order('created_at')
    return data ?? []
  }, [])
  const current = list.data?.find((w) => w.id === id)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2.5 py-2 text-left transition hover:border-[var(--line-strong)]">
        <WorkspaceAvatar name={current?.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{current?.name ?? '…'}</span>
          <span className="block text-[11px] text-[var(--faint)]">Workspace</span>
        </span>
        <ChevronsUpDown size={14} className="text-[var(--faint)]" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[var(--panel-2)] py-1 shadow-2xl shadow-black/60">
          {(list.data ?? []).map((w) => (
            <Link key={w.id} to={`/app/w/${w.id}`} onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--hover)] hover:text-[var(--text)]">
              <WorkspaceAvatar name={w.name} small />
              <span className="flex-1 truncate">{w.name}</span>
              {w.id === id && <Check size={14} className="text-[var(--accent-2)]" />}
            </Link>
          ))}
          <div className="my-1 border-t border-[var(--line)]" />
          <Link to="/app" onClick={() => setOpen(false)} className="block px-2.5 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]">
            Manage workspaces…
          </Link>
        </div>
      )}
    </div>
  )
}

function DemoWorkspace({ id }: { id: string }) {
  const ws = useAsync(async () => (await supabase.from('workspaces').select('name').eq('id', id).single()).data?.name, [id])
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2.5 py-2">
      <WorkspaceAvatar name={ws.data ?? undefined} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{ws.data ?? '…'}</span>
        <span className="block text-[11px] text-[var(--faint)]">Demo workspace</span>
      </span>
    </div>
  )
}

const AVATAR = ['#4a3fa0', '#6f62d6', '#2c2552', '#3a3266', '#5b4fc4']

export function WorkspaceAvatar({ name, small }: { name: string | undefined; small?: boolean }) {
  const letter = (name ?? '?').trim().charAt(0).toUpperCase() || '?'
  const color = AVATAR[[...(name ?? '')].reduce((t, c) => t + c.charCodeAt(0), 0) % AVATAR.length]
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-md font-semibold text-white ${small ? 'h-5 w-5 text-[10px]' : 'h-7 w-7 text-xs'}`}
      style={{ background: color }} aria-hidden>
      {letter}
    </span>
  )
}

function AccountFooter() {
  const { session, signOut } = useAuth()
  const email = session?.user.email ?? ''
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-xs font-medium" aria-hidden>
        {email.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]" title={email}>{email}</span>
      <button type="button" onClick={() => void signOut()} className={buttonClass('ghost', 'sm')} aria-label="Sign out" title="Sign out">
        <LogOut size={14} />
      </button>
    </div>
  )
}

function DemoFooter() {
  return (
    <div className="rounded-lg border border-[var(--accent)]/25 bg-[var(--accent-soft)] p-3">
      <p className="text-xs font-medium text-[var(--accent-2)]">Live demo</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-2)]">A fictional brand with synthetic results. Read-only.</p>
      <a href="/#waitlist" className={`${buttonClass('primary', 'sm')} mt-3 w-full`}>Get early access</a>
    </div>
  )
}
