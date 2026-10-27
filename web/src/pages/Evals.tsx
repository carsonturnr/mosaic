import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

interface EvalRun { id: string; suite: string; git_sha: string | null; metrics: Record<string, number>; created_at: string }

const PLANTED_LABELS: Record<string, string> = {
  winning_hook: 'Winning hook ranked first',
  fatigue_recall: 'Fading ads found',
  fatigue_precision: 'Fading flags that were real',
  hidden_winner: 'Hidden low-spend winner found',
  static_vs_video: 'Static vs video gap found',
  near_duplicates: 'Near-duplicates grouped',
  all_found: 'Seeds with every pattern found',
}

async function load(): Promise<EvalRun[]> {
  const { data, error } = await supabase.from('eval_runs').select('id, suite, git_sha, metrics, created_at')
    .order('created_at', { ascending: false }).limit(100)
  if (error) throw new Error(error.message)
  return data as unknown as EvalRun[]
}

const TAG_FIELDS: [string, string][] = [
  ['hook_type', 'Hook type'],
  ['angle', 'Angle'],
  ['format', 'Format'],
  ['offer', 'Offer'],
  ['proof_type', 'Proof'],
  ['cta', 'CTA'],
]

const pct = (v: number) => `${Math.round(v * 100)}%`
const sha = (s: string | null) => (s ? s.slice(0, 7) : '—')

export function Evals() {
  const runs = useAsync(load, [])
  const all = runs.data ?? []
  const planted = all.filter((r) => r.suite === 'planted')
  const grounding = all.find((r) => r.suite === 'grounding')
  const tagging = all.find((r) => r.suite === 'tagging')
  const latest = planted[0]

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Link to="/app" className="text-sm text-neutral-500 hover:text-neutral-900">← Workspaces</Link>
      <h1 className="mt-2 text-xl font-semibold">Evals</h1>
      <p className="mt-1 max-w-2xl text-sm text-neutral-600">
        How well Mosaic finds what's really in the data. Planted-problem scores run in CI on every change; a drop fails the build.
      </p>
      {runs.error && <p className="mt-4 text-sm text-red-700">{runs.error}</p>}

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Planted problems</h2>
          {latest && <span className="text-xs text-neutral-500">{new Date(latest.created_at).toLocaleString()} · {sha(latest.git_sha)} · {latest.metrics.seeds ?? '?'} synthetic accounts</span>}
        </div>
        {!latest ? <p className="text-sm text-neutral-500">No runs yet.</p> : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(PLANTED_LABELS).map(([k, label]) => {
              const v = latest.metrics[k]
              const ok = v === 1
              return (
                <div key={k} className={`rounded-lg border p-3 ${k === 'all_found' ? 'border-neutral-900' : 'border-neutral-200'}`}>
                  <dt className="text-xs text-neutral-500">{label}</dt>
                  <dd className="mt-0.5 flex items-center gap-1.5 text-lg font-semibold tabular-nums">
                    {v == null ? '—' : pct(v)}
                    {v != null && <span className={`text-xs ${ok ? 'text-emerald-600' : 'text-amber-600'}`} aria-label={ok ? 'pass' : 'below target'}>{ok ? '✓' : '!'}</span>}
                  </dd>
                </div>
              )
            })}
          </dl>
        )}
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-sm font-semibold">Grounding</h2>
          {grounding ? (
            <p className="mt-2 text-sm text-neutral-700">
              <span className="text-2xl font-semibold tabular-nums">{pct(grounding.metrics.grounding_pass_rate ?? 0)}</span> of {grounding.metrics.reports} reports
              had every cited number match the data ({grounding.metrics.numbers_checked} numbers checked).
            </p>
          ) : <p className="mt-2 text-sm text-neutral-500">No reports have been generated yet.</p>}
        </div>
        <div className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-sm font-semibold">Tagging accuracy</h2>
          {tagging ? (
            <>
              <p className="mt-1 text-xs text-neutral-500">
                AI tags vs blind hand labels on {tagging.metrics.ads} ads · mean F1 {(tagging.metrics.mean_f1 ?? 0).toFixed(2)}
              </p>
              <table className="mt-2 w-full text-sm">
                <thead className="text-xs text-neutral-500">
                  <tr><th className="py-1 text-left font-normal">Field</th><th className="text-right font-normal">Accuracy</th><th className="text-right font-normal">Macro F1</th></tr>
                </thead>
                <tbody>
                  {TAG_FIELDS.filter(([k]) => tagging.metrics[`${k}_f1`] != null).map(([k, label]) => (
                    <tr key={k} className="border-t border-neutral-100">
                      <td className="py-1">{label}</td>
                      <td className="text-right tabular-nums">{pct(tagging.metrics[`${k}_accuracy`] ?? 0)}</td>
                      <td className="text-right tabular-nums">{(tagging.metrics[`${k}_f1`] ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <p className="mt-2 text-sm text-neutral-500">Waiting for hand labels. Label ads from a workspace's Label tab; per-field F1 appears after the next eval run.</p>}
        </div>
      </section>

      {planted.length > 1 && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">History</h2>
          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr><th className="px-3 py-2 font-normal">When</th><th className="px-3 font-normal">Commit</th><th className="px-3 text-right font-normal">All found</th><th className="px-3 text-right font-normal">Fading precision</th></tr>
              </thead>
              <tbody>
                {planted.slice(0, 20).map((r) => (
                  <tr key={r.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono text-xs">{sha(r.git_sha)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(r.metrics.all_found ?? 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(r.metrics.fatigue_precision ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  )
}
