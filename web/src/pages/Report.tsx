import { Link, useParams } from 'react-router-dom'
import { WorkspaceNav } from '../components/WorkspaceNav'
import { fmt } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAgentJob } from '../lib/useAgentJob'
import { useAsync } from '../lib/useAsync'
import { useWorkspaceMode } from '../lib/workspaceBase'

// Mirrors worker/src/mosaic/agents/report.py
interface Cite { entity: string; metric: string; value: number; window: string }
interface Claim { claim: string; ad_ids: string[]; metrics: Cite[] }
interface StrategistReport { summary: string; working: Claim[]; double_down: Claim[]; cut: Claim[]; missing_concepts: Claim[] }
interface Meta {
  windows?: Record<string, string>
  turns?: number
  cost_usd?: number
  grounding?: { passed: boolean; checked_numbers: number; checked_ads: number; problems: { section: string; claim: string; issue: string }[] }
}
interface ReportRow { id: string; created_at: string; grounding_passed: boolean | null; model: string | null; content: StrategistReport; input_snapshot: Meta | null }

const SECTIONS: { key: keyof Omit<StrategistReport, 'summary'>; title: string; dot: string }[] = [
  { key: 'working', title: "What's working", dot: 'bg-emerald-500' },
  { key: 'double_down', title: 'Double down', dot: 'bg-[#2a78d6]' },
  { key: 'cut', title: 'Cut', dot: 'bg-red-500' },
  { key: 'missing_concepts', title: 'Missing concepts', dot: 'bg-amber-400' },
]
const MONEY = new Set(['spend', 'cpa'])
const RATE = new Set(['ctr', 'hook_rate', 'hold_rate', 'cvr', 'spend_share'])

function showValue(c: Cite): string {
  if (MONEY.has(c.metric)) return fmt.money(c.value)
  if (RATE.has(c.metric)) return fmt.pct(c.value)
  if (c.metric === 'roas') return fmt.ratio(c.value)
  return fmt.int(c.value)
}

function showEntity(e: string): string {
  if (e.startsWith('tag:')) return e.slice(4).replace('=', ': ')
  if (e.startsWith('ad:')) return e.slice(3)
  return e
}

async function load(id: string) {
  const [ws, reports, ads] = await Promise.all([
    supabase.from('workspaces').select('name').eq('id', id).single(),
    supabase.from('reports').select('id, created_at, grounding_passed, model, content, input_snapshot')
      .eq('workspace_id', id).eq('kind', 'strategist').order('created_at', { ascending: false }).limit(1),
    supabase.from('ads').select('id, external_id, name').eq('workspace_id', id),
  ])
  if (reports.error) throw new Error(reports.error.message)
  const byRef = new Map((ads.data ?? []).map((a) => [a.external_id, { id: a.id, name: a.name ?? a.external_id }]))
  return { name: ws.data?.name, report: (reports.data?.[0] ?? null) as unknown as ReportRow | null, byRef }
}

export function Report() {
  const { id = '' } = useParams<{ id: string }>()
  const { base, readOnly } = useWorkspaceMode()
  const data = useAsync(() => load(id), [id])
  const job = useAgentJob(id, 'strategist', data.reload)
  const busy = job.busy
  const error = job.error

  const r = data.data?.report
  const meta = r?.input_snapshot ?? {}
  const g = meta.grounding

  return (
    <main className="mx-auto max-w-4xl p-6">
      <WorkspaceNav id={id} name={data.data?.name ?? undefined} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Strategist report</h2>
          {r && (
            <p className="text-sm text-neutral-500">
              {new Date(r.created_at).toLocaleString()} · {r.model}
              {meta.cost_usd != null && ` · ${meta.turns} ${meta.turns === 1 ? 'turn' : 'turns'} · $${meta.cost_usd.toFixed(2)}`}
            </p>
          )}
        </div>
        {!readOnly && (
          <button type="button" onClick={() => void job.start()} disabled={busy}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50">
            {busy ? 'Writing report… (about a minute)' : r ? 'Regenerate' : 'Generate report'}
          </button>
        )}
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {data.loading && !data.data && <p className="text-sm text-neutral-500">Loading…</p>}
      {data.data && !r && (
        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-600">
          {readOnly ? 'No report has been written for this demo yet.' : 'No report yet. Generate one from the latest analysis.'}
        </div>
      )}

      {r && (
        <>
          <div className={`mb-6 flex items-start gap-2 rounded-md px-3 py-2 text-sm ${r.grounding_passed ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
            <span aria-hidden>{r.grounding_passed ? '✓' : '!'}</span>
            <div>
              {r.grounding_passed
                ? `Every cited number was checked against your data${g ? ` (${g.checked_numbers} numbers, ${g.checked_ads} ad references)` : ''}.`
                : 'Some cited numbers did not match the data after one retry. Treat the flagged claims with care.'}
              {!r.grounding_passed && g && g.problems.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {g.problems.slice(0, 6).map((p, i) => <li key={i}>{p.issue}</li>)}
                </ul>
              )}
            </div>
          </div>

          <p className="mb-8 text-[15px] leading-relaxed">{r.content.summary}</p>

          <div className="space-y-8">
            {SECTIONS.map((s) => (
              <section key={s.key}>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">
                  <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
                  {s.title}
                </h3>
                {r.content[s.key].length === 0 ? (
                  <p className="text-sm text-neutral-500">Nothing here this time.</p>
                ) : (
                  <ul className="space-y-3">
                    {r.content[s.key].map((c, i) => (
                      <li key={i} className="rounded-lg border border-neutral-200 p-4">
                        <p className="text-[15px] leading-relaxed">{c.claim}</p>
                        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                          {c.ad_ids.map((ref) => {
                            const ad = data.data!.byRef.get(ref)
                            return ad ? (
                              <Link key={ref} to={`${base}/w/${id}/ads/${ad.id}`} title={ad.name}
                                className="rounded border border-neutral-300 px-1.5 py-0.5 font-mono hover:bg-neutral-50">{ref}</Link>
                            ) : (
                              <span key={ref} className="rounded border border-red-200 px-1.5 py-0.5 font-mono text-red-700">{ref}</span>
                            )
                          })}
                          {c.metrics.map((m, j) => (
                            <span key={j} className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-700">
                              {showEntity(m.entity)} · {m.metric.replace('_', ' ')} {showValue(m)}
                              <span className="text-neutral-400"> · {m.window === 'all' ? 'all time' : `${m.window}d`}</span>
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  )
}
