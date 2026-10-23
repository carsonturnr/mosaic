import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LineChart, type Point } from '../components/LineChart'
import { WorkspaceNav } from '../components/WorkspaceNav'
import { fmt } from '../lib/format'
import { fetchPerformance, fetchTags, signedUrls, type AdPerf, type CreativeTag } from '../lib/library'
import { supabase } from '../lib/supabase'
import type { Tables } from '../lib/types'
import { fetchAdCustomTags, fetchCustomTags, setAdCustomTag } from '../lib/taxonomy'
import { useAsync } from '../lib/useAsync'

type Daily = Pick<
  Tables<'ad_daily_metrics'>,
  'date' | 'spend' | 'impressions' | 'purchases' | 'purchase_value' | 'video_3s_views'
> & { ctr: number | null; roas: number | null; cpa: number | null; hook_rate: number | null }

type Creative = Pick<
  Tables<'creatives'>,
  'id' | 'type' | 'primary_text' | 'headline' | 'cta_type' | 'storage_path' | 'thumbnail_path' | 'duration_s' | 'perception_status'
>
type Scene = Pick<
  Tables<'scenes'>,
  'id' | 'idx' | 'start_s' | 'end_s' | 'keyframe_path' | 'transcript' | 'on_screen_text' | 'visual_description' | 'broll_type'
>

interface DetailData {
  workspaceName: string | undefined
  perf: AdPerf | undefined
  creative: Creative | null
  daily: Daily[]
  tags: CreativeTag[]
  scenes: Scene[]
  urls: Record<string, string>
}

async function loadDetail(workspaceId: string, adId: string): Promise<DetailData> {
  const [ws, perfRows, ad, daily] = await Promise.all([
    supabase.from('workspaces').select('name').eq('id', workspaceId).single(),
    fetchPerformance(workspaceId, 'all'),
    supabase.from('ads').select('creative_id').eq('id', adId).single(),
    supabase
      .from('ad_daily_metrics_derived')
      .select('date, spend, impressions, purchases, purchase_value, video_3s_views, ctr, roas, cpa, hook_rate')
      .eq('ad_id', adId)
      .order('date', { ascending: true }),
  ])
  if (ad.error) throw new Error(ad.error.message)
  const creativeId = ad.data.creative_id
  const [creative, tags, scenes] = creativeId
    ? await Promise.all([
        supabase
          .from('creatives')
          .select('id, type, primary_text, headline, cta_type, storage_path, thumbnail_path, duration_s, perception_status')
          .eq('id', creativeId)
          .single(),
        fetchTags([creativeId]),
        supabase
          .from('scenes')
          .select('id, idx, start_s, end_s, keyframe_path, transcript, on_screen_text, visual_description, broll_type')
          .eq('creative_id', creativeId)
          .order('idx'),
      ])
    : [null, [], null]
  const sceneRows = (scenes?.data ?? []) as Scene[]
  const c = (creative?.data ?? null) as Creative | null
  const urls = await signedUrls(
    [c?.storage_path, c?.thumbnail_path, ...sceneRows.map((s) => s.keyframe_path)].filter((p): p is string => !!p),
  )
  return {
    workspaceName: ws.data?.name,
    perf: perfRows.find((p) => p.ad_id === adId),
    creative: c,
    daily: (daily.data ?? []) as Daily[],
    tags,
    scenes: sceneRows,
    urls,
  }
}

type ChartMetric = 'spend' | 'ctr' | 'roas' | 'cpa' | 'hook_rate'
const CHART_METRICS: { key: ChartMetric; label: string; format: (v: number) => string; tick?: (v: number) => string; video?: boolean }[] = [
  { key: 'spend', label: 'Spend', format: (v) => fmt.money(v), tick: (v) => `$${fmt.compact(v)}` },
  { key: 'roas', label: 'ROAS', format: (v) => fmt.ratio(v) },
  { key: 'ctr', label: 'CTR', format: (v) => fmt.pct(v), tick: (v) => fmt.pct(v, 1) },
  { key: 'cpa', label: 'CPA', format: (v) => fmt.money(v), tick: (v) => `$${fmt.compact(v)}` },
  { key: 'hook_rate', label: 'Hook rate', format: (v) => fmt.pct(v, 1), tick: (v) => fmt.pct(v, 0), video: true },
]

const DIMENSION_LABEL: Record<string, string> = {
  hook_type: 'Hook type',
  angle: 'Angle',
  persona: 'Persona',
  format: 'Format',
  offer: 'Offer',
  proof_type: 'Proof',
  cta: 'CTA',
  length_bucket: 'Length',
}

