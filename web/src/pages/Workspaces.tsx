import { ArrowRight, BarChart3, FileText, Link2, ScanSearch, Sparkles, X, type LucideIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Badge, Button, ErrorText, Loading } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import { useAuth } from '../lib/useAuth'
import { LAST_WORKSPACE } from '../lib/workspaceBase'

// Mosaic is one brand per account: /app opens that brand's dashboard, or sets it up.

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Link2, title: 'Connect Meta', body: 'Read-only access to one ad account. Nothing in it is ever changed.' },
  { icon: ScanSearch, title: 'Every ad is broken down', body: 'Hook, angle, format, offer and proof, scene by scene, for video and static.' },
  { icon: BarChart3, title: 'See what actually wins', body: 'Tags ranked by ROAS and CTR, with low-spend luck shrunk out.' },
  { icon: FileText, title: 'Get your next tests', body: 'A strategist report and briefs, every number checked against your data.' },
]

export function Workspaces() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const list = useAsync(async () => {
    const { data, error: err } = await supabase.from('workspaces').select('id, is_demo').order('created_at', { ascending: true })
    if (err) throw new Error(err.message)
    return data ?? []
  }, [])

  const create = async (name: string) => {
    if (!session) return
    setError(null)
    const { data, error: err } = await supabase.from('workspaces').insert({ owner_id: session.user.id, name: name.trim() }).select('id').single()
    if (err) {
      setError(err.message)
      return
    }
    navigate(`/app/w/${data.id}`)
  }

  if (list.loading && !list.data) return <Loading />
  const own = (list.data ?? []).filter((w) => !w.is_demo)
  let last: string | null = null
  try { last = localStorage.getItem(LAST_WORKSPACE) } catch { /* storage blocked */ }
  const target = own.find((w) => w.id === last) ?? own[0]
  if (target) return <Navigate to={`/app/w/${target.id}`} replace />
  return <Welcome onCreate={create} error={error ?? list.error} />
}

/** First visit: explain what happens, then one obvious thing to do. */
function Welcome({ onCreate, error }: { onCreate: (name: string) => Promise<void>; error: string | null }) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[radial-gradient(ellipse_at_top_left,rgba(144,133,233,0.22),transparent_55%),var(--panel)] px-6 py-10 sm:px-10">
        <Badge tone="accent"><Sparkles size={11} /> Welcome to Mosaic</Badge>
        <h1 className="mt-4 max-w-xl text-[30px] font-semibold leading-tight tracking-[-0.02em]">
          Your in-house creative strategist, set up in two minutes.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--text-2)]">
          Name your brand, connect its Meta ad account, and Mosaic takes it from there.
        </p>
        <div className="mt-7 max-w-lg">
          <CreateForm onCreate={onCreate} autoFocus label="Brand name" />
        </div>
        <p className="mt-4 text-xs text-[var(--muted)]">
          Want to look around first? <Link to="/demo" className="font-medium text-[var(--accent-2)] hover:underline">Open the live demo</Link>, a fictional brand with real analysis.
        </p>
      </div>

      <div className="mt-4"><ErrorText>{error}</ErrorText></div>

      <h2 className="mb-3 mt-10 text-sm font-medium text-[var(--muted)]">What happens next</h2>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((st, i) => (
          <li key={st.title} className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <div className="flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-2)]"><st.icon size={16} /></span>
              <span className="font-mono text-xs text-[var(--faint)]">0{i + 1}</span>
            </div>
            <p className="mt-3 text-sm font-medium">{st.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{st.body}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

function CreateForm({ onCreate, onCancel, autoFocus, label = 'Brand name' }: {
  onCreate: (name: string) => Promise<void>
  onCancel?: () => void
  autoFocus?: boolean
  label?: string
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    await onCreate(name)
    setBusy(false)
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <label className="flex flex-1 flex-col gap-1.5">
        <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Driftwell" required autoFocus={autoFocus} className="h-10 px-3 text-sm" />
      </label>
      <div className="flex gap-2">
        <Button type="submit" variant="accent" disabled={busy || !name.trim()} className="h-10 flex-1 sm:flex-none">
          {busy ? 'Creating…' : 'Set up my brand'} <ArrowRight size={15} />
        </Button>
        {onCancel && <Button variant="ghost" onClick={onCancel} aria-label="Cancel" className="h-10"><X size={15} /></Button>}
      </div>
    </form>
  )
}

