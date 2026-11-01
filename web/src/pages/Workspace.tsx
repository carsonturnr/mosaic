import {
  ArrowRight,
  BarChart3,
  CircleCheck,
  CircleDashed,
  FileText,
  Link2,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AdThumb } from '../components/AdThumb'
import { Badge, Button, Card, CardTitle, ErrorText, Loading, PageHeader, Stat, Table } from '../components/ui'
import { fetchSnapshot, type SnapshotRow } from '../lib/analysis'
import { workerApi, type MetaAdAccount } from '../lib/api'
import { fmt } from '../lib/format'
import { fetchPerformance, signedUrls, type AdPerf } from '../lib/library'
import { loginWithFacebook } from '../lib/meta'
import { supabase } from '../lib/supabase'
import type { DataSource, SyncRun, Workspace as WorkspaceRow } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { useWorkspaceMode } from '../lib/workspaceBase'

interface ReportBrief {
  id: string
  created_at: string
  grounding_passed: boolean | null
  content: { summary?: string }
}

interface Overview {
  workspace: WorkspaceRow
  sources: DataSource[]
  runs: SyncRun[]
  ads: number
  snap: SnapshotRow | null
  top: AdPerf[]
  thumbs: Record<string, string>
  report: ReportBrief | null
}

const SOURCE_LABEL: Record<string, string> = {
  meta_live: 'Meta ad account',
  sandbox_synthetic: 'Meta sandbox + synthetic results',
  demo: 'Demo data',
  local: 'Local files + synthetic results',
}

async function loadOverview(id: string): Promise<Overview> {
  const [ws, ds, cAds, snap30, report, perf] = await Promise.all([
    supabase.from('workspaces').select('*').eq('id', id).single(),
    supabase.from('data_sources').select('*').eq('workspace_id', id),
    supabase.from('ads').select('id', { count: 'exact', head: true }).eq('workspace_id', id),
    fetchSnapshot(id, '30'),
    supabase.from('reports').select('id, created_at, grounding_passed, content')
      .eq('workspace_id', id).eq('kind', 'strategist').order('created_at', { ascending: false }).limit(1),
    fetchPerformance(id, '30'),
  ])
  if (ws.error) throw new Error('Workspace not found, or it belongs to another account.')
  const sources = (ds.data ?? []) as DataSource[]
  const runs = sources.length
    ? (((await supabase.from('sync_runs').select('*').in('data_source_id', sources.map((d) => d.id))
        .order('started_at', { ascending: false }).limit(8)).data ?? []) as SyncRun[])
    : []
  const snap = snap30 ?? (await fetchSnapshot(id, 'all'))
  const top = [...perf].sort((a, b) => b.spend - a.spend).slice(0, 5)
  const thumbs = await signedUrls(top.map((a) => a.thumbnail_path ?? ''))
  return {
    workspace: ws.data as WorkspaceRow,
    sources,
    runs,
    ads: cAds.count ?? 0,
    snap,
    top,
    thumbs,
    report: (report.data?.[0] ?? null) as unknown as ReportBrief | null,
  }
}

