import {
  ArrowRight,
  BarChart3,
  CircleCheck,
  FileText,
  Link2,
  Loader2,
  Play,
  Plus,
  ScanSearch,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { WorkspaceAvatar } from '../components/AppShell'
import { buttonClass } from '../components/buttonClass'
import { Badge, Button, Card, ErrorText, Loading, PageHeader, type Tone } from '../components/ui'
import type { Metric, Totals } from '../lib/analysis'
import { fmt } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Workspace } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { useAuth } from '../lib/useAuth'

/** Everything a workspace card needs, gathered for all workspaces in a few queries. */
interface Summary {
  ws: Workspace
  sources: { kind: string; last_synced_at: string | null }[]
  ads: number
  creatives: number
  processing: number
  account: Totals | null
  kpis: Record<Metric, number | null> | null
  concepts: number | null
  reportAt: string | null
}

interface NextStep {
  label: string
  hint: string
  to: string
  icon: LucideIcon
  done: boolean // setup is complete; this is the routine action
  waiting?: boolean // nothing for the user to do yet
}

const SOURCE: Record<string, [string, Tone]> = {
  meta_live: ['Meta connected', 'good'],
  sandbox_synthetic: ['Sandbox', 'neutral'],
  local: ['Local files', 'neutral'],
  demo: ['Demo data', 'accent'],
}

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Link2, title: 'Connect Meta', body: 'Read-only access to one ad account. Nothing in it is ever changed.' },
  { icon: ScanSearch, title: 'Every ad is broken down', body: 'Hook, angle, format, offer and proof, scene by scene, for video and static.' },
  { icon: BarChart3, title: 'See what actually wins', body: 'Tags ranked by ROAS and CTR, with low-spend luck shrunk out.' },
  { icon: FileText, title: 'Get your next tests', body: 'A strategist report and briefs, every number checked against your data.' },
]

const DAY = 86_400_000

async function loadSummaries(): Promise<Summary[]> {
  const { data, error } = await supabase.from('workspaces').select('*').order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  const list = (data ?? []) as Workspace[]
  if (!list.length) return []
  const ids = list.map((w) => w.id)
  const [ds, ads, cr, snaps, reports] = await Promise.all([
    supabase.from('data_sources').select('workspace_id, kind, last_synced_at').in('workspace_id', ids),
    supabase.from('ads').select('workspace_id').in('workspace_id', ids),
    supabase.from('creatives').select('workspace_id, perception_status').in('workspace_id', ids),
    supabase.from('analysis_snapshots')
      .select('workspace_id, window_key, account:payload->account, kpis:payload->account_kpis, concepts:payload->concepts->clusters')
      .in('workspace_id', ids).in('window_key', ['30', 'all']),
    supabase.from('reports').select('workspace_id, created_at').in('workspace_id', ids).eq('kind', 'strategist')
      .order('created_at', { ascending: false }),
  ])
  type Snap = { workspace_id: string; window_key: string; account: Totals | null; kpis: Record<Metric, number | null> | null; concepts: unknown[] | null }
  const snapRows = (snaps.data ?? []) as unknown as Snap[]

  return list.map((ws) => {
    const mine = <T extends { workspace_id: string }>(rows: T[] | null) => (rows ?? []).filter((r) => r.workspace_id === ws.id)
    const creatives = mine(cr.data)
    // the 30-day window reads best on a card; fall back to all time for an account that went quiet
    const snap = snapRows.find((s) => s.workspace_id === ws.id && s.window_key === '30' && s.account?.spend)
      ?? snapRows.find((s) => s.workspace_id === ws.id && s.window_key === 'all')
    return {
      ws,
      sources: mine(ds.data),
      ads: mine(ads.data).length,
      creatives: creatives.length,
      processing: creatives.filter((c) => c.perception_status === 'pending' || c.perception_status === 'processing').length,
      account: snap?.account ?? null,
      kpis: snap?.kpis ?? null,
      concepts: snap?.concepts?.length ?? null,
      reportAt: mine(reports.data)[0]?.created_at ?? null,
    }
  })
}

