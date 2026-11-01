import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LineChart, type Point } from '../components/LineChart'
import { ArrowLeft, Film, Image as ImageIcon, Play, Sparkles } from 'lucide-react'
import { Badge, Card, CardTitle, ErrorText, Loading, PageHeader, Segmented, Stat } from '../components/ui'
import { fmt } from '../lib/format'
import { fetchPerformance, fetchTags, signedUrls, type AdPerf, type CreativeTag } from '../lib/library'
import { supabase } from '../lib/supabase'
import type { Tables } from '../lib/types'
import { fetchAdCustomTags, fetchCustomTags, setAdCustomTag } from '../lib/taxonomy'
import { useAsync } from '../lib/useAsync'
import { useWorkspaceMode } from '../lib/workspaceBase'

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
  perf: AdPerf | undefined
  creative: Creative | null
  daily: Daily[]
  tags: CreativeTag[]
  scenes: Scene[]
  urls: Record<string, string>
}

async function loadDetail(workspaceId: string, adId: string): Promise<DetailData> {
  const [perfRows, ad, daily] = await Promise.all([
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
  const { base, readOnly } = useWorkspaceMode()
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

  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorText>{error ?? 'Ad not found'}</ErrorText>

  const { perf, creative, tags, scenes, urls } = data
  const mediaUrl = creative?.storage_path ? urls[creative.storage_path] : undefined
  const poster = creative?.thumbnail_path ? urls[creative.thumbnail_path] : undefined

  return (
    <>
      <Link to={`${base}/w/${id}/library`} className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
        <ArrowLeft size={14} /> Library
      </Link>
      <PageHeader
        title={perf?.name ?? 'Ad'}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            {perf?.status && <Badge tone={perf.status === 'ACTIVE' ? 'good' : 'neutral'}>{perf.status.toLowerCase()}</Badge>}
            <span>{isVideo ? `Video${creative?.duration_s ? ` · ${fmt.seconds(creative.duration_s)}` : ''}` : 'Static'}</span>
            {perf?.first_date && perf.last_date && <span>· {perf.first_date} to {perf.last_date}</span>}
            {perf?.external_id && <span className="font-mono">· {perf.external_id}</span>}
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        <section className="lg:sticky lg:top-8 lg:self-start">
          <div className="aspect-[4/5] overflow-hidden rounded-xl border border-[var(--line)] bg-black">
            {mediaUrl && isVideo ? (
              <video src={mediaUrl} poster={poster} controls playsInline className="h-full w-full object-contain" />
            ) : mediaUrl ? (
              <img src={mediaUrl} alt="" className="h-full w-full object-contain" />
            ) : poster ? (
              <img src={poster} alt="Video poster" className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#1d1838] to-[#2c2552] p-6 text-center text-sm text-white/50">
                {isVideo ? <Play size={26} /> : <ImageIcon size={26} />}
                No media stored for this creative.
              </div>
            )}
          </div>
          {creative && (creative.headline || creative.primary_text) && (
            <Card className="mt-4">
              {creative.headline && <p className="text-sm font-medium">{creative.headline}</p>}
              {creative.primary_text && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--text-2)]">{creative.primary_text}</p>}
              {creative.cta_type && (
                <p className="mt-3"><Badge>{creative.cta_type.replaceAll('_', ' ').toLowerCase()}</Badge></p>
              )}
            </Card>
          )}
        </section>

        <section className="min-w-0 space-y-6">
          {perf && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Spend" value={fmt.money(perf.spend)} />
              <Stat label="ROAS" value={fmt.ratio(perf.roas)} />
              <Stat label="CPA" value={fmt.money(perf.cpa)} />
              <Stat label="Purchases" value={fmt.int(perf.purchases)} />
              <Stat label="Impressions" value={fmt.compact(perf.impressions)} />
              <Stat label="CTR" value={fmt.pct(perf.ctr)} />
              <Stat label="Hook rate" value={isVideo ? fmt.pct(perf.hook_rate, 1) : '—'} />
              <Stat label="Hold rate" value={isVideo ? fmt.pct(perf.hold_rate, 1) : '—'} />
            </dl>
          )}

          <Card>
            <CardTitle aside={
              <Segmented label="Chart metric" value={active.key} onChange={setMetric}
                options={metrics.map((m) => [m.key, m.label] as const)} />
            }>{active.label} by day</CardTitle>
            <LineChart points={points} format={active.format} tickFormat={active.tick} label={active.label} />
          </Card>

          <Card>
            <CardTitle icon={<Sparkles size={15} />}>Tags</CardTitle>
            {tags.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                {creative?.perception_status === 'pending' || creative?.perception_status === 'processing'
                  ? 'This ad is queued for breakdown.'
                  : creative?.perception_status === 'failed'
                    ? 'Breakdown failed for this ad.'
                    : 'No tags yet.'}
              </p>
            ) : (
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {sortTags(tags).map((t) => (
                  <div key={`${t.dimension_key}-${t.source}-${t.value}`} className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-2.5">
                    <dt className="text-xs text-[var(--muted)]">{DIMENSION_LABEL[t.dimension_key] ?? t.dimension_key}</dt>
                    <dd className="flex min-w-0 items-center gap-2 text-right text-sm">
                      <span className="truncate">{t.value}</span>
                      <span className="shrink-0 font-mono text-[10px] text-[var(--faint)]" title={t.source === 'user' ? 'Set by you' : t.model === 'synthetic' ? 'Synthetic ground truth' : `AI · ${t.model ?? ''}`}>
                        {t.source === 'user' ? 'you' : t.model === 'synthetic' ? 'synthetic' : t.confidence == null ? 'ai' : `${Math.round(t.confidence * 100)}%`}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          {!readOnly && (
            <Card>
              <CardTitle>Custom tags</CardTitle>
              {custom.data && custom.data.all.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  No custom tags yet. Create them in <Link to={`/app/w/${id}/settings`} className="text-[var(--accent-2)] hover:text-[var(--text)]">Settings</Link>.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(custom.data?.all ?? []).map((t) => {
                    const on = custom.data?.applied.has(t.id) ?? false
                    return (
                      <button key={t.id} type="button" aria-pressed={on} onClick={() => void toggleTag(t.id, !on)}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${on ? 'border-[var(--accent)]/60 bg-[var(--accent-soft)] text-[var(--text)]' : 'border-[var(--line-strong)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
                        <span className="h-2 w-2 rounded-full" style={{ background: t.color ?? '#a3a3a3' }} aria-hidden />
                        {t.name}
                      </button>
                    )
                  })}
                </div>
              )}
              {tagError && <div className="mt-3"><ErrorText>{tagError}</ErrorText></div>}
            </Card>
          )}

          <Card>
            <CardTitle icon={<Film size={15} />} aside={scenes.length > 0 && `${scenes.length} scenes`}>Scenes</CardTitle>
            {scenes.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                {isVideo ? 'The scene breakdown appears once the video has been processed.' : 'Static ads have no scenes.'}
              </p>
            ) : (
              <SceneTimeline scenes={scenes} urls={urls} duration={Number(creative?.duration_s ?? scenes[scenes.length - 1]?.end_s ?? 0)} />
            )}
          </Card>
        </section>
      </div>
    </>
  )
}

function SceneTimeline({ scenes, urls, duration }: { scenes: Scene[]; urls: Record<string, string>; duration: number }) {
  const total = duration > 0 ? duration : 1
  return (
    <div>
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {scenes.map((s) => (
          <div
            key={s.id}
            className={s.idx === 0 ? 'bg-[var(--accent)]' : 'bg-white/15'}
            style={{ width: `${((Number(s.end_s) - Number(s.start_s)) / total) * 100}%` }}
            title={`Scene ${s.idx + 1}: ${Number(s.start_s).toFixed(1)}s to ${Number(s.end_s).toFixed(1)}s`}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--faint)]">The first scene is the hook (0 to 3 s).</p>
      <ol className="mt-5 space-y-4">
        {scenes.map((s) => (
          <li key={s.id} className="flex gap-4">
            <div className="h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-2)]">
              {s.keyframe_path && urls[s.keyframe_path] && (
                <img src={urls[s.keyframe_path]} alt="" className="h-full w-full object-cover" loading="lazy" />
              )}
            </div>
            <div className="min-w-0 text-sm">
              <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                {s.idx === 0 && <Badge tone="accent">Hook</Badge>}
                <span className="font-mono">{Number(s.start_s).toFixed(1)}s – {Number(s.end_s).toFixed(1)}s</span>
                {s.broll_type && <span>· {s.broll_type}</span>}
              </p>
              {s.transcript && <p className="mt-1.5 leading-relaxed">“{s.transcript}”</p>}
              {s.on_screen_text && <p className="mt-1 text-[var(--text-2)]"><span className="text-[var(--faint)]">On screen: </span>{s.on_screen_text}</p>}
              {s.visual_description && <p className="mt-1 text-[var(--muted)]">{s.visual_description}</p>}
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
