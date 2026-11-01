import { Check, ShieldCheck, Tags } from 'lucide-react'
import { Card, CardTitle, ErrorText, Loading, PageHeader, SectionTitle, Stat, Table } from '../components/ui'
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
    <>
      <PageHeader title="Evals"
        description="How well Mosaic finds what's really in the data. Planted-problem scores run in CI on every change; a drop fails the build." />
      {runs.error && <ErrorText>{runs.error}</ErrorText>}
      {runs.loading && !runs.data && <Loading />}

      <div className="space-y-8">
        <section>
          <SectionTitle aside={latest && <span className="text-xs text-[var(--faint)]">{new Date(latest.created_at).toLocaleString()} · <span className="font-mono">{sha(latest.git_sha)}</span> · {latest.metrics.seeds ?? '?'} synthetic accounts</span>}>
            Planted problems
          </SectionTitle>
          {!latest ? <p className="text-sm text-[var(--muted)]">No runs yet.</p> : (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(PLANTED_LABELS).map(([k, label]) => {
                const v = latest.metrics[k]
                return (
                  <Stat key={k} label={label} active={k === 'all_found'} tone={v == null ? undefined : v === 1 ? 'good' : 'bad'}
                    value={<span className="flex items-center gap-1.5">{v == null ? '—' : pct(v)}{v === 1 && <Check size={15} aria-label="pass" />}</span>} />
                )
              })}
            </dl>
          )}
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardTitle icon={<ShieldCheck size={15} />}>Grounding</CardTitle>
            {grounding ? (
              <>
                <p className="font-mono text-4xl font-medium tracking-tight text-[var(--good)]">{pct(grounding.metrics.grounding_pass_rate ?? 0)}</p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                  of {grounding.metrics.reports} reports had every cited number match the data ({grounding.metrics.numbers_checked} numbers checked).
                </p>
              </>
            ) : <p className="text-sm text-[var(--muted)]">No reports have been generated yet.</p>}
          </Card>
          <Card>
            <CardTitle icon={<Tags size={15} />} aside={tagging && `${tagging.metrics.ads} ads`}>Tagging accuracy</CardTitle>
            {tagging ? (
              <>
                <p className="text-xs text-[var(--muted)]">
                  AI tags vs. blind hand labels · mean F1 <span className="font-mono text-[var(--text)]">{(tagging.metrics.mean_f1 ?? 0).toFixed(2)}</span>
                </p>
                <ul className="mt-4 space-y-2.5">
                  {TAG_FIELDS.filter(([k]) => tagging.metrics[`${k}_f1`] != null).map(([k, label]) => {
                    const acc = tagging.metrics[`${k}_accuracy`] ?? 0
                    return (
                      <li key={k} className="grid grid-cols-[80px_1fr_44px_40px] items-center gap-3 text-sm">
                        <span className="text-[var(--text-2)]">{label}</span>
                        <span className="h-1.5 rounded-full bg-white/[0.06]">
                          <span className="block h-1.5 rounded-full bg-[var(--accent)]" style={{ width: `${acc * 100}%` }} />
                        </span>
                        <span className="text-right font-mono text-xs">{pct(acc)}</span>
                        <span className="text-right font-mono text-xs text-[var(--faint)]" title="Macro F1">{(tagging.metrics[`${k}_f1`] ?? 0).toFixed(2)}</span>
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-3 text-[11px] text-[var(--faint)]">Bar: accuracy. Right: macro F1.</p>
              </>
            ) : <p className="text-sm text-[var(--muted)]">Waiting for hand labels. Label ads from a workspace's Label page; per-field F1 appears after the next eval run.</p>}
          </Card>
        </section>

        {planted.length > 1 && (
          <section>
            <SectionTitle>History</SectionTitle>
            <Table>
              <thead><tr><th>When</th><th>Commit</th><th className="text-right">All found</th><th className="text-right">Fading precision</th></tr></thead>
              <tbody>
                {planted.slice(0, 20).map((r) => (
                  <tr key={r.id}>
                    <td className="text-[var(--text-2)]">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="font-mono text-xs text-[var(--muted)]">{sha(r.git_sha)}</td>
                    <td className="text-right font-mono">{pct(r.metrics.all_found ?? 0)}</td>
                    <td className="text-right font-mono">{pct(r.metrics.fatigue_precision ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        )}
      </div>
    </>
  )
}
