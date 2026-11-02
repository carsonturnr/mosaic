import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Download, Image as ImageIcon, PenLine, Quote, RefreshCw, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react'
import { AdRef, Badge, Button, Callout, Card, CardTitle, EmptyState, ErrorText, Loading, PageHeader, SectionTitle, Table } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAgentJob } from '../lib/useAgentJob'
import { useAsync } from '../lib/useAsync'
import { useWorkspaceMode } from '../lib/workspaceBase'

// Mirrors worker/src/mosaic/agents/briefs.py
interface Beat { seconds: string; visual: string; voiceover: string; on_screen_text: string }
interface Brief {
  title: string; based_on_ads: string[]; why: string; hook_type: string; angle: string; format: string
  persona: string; length_seconds: number; hook_line: string; script: Beat[]; cta: string
}
interface StaticDirection { title: string; headline: string; visual: string; primary_text: string }
interface TestRow { brief_title: string; hypothesis: string; primary_metric: string; daily_budget_usd: number; days: number; success_criterion: string }
interface BriefSet { briefs: Brief[]; hook_list: string[]; static_directions: StaticDirection[]; test_plan: TestRow[] }
interface Row { id: string; created_at: string; grounding_passed: boolean | null; content: BriefSet; input_snapshot: { request?: string | null; cost_usd?: number } | null }

async function load(id: string) {
  const [rows, ads] = await Promise.all([
    supabase.from('reports').select('id, created_at, grounding_passed, content, input_snapshot')
      .eq('workspace_id', id).eq('kind', 'brief').order('created_at', { ascending: false }).limit(1),
    supabase.from('ads').select('id, external_id').eq('workspace_id', id),
  ])
  if (rows.error) throw new Error(rows.error.message)
  return {
    row: (rows.data?.[0] ?? null) as unknown as Row | null,
    byRef: new Map((ads.data ?? []).map((a) => [a.external_id, a.id])),
  }
}

