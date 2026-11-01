import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LineChart } from '../components/LineChart'
import { BarChart3, Info, Shapes, TrendingDown, TriangleAlert, Zap } from 'lucide-react'
import { Badge, Card, CardTitle, EmptyState, ErrorText, Loading, PageHeader, SectionTitle, Segmented, Stat, type Tone } from '../components/ui'
import {
  dimensionReference,
  fetchSnapshot,
  type AdStats,
  type Est,
  type Metric,
  type Snapshot,
  type TagValueStats,
  type Verdict,
  type WindowKey,
} from '../lib/analysis'
import { fmt } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useWorkspaceMode } from '../lib/workspaceBase'

const METRICS: { key: Metric; label: string; format: (v: number) => string; video?: boolean }[] = [
  { key: 'roas', label: 'ROAS', format: (v) => fmt.ratio(v) },
  { key: 'cpa', label: 'CPA', format: (v) => fmt.money(v) },
  { key: 'ctr', label: 'CTR', format: (v) => fmt.pct(v) },
  { key: 'hook_rate', label: 'Hook rate', format: (v) => fmt.pct(v, 1), video: true },
  { key: 'hold_rate', label: 'Hold rate', format: (v) => fmt.pct(v, 1), video: true },
  { key: 'cvr', label: 'CVR', format: (v) => fmt.pct(v) },
]
const DIMENSIONS: { key: string; label: string }[] = [
  { key: 'hook_type', label: 'Hook' },
  { key: 'angle', label: 'Angle' },
  { key: 'format', label: 'Format' },
  { key: 'creative_type', label: 'Static vs video' },
  { key: 'offer', label: 'Offer' },
  { key: 'proof_type', label: 'Proof' },
  { key: 'persona', label: 'Persona' },
  { key: 'length_bucket', label: 'Length' },
]
const TREND_METRICS = new Set<Metric>(['roas', 'ctr', 'hook_rate'])
const VERDICT_TONE: Record<Exclude<Verdict, 'neutral'>, Tone> = { winner: 'good', loser: 'bad', low_data: 'neutral' }
const VERDICT_LABEL: Record<Verdict, string> = { winner: 'Winner', loser: 'Below average', neutral: '—', low_data: 'Low data' }

