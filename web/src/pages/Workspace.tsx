import {
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  FileText,
  FlaskConical,
  Link2,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AdThumb } from '../components/AdThumb'
import { buttonClass } from '../components/buttonClass'
import { Badge, Button, Card, CardTitle, ErrorText, Loading, PageHeader, Stat, Table } from '../components/ui'
import { fetchSnapshot, type AdStats, type Metric, type Snapshot, type SnapshotRow } from '../lib/analysis'
import { workerApi, type MetaAdAccount } from '../lib/api'
import { fmt } from '../lib/format'
import { fetchPerformance, signedUrls, type AdPerf } from '../lib/library'
import { loginWithFacebook } from '../lib/meta'
import { supabase } from '../lib/supabase'
import type { DataSource, SyncRun, Workspace as WorkspaceRow } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { useWorkspaceMode } from '../lib/workspaceBase'

interface Claim { claim: string; ad_ids: string[] }
interface ReportBrief {
  id: string
  created_at: string
  grounding_passed: boolean | null
  content: { summary?: string; double_down?: Claim[]; cut?: Claim[]; missing_concepts?: Claim[] }
}

interface Overview {
  workspace: WorkspaceRow
  sources: DataSource[]
  runs: SyncRun[]
  ads: number
  snap: SnapshotRow | null
  perf: AdPerf[]
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
  const spotlight = snap ? pickWinner(snap.payload) : null
  const shown = [...topBySpend(perf, 6).map((a) => a.thumbnail_path), perf.find((a) => a.ad_id === spotlight?.ad_id)?.thumbnail_path]
  return {
    workspace: ws.data as WorkspaceRow,
    sources,
    runs,
    ads: cAds.count ?? 0,
    snap,
    perf,
    thumbs: await signedUrls(shown.map((p) => p ?? '')),
    report: (report.data?.[0] ?? null) as unknown as ReportBrief | null,
  }
}

const topBySpend = (perf: AdPerf[], n: number) => [...perf].sort((a, b) => b.spend - a.spend).slice(0, n)