function nextStep(s: Summary): NextStep {
  const root = `/app/w/${s.ws.id}`
  if (!s.sources.length) {
    return { label: 'Connect your Meta ad account', hint: 'Takes about a minute. Mosaic only reads.', to: root, icon: Link2, done: false }
  }
  if (!s.ads) {
    return { label: 'Importing your ads', hint: 'The first sync pulls 90 days of ads and results.', to: root, icon: Loader2, done: false, waiting: true }
  }
  if (s.processing) {
    return {
      label: `Breaking down ${s.creatives - s.processing} of ${s.creatives} ads`,
      hint: 'Each ad is watched and tagged. Analysis updates as they finish.',
      to: `${root}/library`, icon: Loader2, done: false, waiting: true,
    }
  }
  if (!s.reportAt) {
    return { label: 'Generate your first strategist report', hint: 'What to scale, what to cut, what to test next.', to: `${root}/report`, icon: Sparkles, done: false }
  }
  if (Date.now() - new Date(s.reportAt).getTime() > 7 * DAY) {
    return { label: 'Refresh your strategist report', hint: `Last one is ${Math.floor((Date.now() - new Date(s.reportAt).getTime()) / DAY)} days old.`, to: `${root}/report`, icon: Sparkles, done: false }
  }
  return { label: 'Read the latest report', hint: 'Then turn a winner into new briefs.', to: `${root}/report`, icon: FileText, done: true }
}

function setupProgress(s: Summary): number {
  return [s.sources.length > 0, s.ads > 0, s.ads > 0 && !s.processing, !!s.reportAt].filter(Boolean).length
}