export function Analysis() {
  const { id = '' } = useParams<{ id: string }>()
  const [win, setWin] = useState<WindowKey>('30')
  const [metric, setMetric] = useState<Metric>('roas')
  const [dim, setDim] = useState('hook_type')
  const [selected, setSelected] = useState<string | null>(null)

  const snap = useAsync(() => fetchSnapshot(id, win), [id, win])
  const s = snap.data?.payload
  const m = METRICS.find((x) => x.key === metric)!
  const rows = useMemo(() => s?.tags[dim] ?? [], [s, dim])
  const ref = useMemo(() => dimensionReference(rows, metric), [rows, metric])
  const adsById = useMemo(() => new Map((s?.ads ?? []).map((a) => [a.ad_id, a])), [s])
  const trendValue = selected && rows.some((r) => r.value === selected) ? selected : rows[0]?.value
  const trend = (s?.trends[dim]?.[trendValue ?? ''] ?? []).map((p) => ({
    date: p.week,
    value: TREND_METRICS.has(metric) ? (p[metric as 'roas' | 'ctr' | 'hook_rate'] ?? null) : null,
  }))

  return (
    <>
      <PageHeader
        title="Analysis"
        description="Which hooks, angles and formats win, with confidence. Low-spend ads are pulled toward the average so they can't win by luck."
        meta={snap.data && `${snap.data.since} to ${snap.data.until} · updated ${new Date(snap.data.computed_at).toLocaleString()}`}
        actions={
          <>
            <Segmented label="Window" value={win} onChange={setWin}
              options={[['7', '7d'], ['30', '30d'], ['90', '90d'], ['all', 'All']] as const} />
          </>
        }
      />

      {snap.error && <ErrorText>{snap.error}</ErrorText>}
      {snap.loading && !snap.data && <Loading />}
      {!snap.loading && !snap.data && !snap.error && (
        <EmptyState icon={<BarChart3 size={18} />} title="No analysis yet">
          It runs after each sync. Use Refresh on the Overview page.
        </EmptyState>
      )}

      {s && (
        <div className="space-y-8">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="Spend" value={fmt.money(s.account.spend)} />
            {METRICS.map((x) => (
              <button key={x.key} type="button" onClick={() => setMetric(x.key)} className="text-left" aria-pressed={x.key === metric}>
                <Stat label={x.label} value={s.account_kpis[x.key] == null ? '—' : x.format(s.account_kpis[x.key]!)} active={x.key === metric} />
              </button>
            ))}
          </dl>

          <Signals snap={s} adsById={adsById} workspaceId={id} />

          <section>
            <SectionTitle aside={
              <div className="flex flex-wrap gap-1" role="tablist" aria-label="Dimension">
                {DIMENSIONS.filter((d) => s.tags[d.key]?.length).map((d) => (
                  <button key={d.key} type="button" role="tab" aria-selected={d.key === dim}
                    onClick={() => { setDim(d.key); setSelected(null) }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${d.key === dim ? 'bg-white/[0.09] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
                    {d.label}
                  </button>
                ))}
              </div>
            }>{m.label} by tag</SectionTitle>
            <TagTable rows={rows} metric={metric} format={m.format} reference={ref}
              selected={trendValue ?? null} onSelect={setSelected} />
            <p className="mt-2.5 flex items-start gap-1.5 text-xs text-[var(--faint)]">
              <Info size={13} className="mt-px shrink-0" />
              Dots are shrunk estimates with 90% intervals; the dashed line is the average of ads with this tag. Winners clear the line with their whole interval and by at least 10%. Click a row for its weekly trend.
            </p>
          </section>

          {TREND_METRICS.has(metric) && trendValue && (
            <Card>
              <CardTitle aside={trendValue}>Weekly {m.label}</CardTitle>
              <LineChart points={trend} format={m.format} label={m.label} height={200} />
            </Card>
          )}

          {s.concepts && s.concepts.clusters.length > 0 && <ConceptsPanel concepts={s.concepts} />}
        </div>
      )}
    </>
  )
}

function TagTable({ rows, metric, format, reference, selected, onSelect }: {
  rows: TagValueStats[]
  metric: Metric
  format: (v: number) => string
  reference: number | null
  selected: string | null
  onSelect: (v: string) => void
}) {
  const sorted = [...rows].sort((a, b) => {
    const low = (r: TagValueStats) => (r.verdict[metric] === 'low_data' ? 1 : 0)
    const v = (r: TagValueStats) => r.kpis[metric].value ?? (metric === 'cpa' ? Infinity : -Infinity)
    return low(a) - low(b) || (metric === 'cpa' ? v(a) - v(b) : v(b) - v(a))
  })
  const vals = rows.flatMap((r) => [r.kpis[metric].low, r.kpis[metric].high]).filter((x): x is number => x != null)
  if (reference != null) vals.push(reference)
  const lo = Math.min(...vals, Infinity)
  const hi = Math.max(...vals, -Infinity)
  const pad = (hi - lo) * 0.08 || 1
  const [min, max] = [Math.max(0, lo - pad), hi + pad]
  const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`

  if (sorted.every((r) => r.kpis[metric].value == null)) {
    return <p className="text-sm text-[var(--muted)]">No ads with this tag report {metric.replace('_', ' ')}.</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-[var(--faint)]">
          <tr>
            <th className="px-4 py-2.5 font-normal">Value</th>
            <th className="px-4 py-2.5 text-right font-normal">Ads</th>
            <th className="px-4 py-2.5 text-right font-normal">Spend</th>
            <th className="w-[38%] px-4 py-2.5 font-normal">Estimate and 90% interval</th>
            <th className="px-4 py-2.5 text-right font-normal">Estimate</th>
            <th className="px-4 py-2.5 font-normal">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const e: Est = r.kpis[metric]
            const v = r.verdict[metric]
            const muted = v === 'low_data'
            return (
              <tr key={r.value} onClick={() => onSelect(r.value)}
                className={`cursor-pointer border-t border-[var(--line)] transition hover:bg-[var(--hover)] ${selected === r.value ? 'bg-white/[0.05]' : ''}`}>
                <td className={`px-4 py-2.5 font-medium ${muted ? 'text-[var(--muted)]' : ''}`}>{r.value}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--muted)]">{r.n_ads}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--muted)]">
                  {fmt.money(r.totals.spend)} <span className="text-[var(--faint)]">· {fmt.pct(r.spend_share, 0)}</span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="relative h-5" role="img"
                    aria-label={e.value == null ? 'no data' : `${format(e.value)}, interval ${e.low == null ? '—' : format(e.low)} to ${e.high == null ? '—' : format(e.high)}`}>
                    <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.06]" />
                    {reference != null && (
                      <div className="absolute inset-y-0 border-l border-dashed border-white/30" style={{ left: pos(reference) }} />
                    )}
                    {e.low != null && e.high != null && (
                      <div className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full ${muted ? 'bg-white/10' : 'bg-[var(--accent)]/35'}`}
                        style={{ left: pos(e.low), width: `calc(${pos(e.high)} - ${pos(e.low)})` }} />
                    )}
                    {e.value != null && (
                      <div className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--panel)] ${muted ? 'bg-white/30' : 'bg-[var(--accent-2)]'}`}
                        style={{ left: pos(e.value) }} />
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{e.value == null ? '—' : format(e.value)}</td>
                <td className="px-4 py-2.5">
                  {v === 'neutral' ? <span className="text-[var(--faint)]">—</span> : <Badge tone={VERDICT_TONE[v]}>{VERDICT_LABEL[v]}</Badge>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Signals({ snap, adsById, workspaceId }: {
  snap: Snapshot
  adsById: Map<string, AdStats>
  workspaceId: string
}) {
  const { base } = useWorkspaceMode()
  const name = (id: string) => adsById.get(id)?.name ?? id
  const link = (id: string) => `${base}/w/${workspaceId}/ads/${id}`
  const fatigue = dedupe(snap.fatigue, (f) => f.ad_id)
  const under = dedupe(snap.underfunded, (u) => u.ad_id)
  const outliers = dedupe(snap.outliers.filter((o) => o.metric === 'roas'), (o) => o.ad_id)
  const cards = [
    {
      title: 'Fading', icon: <TrendingDown size={15} />, tone: 'bad' as Tone, empty: 'No ads are fading.', items: fatigue.map((f) => ({
        id: f.ad_id, text: `${f.metric === 'ctr' ? 'CTR' : 'Hook rate'} ${fmt.pct(f.early, 2)} → ${fmt.pct(f.late, 2)} (${fmt.pct(f.change, 0)})`,
      })),
    },
    {
      title: 'Underfunded winners', icon: <Zap size={15} />, tone: 'good' as Tone, empty: 'None right now.', items: under.map((u) => ({
        id: u.ad_id, text: `${u.metric.toUpperCase()} beats its type by ${fmt.pct((u.low - u.account) / u.account, 0)}+ on ${fmt.pct(u.spend_share, 1)} of spend`,
      })),
    },
    {
      title: 'ROAS outliers', icon: <TriangleAlert size={15} />, tone: 'warn' as Tone, empty: 'No outliers vs. peers.', items: outliers.map((o) => ({
        id: o.ad_id, text: `${o.direction === 'high' ? 'Above' : 'Below'} ${peerLabel(o.peer_group)} (z ${o.z > 0 ? '+' : ''}${o.z.toFixed(1)})`,
      })),
    },
  ]
  return (
    <section className="grid gap-4 md:grid-cols-3">
      {cards.map((c) => (
        <Card key={c.title}>
          <CardTitle icon={c.icon} aside={c.items.length > 0 && <Badge tone={c.tone}>{c.items.length}</Badge>}>{c.title}</CardTitle>
          {c.items.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{c.empty}</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {c.items.slice(0, 5).map((it) => (
                <li key={it.id}>
                  <Link to={link(it.id)} className="block truncate font-medium hover:text-[var(--accent-2)]">{name(it.id)}</Link>
                  <p className="mt-0.5 font-mono text-[11px] text-[var(--muted)]">{it.text}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </section>
  )
}

function ConceptsPanel({ concepts }: { concepts: NonNullable<Snapshot['concepts']> }) {
  const top = concepts.clusters.slice(0, 8)
  return (
    <Card>
      <div className="grid gap-8 md:grid-cols-[240px_1fr]">
        <div>
          <CardTitle icon={<Shapes size={15} />}>Concept diversity</CardTitle>
          <p className="font-mono text-5xl font-medium tracking-tight text-[var(--accent-2)]">{concepts.diversity.toFixed(1)}</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
            real concepts by spend, from {concepts.n_creatives} creatives in {concepts.clusters.length} groups. Near-duplicates count once.
          </p>
        </div>
        <ul className="space-y-3 self-center">
          {top.map((c) => (
            <li key={c.label + c.creative_ids[0]}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate text-[var(--text-2)]">
                  {c.label} <span className="text-[var(--faint)]">· {c.creative_ids.length} {c.creative_ids.length === 1 ? 'creative' : 'creatives'}</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-[var(--muted)]">{fmt.pct(c.spend_share, 0)}</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.06]">
                <div className="h-1.5 rounded-full bg-gradient-to-r from-[var(--v2,#4a3fa0)] to-[var(--accent-2)]" style={{ width: `${Math.max(1, c.spend_share * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

/** 'UGC · OUTCOME_SALES' → 'UGC peers'; 'account' → 'the account'. */
function peerLabel(group: string): string {
  if (group === 'account') return 'the account'
  return `${group.split(' · ')[0]} peers`
}

function dedupe<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((i) => (seen.has(key(i)) ? false : (seen.add(key(i)), true)))
}