/** The ad whose ROAS is most surely above average: the highest lower bound, not the highest point estimate. */
function pickWinner(s: Snapshot): AdStats | null {
  const ranked = s.ads
    .filter((a) => !a.low_data && a.kpis.roas.low != null)
    .sort((a, b) => (b.kpis.roas.low ?? 0) - (a.kpis.roas.low ?? 0))
  return ranked[0] ?? null
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
  const connected = o.sources.some((d) => d.kind === 'meta_live')
  const winner = s ? pickWinner(s) : null
  const winnerPerf = o.perf.find((a) => a.ad_id === winner?.ad_id)

  return (
    <>
      <PageHeader
        title={o.workspace.name}
        description={o.snap
          ? `${o.snap.window_key === 'all' ? 'All time' : 'Last 30 days'} · ${o.snap.since} to ${o.snap.until}${lastSync ? ` · synced ${ago(lastSync)}` : ''}`
          : 'Connect your ad account and Mosaic does the rest.'}
        actions={!readOnly && (
          <>
            {!connected && (
              <Button variant={o.sources.length ? 'secondary' : 'accent'} onClick={() => void startConnect()} disabled={busy !== null}>
                <Link2 size={15} /> {busy === 'connect' ? 'Connecting…' : 'Connect Meta'}
              </Button>
            )}
            {synced && (
              <Button variant="primary" onClick={() => void refresh()} disabled={busy !== null}>
                <RefreshCw size={15} className={busy === 'refresh' ? 'animate-spin' : ''} />
                {busy === 'refresh' ? 'Refreshing…' : 'Refresh'}
              </Button>
            )}
          </>
        )}
      />

      <div className="space-y-8">
        <ErrorText>{error ?? overview.error}</ErrorText>

        {adAccounts.length > 0 && (
          <Card>
            <CardTitle>Pick your brand's ad account</CardTitle>
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

        {!readOnly && <GettingStarted root={root} o={o} onConnect={() => void startConnect()} busy={busy !== null} />}

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
          <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            {winner ? <WinnerSpotlight root={root} ad={winner} perf={winnerPerf} thumbs={o.thumbs} s={s} readOnly={readOnly} />
              : <Card><p className="text-sm text-[var(--muted)]">No ad has enough spend yet to call a winner.</p></Card>}
            <Moves root={root} report={o.report} readOnly={readOnly} />
          </div>
        )}

        {s && <Fingerprint s={s} root={root} />}

        {s && (
          <section>
            <SectionHead title="Where the money goes" link={<Link to={`${root}/library`} className="hover:text-[var(--text)]">All ads →</Link>} />
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {topBySpend(o.perf, 6).map((ad) => (
                <li key={ad.ad_id}>
                  <Link to={`${root}/ads/${ad.ad_id}`} className="group block">
                    <span className="relative block">
                      <AdThumb src={ad.thumbnail_path ? o.thumbs[ad.thumbnail_path] : undefined} video={ad.creative_type === 'video'}
                        className="aspect-[4/5] w-full rounded-xl border border-[var(--line)] transition group-hover:border-[var(--line-strong)]" />
                      <RoasChip roas={ad.roas} account={k?.roas ?? null} />
                    </span>
                    <span className="mt-2 block truncate text-sm">{ad.name ?? ad.external_id}</span>
                    <span className="block font-mono text-xs text-[var(--faint)]">{fmt.money(ad.spend)} · {Math.round((ad.spend / (s.account.spend || 1)) * 100)}% of spend</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {s && (
          <section className="grid gap-3 sm:grid-cols-3">
            <Signal to={`${root}/analysis`} icon={TrendingDown} tone="bad" n={new Set(s.fatigue.map((f) => f.ad_id)).size} label="ads fading" hint="Hook rate or CTR falling over time" />
            <Signal to={`${root}/analysis`} icon={Zap} tone="good" n={new Set(s.underfunded.map((u) => u.ad_id)).size} label="underfunded winners" hint="Beating the account on a small budget" />
            <Signal to={`${root}/analysis`} icon={TriangleAlert} tone="warn" n={new Set(s.outliers.filter((x) => x.metric === 'roas').map((x) => x.ad_id)).size} label="ROAS outliers" hint="Far from ads of the same format" />
          </section>
        )}

        <DataFooter o={o} synced={synced} lastSync={lastSync} />
      </div>
    </>
  )
}

function SectionHead({ title, link }: { title: string; link?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="text-sm font-medium text-[var(--muted)]">{title}</h2>
      {link && <span className="text-xs text-[var(--muted)]">{link}</span>}
    </div>
  )
}

function RoasChip({ roas, account }: { roas: number | null; account: number | null }) {
  if (roas == null) return null
  const up = account != null && roas >= account
  return (
    <span className={`absolute left-2 top-2 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium backdrop-blur ${up ? 'bg-[var(--good)]/20 text-[var(--good)]' : 'bg-black/50 text-[var(--text-2)]'}`}>
      {fmt.ratio(roas)}
    </span>
  )
}

/** Fastlane-style winner card: the creative, and each metric against the account. */
function WinnerSpotlight({ root, ad, perf, thumbs, s, readOnly }: {
  root: string
  ad: AdStats
  perf: AdPerf | undefined
  thumbs: Record<string, string>
  s: Snapshot
  readOnly: boolean
}) {
  const video = ad.creative_type === 'video'
  const tiles: { m: Metric; label: string; f: (v: number | null) => string; lowerIsBetter?: boolean }[] = [
    { m: 'roas', label: 'ROAS', f: fmt.ratio },
    { m: 'cpa', label: 'CPA', f: fmt.money, lowerIsBetter: true },
    { m: 'ctr', label: 'CTR', f: (v) => fmt.pct(v) },
    video ? { m: 'hook_rate', label: 'Hook rate', f: (v) => fmt.pct(v, 1) } : { m: 'cvr', label: 'Conv. rate', f: (v) => fmt.pct(v) },
  ]
  return (
    <Card pad={false} className="relative overflow-hidden">
      <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgb(144_133_233/0.16),transparent)]" aria-hidden />
      <div className="relative flex flex-col gap-5 p-5 sm:flex-row">
        <Link to={`${root}/ads/${ad.ad_id}`} className="shrink-0">
          <span className="relative block">
            <AdThumb src={perf?.thumbnail_path ? thumbs[perf.thumbnail_path] : undefined} video={video} className="aspect-[4/5] w-full rounded-xl sm:w-44" />
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--good)] backdrop-blur">
              <Trophy size={11} /> Winner
            </span>
          </span>
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-xs text-[var(--muted)]">Your most reliable winner</p>
          <Link to={`${root}/ads/${ad.ad_id}`} className="mt-1 truncate text-lg font-semibold tracking-tight hover:text-[var(--accent-2)]">{ad.name || ad.external_id}</Link>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>{video ? 'Video' : 'Static'}</Badge>
            {ad.format && <Badge>{ad.format}</Badge>}
            {ad.hook_type && <Badge tone="accent">{ad.hook_type} hook</Badge>}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2">
            {tiles.map((t) => {
              const v = ad.kpis[t.m]?.value ?? null
              const acct = s.account_kpis[t.m]
              const lift = v != null && acct ? v / acct - 1 : null
              const good = lift != null && (t.lowerIsBetter ? lift < 0 : lift > 0)
              return (
                <div key={t.m} className="rounded-lg border border-[var(--line)] bg-white/[0.02] px-3 py-2.5">
                  <dt className="text-[11px] text-[var(--faint)]">{t.label}</dt>
                  <dd className="mt-0.5 font-mono text-lg tabular-nums">{t.f(v)}</dd>
                  <p className="text-[11px] text-[var(--faint)]">
                    {lift != null && <span className={good ? 'text-[var(--good)]' : 'text-[var(--bad)]'}>{lift > 0 ? '+' : ''}{Math.round(lift * 100)}% </span>}
                    vs {t.f(acct)} account
                  </p>
                </div>
              )
            })}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {!readOnly && (
              <Link to={`${root}/briefs?from=${encodeURIComponent(ad.external_id)}`} className={buttonClass('accent', 'sm')}>
                <Sparkles size={13} /> Make variations
              </Link>
            )}
            <Link to={`${root}/ads/${ad.ad_id}`} className={buttonClass('secondary', 'sm')}>Breakdown <ArrowUpRight size={13} /></Link>
          </div>
        </div>
      </div>
    </Card>
  )
}

const MOVE: { key: 'double_down' | 'cut' | 'missing_concepts'; label: string; icon: LucideIcon; tone: string }[] = [
  { key: 'double_down', label: 'Scale', icon: TrendingUp, tone: 'text-[var(--good)] bg-[var(--good-soft)]' },
  { key: 'cut', label: 'Cut', icon: Scissors, tone: 'text-[var(--bad)] bg-[var(--bad-soft)]' },
  { key: 'missing_concepts', label: 'Test', icon: FlaskConical, tone: 'text-[var(--accent-2)] bg-[var(--accent-soft)]' },
]

/** The report's headline actions, so the dashboard says what to do, not just what happened. */
function Moves({ root, report, readOnly }: { root: string; report: ReportBrief | null; readOnly: boolean }) {
  const items = report
    ? MOVE.flatMap((m) => (report.content[m.key] ?? []).slice(0, m.key === 'missing_concepts' ? 1 : 2).map((c) => ({ ...m, claim: c.claim })))
    : []
  return (
    <Card className="flex flex-col">
      <CardTitle icon={<FileText size={15} />} aside={report && (
        report.grounding_passed
          ? <Badge tone="good"><ShieldCheck size={12} /> Every number verified</Badge>
          : <Badge tone="warn">Check flagged claims</Badge>
      )}>This week's moves</CardTitle>
      {items.length ? (
        <>
          <ul className="space-y-3">
            {items.map((it, i) => (
              <li key={i} className="flex gap-3">
                <span className={`mt-0.5 inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium ${it.tone}`}>
                  <it.icon size={12} /> {it.label}
                </span>
                <p className="line-clamp-2 text-sm leading-snug text-[var(--text-2)]">{it.claim}</p>
              </li>
            ))}
          </ul>
          <Link to={`${root}/report`} className="mt-auto inline-flex items-center gap-1 pt-4 text-sm text-[var(--accent-2)] hover:text-[var(--text)]">
            Full report, with the ads and numbers behind each <ArrowRight size={14} />
          </Link>
        </>
      ) : (
        <div className="flex flex-1 flex-col justify-center rounded-lg border border-dashed border-[var(--line-strong)] p-5 text-center">
          <Sparkles size={20} className="mx-auto text-[var(--accent-2)]" />
          <p className="mt-2 text-sm font-medium">{readOnly ? 'No report yet' : 'Get your first strategist report'}</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-[var(--muted)]">What to scale, what to cut and what to test next, with every claim tied to your ads.</p>
          {!readOnly && <Link to={`${root}/report`} className={`${buttonClass('accent', 'sm')} mx-auto mt-4`}>Generate report <ArrowRight size={13} /></Link>}
        </div>
      )}
    </Card>
  )
}

interface Fact { big: string; label: string; note?: string }

/** A few plain facts about how the account spends, computed from the tags. */
function fingerprint(s: Snapshot): Fact[] {
  const out: Fact[] = []
  const spend = s.account.spend || 1
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const top = (dim: string) => [...(s.tags[dim] ?? [])].sort((a, b) => b.spend_share - a.spend_share)[0]
  const fmtTop = top('format')
  if (fmtTop) out.push({ big: pct(fmtTop.spend_share), label: `of spend on ${fmtTop.value}` })
  const video = s.ads.filter((a) => a.creative_type === 'video').reduce((t, a) => t + a.totals.spend, 0) / spend
  out.push({ big: pct(video), label: 'of spend on video', note: `${pct(1 - video)} static` })
  const offers = (s.tags.offer ?? []).filter((t) => t.value !== 'none').reduce((t, x) => t + x.spend_share, 0)
  if (s.tags.offer) out.push({ big: pct(offers), label: 'offer-led', note: 'spend behind a discount or deal' })
  const bestHook = [...(s.tags.hook_type ?? [])]
    .filter((t) => t.verdict.roas === 'winner' && t.kpis.roas.value != null)
    .sort((a, b) => (b.kpis.roas.value ?? 0) - (a.kpis.roas.value ?? 0))[0]
  if (bestHook) out.push({ big: fmt.ratio(bestHook.kpis.roas.value), label: `ROAS on ${bestHook.value} hooks`, note: `vs ${fmt.ratio(s.account_kpis.roas)} account` })
  const noProof = (s.tags.proof_type ?? []).find((t) => t.value === 'none')
  if (noProof) out.push({ big: pct(noProof.spend_share), label: 'of spend with no proof', note: 'no reviews, stats or testimonials' })
  if (s.concepts) out.push({ big: s.concepts.diversity.toFixed(1), label: 'real concepts', note: `across ${s.concepts.n_creatives} creatives` })
  return out.slice(0, 6)
}

function Fingerprint({ s, root }: { s: Snapshot; root: string }) {
  const facts = fingerprint(s)
  if (!facts.length) return null
  return (
    <section>
      <SectionHead title="Your account at a glance" link={<Link to={`${root}/analysis`} className="hover:text-[var(--text)]">Analysis →</Link>} />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {facts.map((f) => (
          <div key={f.label} className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3.5">
            <dd className="font-mono text-2xl font-medium tracking-tight">{f.big}</dd>
            <dt className="mt-1 text-xs leading-snug text-[var(--text-2)]">{f.label}</dt>
            {f.note && <p className="mt-0.5 text-[11px] leading-snug text-[var(--faint)]">{f.note}</p>}
          </div>
        ))}
      </dl>
    </section>
  )
}

function Signal({ to, icon: Icon, tone, n, label, hint }: { to: string; icon: LucideIcon; tone: 'good' | 'bad' | 'warn'; n: number; label: string; hint: string }) {
  const color = { good: 'text-[var(--good)] bg-[var(--good-soft)]', bad: 'text-[var(--bad)] bg-[var(--bad-soft)]', warn: 'text-[var(--warn)] bg-[var(--warn-soft)]' }[tone]
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3.5 transition hover:border-[var(--line-strong)]">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${n ? color : 'bg-white/[0.04] text-[var(--faint)]'}`}><Icon size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm"><span className="font-mono font-medium">{n}</span> <span className="text-[var(--text-2)]">{label}</span></span>
        <span className="block truncate text-xs text-[var(--faint)]">{hint}</span>
      </span>
      <ArrowRight size={14} className="text-[var(--faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--text)]" />
    </Link>
  )
}

