import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { WorkspaceNav } from '../components/WorkspaceNav'
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
  const [ws, rows, ads] = await Promise.all([
    supabase.from('workspaces').select('name').eq('id', id).single(),
    supabase.from('reports').select('id, created_at, grounding_passed, content, input_snapshot')
      .eq('workspace_id', id).eq('kind', 'brief').order('created_at', { ascending: false }).limit(1),
    supabase.from('ads').select('id, external_id').eq('workspace_id', id),
  ])
  if (rows.error) throw new Error(rows.error.message)
  return {
    name: ws.data?.name,
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
  const [request, setRequest] = useState('')
  const job = useAgentJob(id, 'brief', data.reload)
  const busy = job.busy
  const error = job.error

  const row = data.data?.row
  const set = row?.content

  return (
    <main className="mx-auto max-w-4xl p-6">
      <WorkspaceNav id={id} name={data.data?.name ?? undefined} />

      {!readOnly && (
      <section className="mb-8 rounded-lg border border-neutral-200 p-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">What should the next round focus on? <span className="font-normal text-neutral-500">(optional)</span></span>
          <textarea rows={2} value={request} onChange={(e) => setRequest(e.target.value)}
            placeholder="e.g. Iterate on our best UGC hook and try one comparison angle."
            className="rounded-md border border-neutral-300 px-3 py-2" />
        </label>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-neutral-500">
            Uses your brand guidelines from <Link to={`/app/w/${id}/settings`} className="underline">Settings</Link> and the latest report.
          </p>
          <button type="button" onClick={() => void job.start(request.trim() || undefined)} disabled={busy}
            className="shrink-0 rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50">
            {busy ? 'Writing briefs… (about two minutes)' : 'Write briefs'}
          </button>
        </div>
        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      </section>
      )}

      {data.loading && !data.data && <p className="text-sm text-neutral-500">Loading…</p>}
      {data.data && !set && <p className="text-sm text-neutral-600">{readOnly ? 'No briefs have been written for this demo yet.' : 'No briefs yet.'}</p>}

      {row && set && (
        <>
          <p className="mb-6 text-sm text-neutral-500">
            {new Date(row.created_at).toLocaleString()}
            {row.input_snapshot?.request ? ` · “${row.input_snapshot.request}”` : ''}
            {' · '}
            <span className={row.grounding_passed ? 'text-emerald-700' : 'text-amber-700'}>
              {row.grounding_passed ? 'evidence checked against your data' : 'some evidence did not match the data'}
            </span>
          </p>

          <div className="space-y-6">
            {set.briefs.map((b, i) => (
              <article key={i} className="rounded-lg border border-neutral-200 p-5">
                <h3 className="text-base font-semibold">{b.title}</h3>
                <p className="mt-1 text-sm text-neutral-600">{b.why}</p>
                <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-600">
                  {[['Hook', b.hook_type], ['Angle', b.angle], ['Format', b.format], ['Persona', b.persona], ['Length', `${b.length_seconds}s`], ['CTA', b.cta]].map(([k, v]) => (
                    <div key={k}><dt className="inline text-neutral-400">{k} </dt><dd className="inline">{v}</dd></div>
                  ))}
                </dl>
                <p className="mt-4 text-sm"><span className="text-neutral-500">Opening line: </span>“{b.hook_line}”</p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="text-xs text-neutral-500">
                      <tr><th className="py-1 pr-3 font-normal">Time</th><th className="pr-3 font-normal">Visual</th><th className="pr-3 font-normal">Voiceover</th><th className="font-normal">On screen</th></tr>
                    </thead>
                    <tbody>
                      {b.script.map((s, j) => (
                        <tr key={j} className="border-t border-neutral-100 align-top">
                          <td className="py-1.5 pr-3 font-mono text-xs text-neutral-500">{s.seconds}s</td>
                          <td className="pr-3">{s.visual}</td>
                          <td className="pr-3">{s.voiceover}</td>
                          <td className="text-neutral-600">{s.on_screen_text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {b.based_on_ads.length > 0 && (
                  <p className="mt-3 flex flex-wrap gap-1.5 text-xs">
                    <span className="text-neutral-500">Builds on</span>
                    {b.based_on_ads.map((ref) => {
                      const adId = data.data!.byRef.get(ref)
                      return adId ? (
                        <Link key={ref} to={`${base}/w/${id}/ads/${adId}`} className="rounded border border-neutral-300 px-1.5 font-mono hover:bg-neutral-50">{ref}</Link>
                      ) : <span key={ref} className="font-mono text-red-700">{ref}</span>
                    })}
                  </p>
                )}
              </article>
            ))}
          </div>

          <section className="mt-10 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Hook lines</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm">{set.hook_list.map((h, i) => <li key={i}>{h}</li>)}</ol>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Static directions</h3>
              <ul className="space-y-3 text-sm">
                {set.static_directions.map((s, i) => (
                  <li key={i}>
                    <p className="font-medium">{s.title}: “{s.headline}”</p>
                    <p className="text-neutral-600">{s.visual}</p>
                    <p className="text-neutral-500">{s.primary_text}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="mt-10">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Test plan</h3>
              <button type="button" onClick={() => download('mosaic-test-plan.csv', csv(set.test_plan))}
                className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50">Download CSV</button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-neutral-200">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-neutral-50 text-xs text-neutral-500">
                  <tr><th className="px-3 py-2 font-normal">Brief</th><th className="px-3 font-normal">Hypothesis</th><th className="px-3 font-normal">Metric</th><th className="px-3 text-right font-normal">Budget/day</th><th className="px-3 text-right font-normal">Days</th><th className="px-3 font-normal">Success</th></tr>
                </thead>
                <tbody>
                  {set.test_plan.map((t, i) => (
                    <tr key={i} className="border-t border-neutral-100 align-top">
                      <td className="px-3 py-2 font-medium">{t.brief_title}</td><td className="px-3 py-2">{t.hypothesis}</td>
                      <td className="px-3 py-2">{t.primary_metric}</td><td className="px-3 py-2 text-right tabular-nums">${t.daily_budget_usd}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.days}</td><td className="px-3 py-2 text-neutral-600">{t.success_criterion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}
