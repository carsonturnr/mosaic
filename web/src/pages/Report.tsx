import { FileText, RefreshCw, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { AdRef, Button, Callout, EmptyState, ErrorText, Loading, PageHeader } from '../components/ui'
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
  { key: 'working', title: "What's working", dot: 'bg-[var(--good)]' },
  { key: 'double_down', title: 'Double down', dot: 'bg-[var(--accent-2)]' },
  { key: 'cut', title: 'Cut', dot: 'bg-[var(--bad)]' },
  { key: 'missing_concepts', title: 'Missing concepts', dot: 'bg-[var(--warn)]' },
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
  const [reports, ads] = await Promise.all([
    supabase.from('reports').select('id, created_at, grounding_passed, model, content, input_snapshot')
      .eq('workspace_id', id).eq('kind', 'strategist').order('created_at', { ascending: false }).limit(1),
    supabase.from('ads').select('id, external_id, name').eq('workspace_id', id),
  ])
  if (reports.error) throw new Error(reports.error.message)
  const byRef = new Map((ads.data ?? []).map((a) => [a.external_id, { id: a.id, name: a.name ?? a.external_id }]))
  return { report: (reports.data?.[0] ?? null) as unknown as ReportRow | null, byRef }
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
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Strategist report"
        description="What's working, what to double down on, what to cut and what's missing. Every number is checked against your data before it's saved."
        meta={r && `${new Date(r.created_at).toLocaleString()} · ${r.model ?? ''}${meta.cost_usd != null ? ` · ${meta.turns} ${meta.turns === 1 ? 'turn' : 'turns'} · $${meta.cost_usd.toFixed(2)}` : ''}`}
        actions={!readOnly && (
          <Button variant="primary" onClick={() => void job.start()} disabled={busy}>
            {busy ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {busy ? 'Writing… about a minute' : r ? 'Regenerate' : 'Generate report'}
          </Button>
        )}
      />

      <div className="space-y-6">
        <ErrorText>{error}</ErrorText>
        {data.loading && !data.data && <Loading />}
        {data.data && !r && (
          <EmptyState icon={<FileText size={18} />} title="No report yet">
            {readOnly ? 'No report has been written for this demo yet.' : 'Generate one from the latest analysis. It takes about a minute.'}
          </EmptyState>
        )}

        {r && (
          <>
            <Callout tone={r.grounding_passed ? 'good' : 'warn'} icon={r.grounding_passed ? <ShieldCheck size={16} className="text-[var(--good)]" /> : <TriangleAlert size={16} className="text-[var(--warn)]" />}>
              {r.grounding_passed
                ? <>Every cited number was checked against your data{g ? <> · <span className="font-mono">{g.checked_numbers}</span> numbers, <span className="font-mono">{g.checked_ads}</span> ad references</> : ''}.</>
                : 'Some cited numbers did not match the data after one retry. Treat the flagged claims with care.'}
              {!r.grounding_passed && g && g.problems.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {g.problems.slice(0, 6).map((p, i) => <li key={i}>{p.issue}</li>)}
                </ul>
              )}
            </Callout>

            <p className="text-lg leading-relaxed text-[var(--text)]">{r.content.summary}</p>

            <div className="space-y-10 pt-2">
              {SECTIONS.map((s) => (
                <section key={s.key}>
                  <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
                    {s.title}
                    <span className="font-mono font-normal text-[var(--faint)]">{r.content[s.key].length || ''}</span>
                  </h2>
                  {r.content[s.key].length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">Nothing here this time.</p>
                  ) : (
                    <ul className="space-y-3">
                      {r.content[s.key].map((c, i) => (
                        <li key={i} className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
                          <p className="text-[15px] leading-relaxed text-[var(--text)]">{c.claim}</p>
                          <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs">
                            {c.ad_ids.map((ref) => {
                              const ad = data.data!.byRef.get(ref)
                              return <AdRef key={ref} to={ad ? `${base}/w/${id}/ads/${ad.id}` : undefined} title={ad?.name}>{ref}</AdRef>
                            })}
                            {c.metrics.map((m, j) => (
                              <span key={j} className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[11px] text-[var(--text-2)]">
                                {showEntity(m.entity)} · {m.metric.replace('_', ' ')} <span className="font-mono text-[var(--text)]">{showValue(m)}</span>
                                <span className="text-[var(--faint)]"> · {m.window === 'all' ? 'all time' : `${m.window}d`}</span>
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
      </div>
    </div>
  )
}