export function AdDetail() {
  const { id = '', adId = '' } = useParams<{ id: string; adId: string }>()
  const { data, error, loading } = useAsync(() => loadDetail(id, adId), [id, adId])
  const [metric, setMetric] = useState<ChartMetric>('spend')
  const custom = useAsync(async () => {
    const [all, applied] = await Promise.all([fetchCustomTags(id), fetchAdCustomTags([adId])])
    return { all, applied: new Set(applied.map((a) => a.custom_tag_id)) }
  }, [id, adId])
  const [tagError, setTagError] = useState<string | null>(null)
  const toggleTag = async (tagId: string, on: boolean) => {
    setTagError(null)
    try {
      await setAdCustomTag(adId, tagId, on)
      custom.reload()
    } catch (e) {
      setTagError(e instanceof Error ? e.message : String(e))
    }
  }

  const isVideo = data?.creative?.type === 'video'
  const metrics = CHART_METRICS.filter((m) => !m.video || isVideo)
  const active = metrics.find((m) => m.key === metric) ?? metrics[0]!

  const points: Point[] = (data?.daily ?? []).map((d) => ({ date: d.date, value: d[active.key] ?? null }))

  if (loading && !data) return <main className="mx-auto max-w-6xl p-6 text-sm text-neutral-500">Loading…</main>
  if (error || !data) return <main className="mx-auto max-w-6xl p-6 text-sm text-red-700">{error ?? 'Ad not found'}</main>

  const { perf, creative, tags, scenes, urls } = data
  const mediaUrl = creative?.storage_path ? urls[creative.storage_path] : undefined
  const poster = creative?.thumbnail_path ? urls[creative.thumbnail_path] : undefined

  return (
    <main className="mx-auto max-w-6xl p-6">
      <WorkspaceNav id={id} name={data.workspaceName} />
      <Link to={`/app/w/${id}/library`} className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Library
      </Link>

      <div className="mt-3 grid gap-8 lg:grid-cols-[minmax(0,320px)_1fr]">
        <section>
          <div className="aspect-[4/5] overflow-hidden rounded-lg bg-neutral-100">
            {mediaUrl && isVideo ? (
              <video src={mediaUrl} poster={poster} controls playsInline className="h-full w-full bg-black object-contain" />
            ) : mediaUrl ? (
              <img src={mediaUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-sm text-neutral-500">
                <span className="text-3xl text-neutral-400" aria-hidden>{isVideo ? '▶' : '▦'}</span>
                No media stored for this creative yet.
              </div>
            )}
          </div>
          {creative && (creative.headline || creative.primary_text) && (
            <div className="mt-4 space-y-2 text-sm">
              {creative.headline && <p className="font-medium">{creative.headline}</p>}
              {creative.primary_text && <p className="whitespace-pre-line text-neutral-700">{creative.primary_text}</p>}
              {creative.cta_type && (
                <p className="text-xs text-neutral-500">CTA button: {creative.cta_type.replaceAll('_', ' ').toLowerCase()}</p>
              )}
            </div>
          )}
        </section>

        <section className="min-w-0">
          <h2 className="text-lg font-semibold">{perf?.name ?? 'Ad'}</h2>
          <p className="mt-1 text-sm text-neutral-500">
            {[
              perf?.status?.toLowerCase(),
              isVideo ? `video${creative?.duration_s ? ` · ${fmt.seconds(creative.duration_s)}` : ''}` : creative?.type,
              perf?.first_date && perf.last_date ? `${perf.first_date} → ${perf.last_date}` : null,
              perf?.external_id,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          {perf && (
            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Spend" value={fmt.money(perf.spend)} />
              <Kpi label="ROAS" value={fmt.ratio(perf.roas)} />
              <Kpi label="CPA" value={fmt.money(perf.cpa)} />
              <Kpi label="Purchases" value={fmt.int(perf.purchases)} />
              <Kpi label="Impressions" value={fmt.compact(perf.impressions)} />
              <Kpi label="CTR" value={fmt.pct(perf.ctr)} />
              <Kpi label="Hook rate" value={isVideo ? fmt.pct(perf.hook_rate, 1) : '—'} />
              <Kpi label="Hold rate" value={isVideo ? fmt.pct(perf.hold_rate, 1) : '—'} />
            </dl>
          )}

          <div className="mt-8">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{active.label} by day</h3>
              <div className="flex gap-1 rounded-md bg-neutral-100 p-0.5 text-xs" role="tablist" aria-label="Chart metric">
                {metrics.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    role="tab"
                    aria-selected={m.key === active.key}
                    onClick={() => setMetric(m.key)}
                    className={`rounded px-2 py-1 ${m.key === active.key ? 'bg-white font-medium shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <LineChart points={points} format={active.format} tickFormat={active.tick} label={active.label} />
          </div>

          <div className="mt-8">
            <h3 className="mb-2 text-sm font-medium">Custom tags</h3>
            {custom.data && custom.data.all.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No custom tags yet. Create them in <Link to={`/app/w/${id}/settings`} className="underline">Settings</Link>.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(custom.data?.all ?? []).map((t) => {
                  const on = custom.data?.applied.has(t.id) ?? false
                  return (
                    <button key={t.id} type="button" aria-pressed={on} onClick={() => void toggleTag(t.id, !on)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 text-neutral-700 hover:border-neutral-500'}`}>
                      <span className="h-2 w-2 rounded-full" style={{ background: t.color ?? '#a3a3a3' }} aria-hidden />
                      {t.name}
                    </button>
                  )
                })}
              </div>
            )}
            {tagError && <p className="mt-2 text-xs text-red-700">{tagError}</p>}
          </div>

          <div className="mt-8">
            <h3 className="mb-2 text-sm font-medium">Tags</h3>
            {tags.length === 0 ? (
              <p className="text-sm text-neutral-500">
                {creative?.perception_status === 'pending' || creative?.perception_status === 'processing'
                  ? 'This ad is queued for breakdown.'
                  : creative?.perception_status === 'failed'
                    ? 'Breakdown failed for this ad.'
                    : 'No tags yet.'}
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-neutral-500">
                  <tr>
                    <th className="py-1 font-normal">Dimension</th>
                    <th className="font-normal">Value</th>
                    <th className="font-normal">Confidence</th>
                    <th className="font-normal">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {sortTags(tags).map((t) => (
                    <tr key={`${t.dimension_key}-${t.source}-${t.value}`} className="border-t border-neutral-100">
                      <td className="py-1.5 text-neutral-600">{DIMENSION_LABEL[t.dimension_key] ?? t.dimension_key}</td>
                      <td>{t.value}</td>
                      <td className="tabular-nums text-neutral-600">{t.confidence == null || t.model === 'synthetic' ? '—' : `${Math.round(t.confidence * 100)}%`}</td>
                      <td className="text-neutral-600">{t.source === 'user' ? 'You' : t.model === 'synthetic' ? 'Synthetic' : 'AI'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="mt-8">
            <h3 className="mb-2 text-sm font-medium">Scenes</h3>
            {scenes.length === 0 ? (
              <p className="text-sm text-neutral-500">
                {isVideo ? 'Scene breakdown appears once the video has been processed.' : 'Static ads have no scenes.'}
              </p>
            ) : (
              <SceneTimeline scenes={scenes} urls={urls} duration={Number(creative?.duration_s ?? scenes[scenes.length - 1]?.end_s ?? 0)} />
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function SceneTimeline({ scenes, urls, duration }: { scenes: Scene[]; urls: Record<string, string>; duration: number }) {
  const total = duration > 0 ? duration : 1
  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded" aria-hidden>
        {scenes.map((s) => (
          <div
            key={s.id}
            className={s.idx === 0 ? 'bg-[var(--series-1,#2a78d6)]' : 'bg-neutral-300'}
            style={{ width: `${((Number(s.end_s) - Number(s.start_s)) / total) * 100}%` }}
            title={`Scene ${s.idx + 1}: ${Number(s.start_s).toFixed(1)}s to ${Number(s.end_s).toFixed(1)}s`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-neutral-500">The first scene is the hook (0 to 3 s).</p>
      <ol className="mt-4 space-y-3">
        {scenes.map((s) => (
          <li key={s.id} className="flex gap-3">
            <div className="h-20 w-16 shrink-0 overflow-hidden rounded bg-neutral-100">
              {s.keyframe_path && urls[s.keyframe_path] && (
                <img src={urls[s.keyframe_path]} alt="" className="h-full w-full object-cover" loading="lazy" />
              )}
            </div>
            <div className="min-w-0 text-sm">
              <p className="text-xs text-neutral-500">
                {s.idx === 0 ? 'Hook · ' : ''}
                {Number(s.start_s).toFixed(1)}s to {Number(s.end_s).toFixed(1)}s{s.broll_type ? ` · ${s.broll_type}` : ''}
              </p>
              {s.transcript && <p className="mt-0.5">“{s.transcript}”</p>}
              {s.on_screen_text && <p className="mt-0.5 text-neutral-600">On screen: {s.on_screen_text}</p>}
              {s.visual_description && <p className="mt-0.5 text-neutral-500">{s.visual_description}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function sortTags(tags: CreativeTag[]): CreativeTag[] {
  const order = Object.keys(DIMENSION_LABEL)
  const rank = (k: string) => {
    const i = order.indexOf(k)
    return i === -1 ? order.length : i
  }
  return [...tags].sort((a, b) => rank(a.dimension_key) - rank(b.dimension_key) || a.value.localeCompare(b.value))
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
