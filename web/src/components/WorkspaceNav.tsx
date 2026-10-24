import { NavLink, useLocation } from 'react-router-dom'
import { useWorkspaceMode } from '../lib/workspaceBase'

const tabs = [
  { to: '', label: 'Overview', end: true, also: null },
  { to: 'library', label: 'Library', end: false, also: '/ads/' }, // ad detail lives under the library
  { to: 'analysis', label: 'Analysis', end: false, also: null },
  { to: 'report', label: 'Report', end: false, also: null },
  { to: 'briefs', label: 'Briefs', end: false, also: null },
  { to: 'settings', label: 'Settings', end: false, also: null },
]

export function WorkspaceNav({ id, name }: { id: string; name: string | undefined }) {
  const { pathname } = useLocation()
  const { base, readOnly } = useWorkspaceMode()
  const visible = tabs.filter((t) => !(readOnly && t.to === 'settings'))
  return (
    <div className="mb-6">
      {readOnly ? (
        <div className="-mx-6 -mt-6 mb-5 flex flex-wrap items-center justify-between gap-2 bg-neutral-900 px-6 py-2.5 text-sm text-white">
          <span>Live demo · fictional brand, synthetic data, read-only</span>
          <a href="/#waitlist" className="rounded-md bg-white px-2.5 py-1 font-medium text-neutral-900">Get early access</a>
        </div>
      ) : (
        <NavLink to="/app" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Workspaces
        </NavLink>
      )}
      <h1 className="mt-2 text-xl font-semibold">{name ?? '…'}</h1>
      <nav className="mt-4 flex gap-1 border-b border-neutral-200 text-sm">
        {visible.map((t) => (
          <NavLink
            key={t.label}
            to={`${base}/w/${id}${t.to ? `/${t.to}` : ''}`}
            end={t.end}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-3 py-2 ${isActive || (t.also && pathname.includes(t.also)) ? 'border-neutral-900 font-medium text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-900'}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
