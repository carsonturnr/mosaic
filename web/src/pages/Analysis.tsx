import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LineChart } from '../components/LineChart'
import { WorkspaceNav } from '../components/WorkspaceNav'
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
import { supabase } from '../lib/supabase'
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
const VERDICT_STYLE: Record<Verdict, string> = {
  winner: 'bg-emerald-50 text-emerald-800',
  loser: 'bg-red-50 text-red-800',
  neutral: 'text-neutral-400',
  low_data: 'bg-neutral-100 text-neutral-500',
}
const VERDICT_LABEL: Record<Verdict, string> = { winner: 'Winner', loser: 'Below average', neutral: '—', low_data: 'Low data' }

export function Analysis() {
  const { id = '' } = useParams<{ id: string }>()
  const [win, setWin] = useState<WindowKey>('30')
  const [metric, setMetric] = useState<Metric>('roas')
  const [dim, setDim] = useState('hook_type')
  const [selected, setSelected] = useState<string | null>(null)

  const ws = useAsync(async () => (await supabase.from('workspaces').select('name').eq('id', id).single()).data?.name, [id])
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
    <main className="mx-auto max-w-6xl p-6">
      <WorkspaceNav id={id} name={ws.data ?? undefined} />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-3 text-sm">
          <Segmented label="Window" value={win} onChange={(v) => setWin(v as WindowKey)}
            options={[['7', '7d'], ['30', '30d'], ['90', '90d'], ['all', 'All']]} />
          <Segmented label="Metric" value={metric} onChange={(v) => setMetric(v as Metric)}
            options={METRICS.map((x): [string, string] => [x.key, x.label])} />
        </div>
        {snap.data && (
          <p className="text-xs text-neutral-500">
            {snap.data.since} → {snap.data.until} · updated {new Date(snap.data.computed_at).toLocaleString()}
          </p>
        )}
      </div>

      {snap.error && <p className="text-sm text-red-700">{snap.error}</p>}
      {snap.loading && !snap.data && <p className="text-sm text-neutral-500">Loading…</p>}
      {!snap.loading && !snap.data && !snap.error && (
        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-600">
          No analysis yet. It runs after each sync; use Refresh on the Overview tab.
        </div>
      )}

      {s && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Kpi label="Spend" value={fmt.money(s.account.spend)} />
            {METRICS.map((x) => (
              <Kpi key={x.key} label={x.label} value={s.account_kpis[x.key] == null ? '—' : x.format(s.account_kpis[x.key]!)} active={x.key === metric} />
            ))}
          </dl>

          <Signals snap={s} adsById={adsById} workspaceId={id} />

          {s.concepts && s.concepts.clusters.length > 0 && <ConceptsPanel concepts={s.concepts} />}

          <section className="mt-10">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{m.label} by tag</h2>
              <div className="flex flex-wrap gap-1 text-sm" role="tablist" aria-label="Dimension">
                {DIMENSIONS.filter((d) => s.tags[d.key]?.length).map((d) => (
                  <button key={d.key} type="button" role="tab" aria-selected={d.key === dim}
                    onClick={() => { setDim(d.key); setSelected(null) }}
                    className={`rounded-md px-2.5 py-1 ${d.key === dim ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <TagTable rows={rows} metric={metric} format={m.format} reference={ref}
              selected={trendValue ?? null} onSelect={setSelected} />
            <p className="mt-2 text-xs text-neutral-500">
              Dots are shrunk estimates with 90% intervals; the dashed line is the average of ads with this tag.
              Winners clear the line with their whole interval and by at least 10%.
            </p>
          </section>

          {TREND_METRICS.has(metric) && trendValue && (
            <section className="mt-10">
              <h2 className="mb-2 text-base font-semibold">
                Weekly {m.label} · <span className="font-normal text-neutral-600">{trendValue}</span>
              </h2>
              <LineChart points={trend} format={m.format} label={m.label} height={200} />
            </section>
          )}
        </>
      )}
    </main>
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
    return <p className="text-sm text-neutral-500">No ads with this tag report {metric.replace('_', ' ')}.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-neutral-50 text-xs text-neutral-500">
          <tr>
            <th className="px-3 py-2 font-normal">Value</th>
            <th className="px-3 py-2 text-right font-normal">Ads</th>
            <th className="px-3 py-2 text-right font-normal">Spend</th>
            <th className="w-[38%] px-3 py-2 font-normal">Estimate and 90% interval</th>
            <th className="px-3 py-2 text-right font-normal">Estimate</th>
            <th className="px-3 py-2 font-normal">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const e: Est = r.kpis[metric]
            const v = r.verdict[metric]
            const muted = v === 'low_data'
            return (
              <tr key={r.value} onClick={() => onSelect(r.value)}
                className={`cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 ${selected === r.value ? 'bg-neutral-50' : ''}`}>
                <td className={`px-3 py-2 font-medium ${muted ? 'text-neutral-500' : ''}`}>{r.value}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{r.n_ads}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-600">
                  {fmt.money(r.totals.spend)} <span className="text-neutral-400">· {fmt.pct(r.spend_share, 0)}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="relative h-5" role="img"
                    aria-label={e.value == null ? 'no data' : `${format(e.value)}, interval ${e.low == null ? '—' : format(e.low)} to ${e.high == null ? '—' : format(e.high)}`}>
                    <div className="absolute inset-x-0 top-1/2 h-px bg-neutral-100" />
                    {reference != null && (
                      <div className="absolute inset-y-0 border-l border-dashed border-neutral-400" style={{ left: pos(reference) }} />
                    )}
                    {e.low != null && e.high != null && (
                      <div className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full ${muted ? 'bg-neutral-200' : 'bg-[#2a78d6]/30'}`}
                        style={{ left: pos(e.low), width: `calc(${pos(e.high)} - ${pos(e.low)})` }} />
                    )}
                    {e.value != null && (
                      <div className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${muted ? 'bg-neutral-400' : 'bg-[#2a78d6]'}`}
                        style={{ left: pos(e.value) }} />
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{e.value == null ? '—' : format(e.value)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${VERDICT_STYLE[v]}`}>{VERDICT_LABEL[v]}</span>
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
      title: 'Fading', empty: 'No ads are fading.', items: fatigue.map((f) => ({
        id: f.ad_id, text: `${f.metric === 'ctr' ? 'CTR' : 'Hook rate'} ${fmt.pct(f.early, 2)} → ${fmt.pct(f.late, 2)} (${fmt.pct(f.change, 0)})`,
      })),
    },
    {
      title: 'Underfunded winners', empty: 'None right now.', items: under.map((u) => ({
        id: u.ad_id, text: `${u.metric.toUpperCase()} beats its type by ${fmt.pct((u.low - u.account) / u.account, 0)}+ on ${fmt.pct(u.spend_share, 1)} of spend`,
      })),
    },
    {
      title: 'ROAS outliers', empty: 'No outliers vs. peers.', items: outliers.map((o) => ({
        id: o.ad_id, text: `${o.direction === 'high' ? 'Above' : 'Below'} ${peerLabel(o.peer_group)} (z ${o.z > 0 ? '+' : ''}${o.z.toFixed(1)})`,
      })),
    },
  ]
  return (
    <section className="mt-8 grid gap-4 md:grid-cols-3">
      {cards.map((c) => (
        <div key={c.title} className="rounded-lg border border-neutral-200 p-4">
          <h3 className="text-sm font-semibold">{c.title} <span className="font-normal text-neutral-400">{c.items.length || ''}</span></h3>
          {c.items.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">{c.empty}</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {c.items.slice(0, 5).map((it) => (
                <li key={it.id}>
                  <Link to={link(it.id)} className="block truncate font-medium hover:underline">{name(it.id)}</Link>
                  <p className="text-xs text-neutral-600">{it.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  )
}

function ConceptsPanel({ concepts }: { concepts: NonNullable<Snapshot['concepts']> }) {
  const top = concepts.clusters.slice(0, 6)
  return (
    <section className="mt-10 grid gap-6 rounded-lg border border-neutral-200 p-5 md:grid-cols-[220px_1fr]">
      <div>
        <h2 className="text-base font-semibold">Concept diversity</h2>
        <p className="mt-3 text-4xl font-semibold tabular-nums">{concepts.diversity.toFixed(1)}</p>
        <p className="mt-1 text-sm text-neutral-600">
          effective concepts, by spend, from {concepts.n_creatives} creatives in {concepts.clusters.length} groups.
        </p>
      </div>
      <ul className="space-y-2.5">
        {top.map((c) => (
          <li key={c.label + c.creative_ids[0]}>
            <div className="flex justify-between gap-3 text-sm">
              <span className="truncate">
                {c.label} <span className="text-neutral-400">· {c.creative_ids.length} {c.creative_ids.length === 1 ? 'creative' : 'creatives'}</span>
              </span>
              <span className="shrink-0 tabular-nums text-neutral-600">{fmt.pct(c.spend_share, 0)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-neutral-100">
              <div className="h-1.5 rounded-full bg-[#2a78d6]" style={{ width: `${Math.max(1, c.spend_share * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
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

function Kpi({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${active ? 'border-neutral-900' : 'border-neutral-200'}`}>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function Segmented({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string][]
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-neutral-500">{label}</span>
      <div className="flex gap-0.5 rounded-md bg-neutral-100 p-0.5" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={v === value} onClick={() => onChange(v)}
            className={`rounded px-2.5 py-1 text-sm ${v === value ? 'bg-white font-medium shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}