function GettingStarted({ root, o, onConnect, busy }: { root: string; o: Overview; onConnect: () => void; busy: boolean }) {
  const steps = [
    { done: o.sources.length > 0, label: 'Connect your Meta ad account', hint: 'Read-only. Mosaic never changes anything in it.' },
    { done: o.ads > 0, label: 'Import your ads', hint: '90 days of ads and results, synced every 4 hours.' },
    { done: !!o.snap, label: 'Review the analysis', hint: 'What wins, with low-spend luck shrunk out.', to: `${root}/analysis` },
    { done: !!o.report, label: 'Get your strategist report', hint: 'What to scale, cut and test next.', to: `${root}/report` },
  ]
  if (steps.every((s) => s.done)) return null
  const done = steps.filter((s) => s.done).length
  const current = steps.findIndex((s) => !s.done)
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(closest-side,rgb(144_133_233/0.2),transparent)]" aria-hidden />
      <CardTitle aside={`${done} of ${steps.length}`}>Set up Mosaic</CardTitle>
      <div className="mb-5 h-1 rounded-full bg-white/[0.06]">
        <div className="h-1 rounded-full bg-[var(--accent)] transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.label} className={`flex gap-2.5 text-sm ${i === current ? '' : 'opacity-80'}`}>
            {s.done ? <CircleCheck size={17} className="mt-0.5 shrink-0 text-[var(--good)]" /> : <CircleDashed size={17} className={`mt-0.5 shrink-0 ${i === current ? 'text-[var(--accent-2)]' : 'text-[var(--faint)]'}`} />}
            <span>
              <span className={s.done ? 'text-[var(--muted)] line-through decoration-[var(--faint)]' : 'font-medium'}>{s.label}</span>
              {!s.done && <span className="mt-0.5 block text-xs text-[var(--muted)]">{s.hint}</span>}
              {i === current && (i === 0
                ? <Button size="sm" variant="accent" className="mt-2.5" onClick={onConnect} disabled={busy}><Link2 size={13} /> Connect Meta</Button>
                : s.to && <Link to={s.to} className={`${buttonClass('accent', 'sm')} mt-2.5`}>Start <ArrowRight size={13} /></Link>)}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function DataFooter({ o, synced, lastSync }: { o: Overview; synced: boolean; lastSync: string | null | undefined }) {
  return (
    <details className="group rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 text-sm text-[var(--muted)]">
        <span className="flex-1 truncate">
          {o.sources.length ? o.sources.map((d) => SOURCE_LABEL[d.kind] ?? d.kind).join(' + ') : 'No data source'}
          {' · '}{o.ads} ads · {lastSync ? `synced ${ago(lastSync)}` : synced ? 'never synced' : 'fixed snapshot'}
        </span>
        <span className="text-xs group-open:hidden">Sync history</span>
        <span className="hidden text-xs group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-[var(--line)] p-4">
        {o.runs.length ? (
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
        ) : <p className="text-sm text-[var(--muted)]">No sync runs yet.</p>}
      </div>
    </details>
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