export function Workspace() {
  const { id = '' } = useParams<{ id: string }>()
  const { base, readOnly } = useWorkspaceMode()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fbToken, setFbToken] = useState<string | null>(null)
  const [adAccounts, setAdAccounts] = useState<MetaAdAccount[]>([])
  const overview = useAsync(() => loadOverview(id), [id])
  const o = overview.data

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      overview.reload()
    }
  }
  const refresh = () => run('refresh', () => workerApi.refresh(id).then(() => undefined))
  const startConnect = () =>
    run('connect', async () => {
      const token = await loginWithFacebook()
      setFbToken(token)
      setAdAccounts(await workerApi.metaAdAccounts(token))
    })
  const finishConnect = (accountId: string) =>
    run('connect', async () => {
      if (!fbToken) return
      await workerApi.metaConnect(id, fbToken, accountId)
      setFbToken(null)
      setAdAccounts([])
    })

  if (overview.loading && !o) return <Loading />
  if (!o) return <ErrorText>{overview.error ?? 'Workspace not found.'}</ErrorText>

  const s = o.snap?.payload
  const k = s?.account_kpis
  const root = `${base}/w/${id}`
  const synced = o.sources.some((d) => d.kind !== 'local')
  const lastSync = o.sources.map((d) => d.last_synced_at).filter(Boolean).sort().at(-1)

  return (
    <>
      <PageHeader
        title={o.workspace.name}
        description={o.snap ? `${o.snap.window_key === 'all' ? 'All time' : 'Last 30 days'} · ${o.snap.since} to ${o.snap.until}` : 'Connect an ad account to see results here.'}
        actions={!readOnly && (
          <>
            {!o.sources.some((d) => d.kind === 'meta_live') && (
              <Button onClick={() => void startConnect()} disabled={busy !== null}>
                <Link2 size={15} /> {busy === 'connect' ? 'Connecting…' : 'Connect Meta'}
              </Button>
            )}
            {synced && (
              <Button variant="primary" onClick={() => void refresh()} disabled={busy !== null}>
                <RefreshCw size={15} className={busy === 'refresh' ? 'animate-spin' : ''} />
                {busy === 'refresh' ? 'Refreshing…' : 'Refresh now'}
              </Button>
            )}
          </>
        )}
      />

      <div className="space-y-6">
        <ErrorText>{error ?? overview.error}</ErrorText>

        {adAccounts.length > 0 && (
          <Card>
            <CardTitle>Pick the ad account for this workspace</CardTitle>
            <ul className="divide-y divide-[var(--line)]">
              {adAccounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span>{a.name} <span className="font-mono text-xs text-[var(--faint)]">{a.id} · {a.currency ?? '—'}</span></span>
                  <Button size="sm" variant="primary" onClick={() => void finishConnect(a.id)}>Use this account</Button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!readOnly && <GettingStarted root={root} o={o} />}

        {s && k && (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Spend" value={fmt.money(s.account.spend)} hint={`${s.ads.length} ads`} />
            <Stat label="ROAS" value={fmt.ratio(k.roas)} hint={`${fmt.money(s.account.purchase_value)} revenue`} />
            <Stat label="CPA" value={fmt.money(k.cpa)} hint={`${fmt.int(s.account.purchases)} purchases`} />
            <Stat label="CTR" value={fmt.pct(k.ctr)} hint={`${fmt.compact(s.account.impressions)} impressions`} />
            <Stat label="Hook rate" value={fmt.pct(k.hook_rate, 1)} hint="3-second views, video" />
          </dl>
        )}

        {s && (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card pad={false}>
              <div className="px-5 pt-5"><CardTitle aside={<Link to={`${root}/library`} className="hover:text-[var(--text)]">Library →</Link>}>Top ads by spend</CardTitle></div>
              <ul>
                {o.top.map((ad) => (
                  <li key={ad.ad_id} className="border-t border-[var(--line)]">
                    <Link to={`${root}/ads/${ad.ad_id}`} className="flex items-center gap-3 px-5 py-2.5 transition hover:bg-[var(--hover)]">
                      <AdThumb src={ad.thumbnail_path ? o.thumbs[ad.thumbnail_path] : undefined} video={ad.creative_type === 'video'} className="h-11 w-9" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{ad.name ?? ad.external_id}</span>
                        <span className="block text-xs text-[var(--faint)]">{ad.creative_type === 'video' ? 'Video' : 'Static'} · {fmt.pct(ad.ctr)} CTR</span>
                      </span>
                      <span className="text-right font-mono text-sm tabular-nums">
                        <span className="block">{fmt.ratio(ad.roas)}</span>
                        <span className="block text-xs text-[var(--faint)]">{fmt.money(ad.spend)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>

            <div className="space-y-6">
              <ReportCard root={root} report={o.report} readOnly={readOnly} />
              <Card>
                <CardTitle icon={<BarChart3 size={15} />} aside={<Link to={`${root}/analysis`} className="hover:text-[var(--text)]">Analysis →</Link>}>Signals</CardTitle>
                <ul className="space-y-2.5 text-sm">
                  <SignalRow icon={<TrendingDown size={14} />} tone="bad" n={new Set(s.fatigue.map((f) => f.ad_id)).size} label="ads fading" />
                  <SignalRow icon={<Zap size={14} />} tone="good" n={new Set(s.underfunded.map((u) => u.ad_id)).size} label="underfunded winners" />
                  <SignalRow icon={<TriangleAlert size={14} />} tone="warn" n={new Set(s.outliers.filter((x) => x.metric === 'roas').map((x) => x.ad_id)).size} label="ROAS outliers vs. peers" />
                </ul>
                {s.concepts && (
                  <div className="mt-4 flex items-baseline justify-between border-t border-[var(--line)] pt-4">
                    <span className="text-sm text-[var(--muted)]">Real concepts, by spend</span>
                    <span className="whitespace-nowrap font-mono text-sm"><span className="text-lg text-[var(--text)]">{s.concepts.diversity.toFixed(1)}</span> <span className="text-[var(--faint)]">of {s.concepts.n_creatives} creatives</span></span>
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        <section>
          <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">Data</h2>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <Card>
              {o.sources.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No data source yet. Connect a Meta ad account to start syncing.</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {o.sources.map((d) => (
                    <li key={d.id}>
                      <p>{SOURCE_LABEL[d.kind] ?? d.kind}</p>
                      <p className="mt-0.5 font-mono text-xs text-[var(--faint)]">{d.meta_ad_account_id ?? '—'}</p>
                    </li>
                  ))}
                </ul>
              )}
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-4 text-sm">
                <div><dt className="text-xs text-[var(--faint)]">Ads</dt><dd className="font-mono">{o.ads}</dd></div>
                <div><dt className="text-xs text-[var(--faint)]">Last sync</dt><dd>{lastSync ? ago(lastSync) : synced ? 'Never' : 'Fixed snapshot'}</dd></div>
              </dl>
            </Card>
            {o.runs.length > 0 ? (
              <Table minWidth={480}>
                <thead><tr><th>Job</th><th>Status</th><th>When</th><th>Result</th></tr></thead>
                <tbody>
                  {o.runs.map((r) => (
                    <tr key={r.id}>
                      <td className="font-mono text-xs">{r.job}</td>
                      <td><Badge tone={r.status === 'failed' ? 'bad' : r.status === 'done' ? 'good' : 'neutral'}>{r.status}</Badge></td>
                      <td className="whitespace-nowrap text-[var(--muted)]">{ago(r.started_at)}</td>
                      <td className="max-w-[260px] truncate font-mono text-xs text-[var(--faint)]" title={r.error ?? JSON.stringify(r.stats)}>
                        {r.status === 'failed' ? r.error?.slice(0, 80) : summarizeStats(r.stats)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Card><p className="text-sm text-[var(--muted)]">No sync runs yet.</p></Card>
            )}
          </div>
        </section>
      </div>
    </>
  )
}

function ReportCard({ root, report, readOnly }: { root: string; report: ReportBrief | null; readOnly: boolean }) {
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-[radial-gradient(closest-side,rgb(144_133_233/0.18),transparent)]" aria-hidden />
      <CardTitle icon={<FileText size={15} />} aside={report && (
        report.grounding_passed
          ? <Badge tone="good"><ShieldCheck size={12} /> Verified</Badge>
          : <Badge tone="warn">Check flagged claims</Badge>
      )}>Strategist report</CardTitle>
      {report?.content.summary ? (
        <>
          <p className="line-clamp-5 text-sm leading-relaxed text-[var(--text-2)]">{report.content.summary}</p>
          <Link to={`${root}/report`} className="mt-4 inline-flex items-center gap-1 text-sm text-[var(--accent-2)] hover:text-[var(--text)]">
            Read the report <ArrowRight size={14} />
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--muted)]">{readOnly ? 'No report has been written for this demo yet.' : 'What to scale, cut and make next, with every claim cited.'}</p>
          {!readOnly && (
            <Link to={`${root}/report`} className="mt-4 inline-flex items-center gap-1 text-sm text-[var(--accent-2)] hover:text-[var(--text)]">
              Generate one <ArrowRight size={14} />
            </Link>
          )}
        </>
      )}
    </Card>
  )
}

function SignalRow({ icon, tone, n, label }: { icon: ReactNode; tone: 'good' | 'bad' | 'warn'; n: number; label: string }) {
  const color = { good: 'text-[var(--good)]', bad: 'text-[var(--bad)]', warn: 'text-[var(--warn)]' }[tone]
  return (
    <li className="flex items-center gap-2.5">
      <span className={n ? color : 'text-[var(--faint)]'}>{icon}</span>
      <span className="font-mono tabular-nums">{n}</span>
      <span className="text-[var(--muted)]">{label}</span>
    </li>
  )
}

function GettingStarted({ root, o }: { root: string; o: Overview }) {
  const steps = [
    { done: o.sources.length > 0, label: 'Connect a Meta ad account', hint: 'Read-only access to ads and results.' },
    { done: o.ads > 0, label: 'Run the first sync', hint: 'Imports 90 days of ads and results.' },
    { done: !!o.snap, label: 'Review the analysis', hint: 'Rankings, signals and concepts.', to: `${root}/analysis` },
    { done: !!o.report, label: 'Generate a strategist report', hint: 'Every claim cites its ads and numbers.', to: `${root}/report` },
  ]
  if (steps.every((s) => s.done)) return null
  const done = steps.filter((s) => s.done).length
  return (
    <Card>
      <CardTitle aside={`${done} of ${steps.length}`}>Getting started</CardTitle>
      <div className="mb-4 h-1 rounded-full bg-white/[0.06]">
        <div className="h-1 rounded-full bg-[var(--accent)] transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.label} className="flex gap-2.5 text-sm">
            {s.done ? <CircleCheck size={17} className="mt-0.5 shrink-0 text-[var(--good)]" /> : <CircleDashed size={17} className="mt-0.5 shrink-0 text-[var(--faint)]" />}
            <span>
              {s.to && !s.done ? <Link to={s.to} className="font-medium hover:text-[var(--accent-2)]">{s.label}</Link>
                : <span className={s.done ? 'text-[var(--muted)] line-through decoration-[var(--faint)]' : 'font-medium'}>{s.label}</span>}
              {!s.done && <span className="mt-0.5 block text-xs text-[var(--muted)]">{s.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

/** '{"ads": 24, "creatives": 24, "campaigns": 3}' → 'ads 24 · creatives 24 · campaigns 3' */
function summarizeStats(stats: unknown): string {
  if (!stats || typeof stats !== 'object') return ''
  return Object.entries(stats as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .slice(0, 4)
    .map(([key, v]) => `${key} ${String(v)}`)
    .join(' · ')
}

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}