function csv(rows: TestRow[]): string {
  const cols: (keyof TestRow)[] = ['brief_title', 'hypothesis', 'primary_metric', 'daily_budget_usd', 'days', 'success_criterion']
  const esc = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

export function Briefs() {
  const { id = '' } = useParams<{ id: string }>()
  const { base, readOnly } = useWorkspaceMode()
  const data = useAsync(() => load(id), [id])
  const [params] = useSearchParams()
  const from = params.get('from')
  // "Make variations" on a winning ad lands here with that ad prefilled
  const [request, setRequest] = useState(from
    ? `Variations of ad ${from}: keep what makes it win, and test new hooks, creators and formats around it.`
    : '')
  const job = useAgentJob(id, 'brief', data.reload)
  const busy = job.busy
  const error = job.error

  const row = data.data?.row
  const set = row?.content

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Briefs"
        description="Scripts, hook lines, static directions and a test plan, built from what's winning in this account."
        meta={row && <>
          {new Date(row.created_at).toLocaleString()}
          {row.input_snapshot?.request ? ` · “${row.input_snapshot.request}”` : ''}
        </>}
      />

      <div className="space-y-6">
        {!readOnly && (
          <Card>
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">What should the next round focus on? <span className="font-normal text-[var(--faint)]">Optional</span></span>
              <textarea rows={2} value={request} onChange={(e) => setRequest(e.target.value)}
                placeholder="e.g. Iterate on our best UGC hook and try one comparison angle."
                className="px-3 py-2 text-sm" />
            </label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[var(--muted)]">
                Follows your brand guidelines from <Link to={`/app/w/${id}/settings`} className="text-[var(--accent-2)] hover:text-[var(--text)]">Settings</Link> and the latest report.
              </p>
              <Button variant="primary" onClick={() => void job.start(request.trim() || undefined)} disabled={busy}>
                {busy ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {busy ? 'Writing… about two minutes' : 'Write briefs'}
              </Button>
            </div>
            {error && <div className="mt-3"><ErrorText>{error}</ErrorText></div>}
          </Card>
        )}

        {data.loading && !data.data && <Loading />}
        {data.data && !set && (
          <EmptyState icon={<PenLine size={18} />} title="No briefs yet">
            {readOnly ? 'No briefs have been written for this demo yet.' : 'Write a set from the latest analysis.'}
          </EmptyState>
        )}

        {row && set && (
          <>
            <Callout tone={row.grounding_passed ? 'good' : 'warn'} icon={row.grounding_passed ? <ShieldCheck size={16} className="text-[var(--good)]" /> : <TriangleAlert size={16} className="text-[var(--warn)]" />}>
              {row.grounding_passed ? 'The evidence behind each brief was checked against your data.' : 'Some evidence did not match the data.'}
            </Callout>

            {set.briefs.map((b, i) => (
              <article key={i} className="rounded-xl border border-[var(--line)] bg-[var(--panel)]">
                <div className="p-5">
                  <p className="font-mono text-[11px] text-[var(--accent-2)]">Brief {String(i + 1).padStart(2, '0')}</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-[-0.01em]">{b.title}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">{b.why}</p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {[['Hook', b.hook_type], ['Angle', b.angle], ['Format', b.format], ['Persona', b.persona], ['Length', `${b.length_seconds}s`], ['CTA', b.cta]].map(([k, v]) => (
                      <Badge key={k}><span className="font-normal text-[var(--faint)]">{k}</span> {v}</Badge>
                    ))}
                  </div>
                  <blockquote className="mt-5 border-l-2 border-[var(--accent)] pl-4 font-serif text-xl italic leading-snug text-[var(--text)]">“{b.hook_line}”</blockquote>
                </div>
                <div className="overflow-x-auto border-t border-[var(--line)]">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-[var(--faint)]">
                      <tr><th className="px-5 py-2.5 font-medium">Time</th><th className="pr-4 font-medium">Visual</th><th className="pr-4 font-medium">Voiceover</th><th className="pr-5 font-medium">On screen</th></tr>
                    </thead>
                    <tbody>
                      {b.script.map((s, j) => (
                        <tr key={j} className="border-t border-[var(--line)] align-top">
                          <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-[var(--accent-2)]">{s.seconds}s</td>
                          <td className="py-2.5 pr-4 text-[var(--text-2)]">{s.visual}</td>
                          <td className="py-2.5 pr-4">{s.voiceover}</td>
                          <td className="py-2.5 pr-5 text-[var(--muted)]">{s.on_screen_text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {b.based_on_ads.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] px-5 py-3 text-xs">
                    <span className="text-[var(--faint)]">Builds on</span>
                    {b.based_on_ads.map((ref) => {
                      const adId = data.data!.byRef.get(ref)
                      return <AdRef key={ref} to={adId ? `${base}/w/${id}/ads/${adId}` : undefined}>{ref}</AdRef>
                    })}
                  </p>
                )}
              </article>
            ))}

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardTitle icon={<Quote size={15} />}>Hook lines</CardTitle>
                <ol className="space-y-2.5 text-sm">
                  {set.hook_list.map((h, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="font-mono text-xs text-[var(--faint)]">{String(i + 1).padStart(2, '0')}</span>
                      <span className="text-[var(--text-2)]">{h}</span>
                    </li>
                  ))}
                </ol>
              </Card>
              <Card>
                <CardTitle icon={<ImageIcon size={15} />}>Static directions</CardTitle>
                <ul className="space-y-4 text-sm">
                  {set.static_directions.map((s, i) => (
                    <li key={i}>
                      <p className="font-medium">{s.title}</p>
                      <p className="mt-0.5 text-[var(--accent-2)]">“{s.headline}”</p>
                      <p className="mt-1 text-[var(--text-2)]">{s.visual}</p>
                      <p className="mt-1 text-[var(--muted)]">{s.primary_text}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            <section>
              <SectionTitle aside={
                <Button size="sm" onClick={() => download('mosaic-test-plan.csv', csv(set.test_plan))}><Download size={13} /> CSV</Button>
              }>Test plan</SectionTitle>
              <Table minWidth={640}>
                <thead><tr><th>Brief</th><th>Hypothesis</th><th>Metric</th><th className="text-right">Budget/day</th><th className="text-right">Days</th><th>Success</th></tr></thead>
                <tbody>
                  {set.test_plan.map((t, i) => (
                    <tr key={i} className="align-top">
                      <td className="font-medium">{t.brief_title}</td>
                      <td className="text-[var(--text-2)]">{t.hypothesis}</td>
                      <td><Badge>{t.primary_metric}</Badge></td>
                      <td className="text-right font-mono">${t.daily_budget_usd}</td>
                      <td className="text-right font-mono">{t.days}</td>
                      <td className="text-[var(--muted)]">{t.success_criterion}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