export function Workspaces() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = useAsync(loadSummaries, [])
  const summaries = list.data ?? []
  const firstName = (session?.user.user_metadata?.full_name as string | undefined)?.split(' ')[0]

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
  if (list.data && !summaries.length) return <Welcome onCreate={create} error={error ?? list.error} />

  const todo = summaries.filter((s) => !s.ws.is_demo).map((s) => ({ s, step: nextStep(s) })).filter((x) => !x.step.done)

  return (
    <div>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Your brands'}
        description="One workspace per brand, each connected to one Meta ad account."
        actions={
          <>
            <Link to="/demo" className={buttonClass('ghost')}><Play size={14} /> Live demo</Link>
            <Button variant="primary" onClick={() => setCreating(true)}><Plus size={15} /> New workspace</Button>
          </>
        }
      />

      {creating && (
        <Card className="mb-6">
          <CreateForm onCreate={create} onCancel={() => setCreating(false)} autoFocus />
        </Card>
      )}
      <div className="mb-4"><ErrorText>{error ?? list.error}</ErrorText></div>

      {todo.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">Up next</h2>
          <div className="overflow-hidden rounded-xl border border-[var(--accent)]/25 bg-[linear-gradient(135deg,var(--accent-soft),transparent_60%)]">
            {todo.map(({ s, step }, i) => (
              <Link key={s.ws.id} to={step.to}
                className={`group flex items-center gap-4 px-5 py-4 transition hover:bg-white/[0.03] ${i ? 'border-t border-[var(--line)]' : ''}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${step.waiting ? 'bg-white/[0.06] text-[var(--muted)]' : 'bg-[var(--accent)] text-white'}`}>
                  <step.icon size={17} className={step.waiting ? 'animate-spin [animation-duration:2.5s]' : ''} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{step.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">{s.ws.name} · {step.hint}</span>
                </span>
                {!step.waiting && (
                  <span className={`${buttonClass('accent', 'sm')} hidden sm:inline-flex`}>Continue <ArrowRight size={13} /></span>
                )}
                <ArrowRight size={16} className="text-[var(--faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--text)] sm:hidden" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">Workspaces</h2>
        <ul className="grid gap-4 md:grid-cols-2">
          {summaries.map((s) => <li key={s.ws.id}><WorkspaceCard s={s} /></li>)}
          <li>
            <button type="button" onClick={() => setCreating(true)}
              className="flex h-full min-h-48 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--line-strong)] text-sm text-[var(--muted)] transition hover:border-[var(--accent)]/50 hover:text-[var(--text)]">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.05]"><Plus size={17} /></span>
              Add another brand
            </button>
          </li>
        </ul>
      </section>
    </div>
  )
}

function WorkspaceCard({ s }: { s: Summary }) {
  const root = `/app/w/${s.ws.id}`
  const step = nextStep(s)
  const progress = setupProgress(s)
  const synced = s.sources.map((d) => d.last_synced_at).filter((d): d is string => !!d).sort().at(-1)
  const kinds = [...new Set(s.sources.map((d) => d.kind))]

  return (
    <div className="flex h-full flex-col rounded-xl border border-[var(--line)] bg-[var(--panel)] transition hover:border-[var(--line-strong)]">
      <Link to={root} className="group flex items-start gap-3 p-5 pb-4">
        <WorkspaceAvatar name={s.ws.name} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{s.ws.name}</span>
            {s.ws.is_demo && <Badge tone="accent">Demo</Badge>}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--faint)]">
            {kinds.length ? kinds.map((k) => <Badge key={k} tone={SOURCE[k]?.[1] ?? 'neutral'}>{SOURCE[k]?.[0] ?? k}</Badge>) : <Badge tone="warn">Not connected</Badge>}
            {synced && <span>synced {ago(synced)}</span>}
          </span>
        </span>
        <ArrowRight size={16} className="mt-1 text-[var(--faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--text)]" />
      </Link>

      {s.account ? (
        <dl className="grid grid-cols-4 gap-px border-y border-[var(--line)] bg-[var(--line)]">
          <MetricCell label="Spend" value={fmt.compact(s.account.spend)} prefix="$" />
          <MetricCell label="ROAS" value={fmt.ratio(s.kpis?.roas)} />
          <MetricCell label="Ads" value={fmt.int(s.ads)} />
          <MetricCell label="Concepts" value={fmt.int(s.concepts)} />
        </dl>
      ) : (
        <div className="mx-5 rounded-lg border border-dashed border-[var(--line-strong)] px-4 py-3">
          <div className="flex items-center justify-between text-xs text-[var(--muted)]">
            <span>Setup</span>
            <span>{progress} of 4</span>
          </div>
          <div className="mt-2 h-1 rounded-full bg-white/[0.06]">
            <div className="h-1 rounded-full bg-[var(--accent)]" style={{ width: `${(progress / 4) * 100}%` }} />
          </div>
        </div>
      )}

      <Link to={step.to} className="group mt-auto flex items-center gap-2.5 px-5 py-3.5 text-sm">
        {step.done ? <CircleCheck size={15} className="text-[var(--good)]" />
          : <step.icon size={15} className={step.waiting ? 'animate-spin text-[var(--muted)] [animation-duration:2.5s]' : 'text-[var(--accent-2)]'} />}
        <span className={`flex-1 truncate ${step.done || step.waiting ? 'text-[var(--muted)]' : 'font-medium text-[var(--text)]'}`}>{step.label}</span>
        <ArrowRight size={14} className="text-[var(--faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--text)]" />
      </Link>
    </div>
  )
}

function MetricCell({ label, value, prefix = '' }: { label: string; value: string; prefix?: string }) {
  return (
    <div className="bg-[var(--panel)] px-4 py-3">
      <dt className="text-[11px] text-[var(--faint)]">{label}</dt>
      <dd className="mt-0.5 font-mono text-[15px] tabular-nums">{value === '—' ? value : `${prefix}${value}`}</dd>
    </div>
  )
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
          Start with a workspace for your brand. Next you'll connect its Meta ad account, and Mosaic takes it from there.
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

function CreateForm({ onCreate, onCancel, autoFocus, label = 'New workspace' }: {
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
          {busy ? 'Creating…' : 'Create workspace'} <ArrowRight size={15} />
        </Button>
        {onCancel && <Button variant="ghost" onClick={onCancel} aria-label="Cancel" className="h-10"><X size={15} /></Button>}
      </div>
    </form>
  )
}

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
