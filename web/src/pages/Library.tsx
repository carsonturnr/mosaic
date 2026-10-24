import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { WorkspaceNav } from '../components/WorkspaceNav'
import { fmt } from '../lib/format'
import {
  fetchPerformance,
  fetchTags,
  LOW_DATA_IMPRESSIONS,
  signedUrls,
  tagsByCreative,
  type AdPerf,
  type CreativeTag,
  type Window,
} from '../lib/library'
import { supabase } from '../lib/supabase'
import { fetchAdCustomTags, fetchCustomTags, type CustomTag as UserTag } from '../lib/taxonomy'
import { useAsync } from '../lib/useAsync'
import { useWorkspaceMode } from '../lib/workspaceBase'

type SortKey = 'spend' | 'roas' | 'ctr' | 'cpa' | 'hook_rate'
type TypeFilter = 'all' | 'video' | 'image'

const SORTS: { key: SortKey; label: string; asc?: boolean }[] = [
  { key: 'spend', label: 'Spend' },
  { key: 'roas', label: 'ROAS' },
  { key: 'ctr', label: 'CTR' },
  { key: 'cpa', label: 'CPA (low first)', asc: true },
  { key: 'hook_rate', label: 'Hook rate' },
]
const TAG_FILTERS = ['format', 'hook_type', 'angle'] as const
type TagFilterKey = (typeof TAG_FILTERS)[number]
const TAG_LABEL: Record<TagFilterKey, string> = { format: 'Format', hook_type: 'Hook', angle: 'Angle' }

interface LibraryData {
  workspaceName: string | undefined
  ads: AdPerf[]
  tags: Map<string, Map<string, CreativeTag>>
  thumbs: Record<string, string>
  userTags: UserTag[]
  adUserTags: Map<string, Set<string>> // ad_id -> custom tag ids
}

async function loadLibrary(id: string, w: Window): Promise<LibraryData> {
  const [ws, ads] = await Promise.all([
    supabase.from('workspaces').select('name').eq('id', id).single(),
    fetchPerformance(id, w),
  ])
  const creativeIds = ads.map((a) => a.creative_id).filter((c): c is string => !!c)
  const [tags, thumbs, userTags, applied] = await Promise.all([
    fetchTags(creativeIds),
    signedUrls(ads.map((a) => a.thumbnail_path ?? '').filter(Boolean)),
    fetchCustomTags(id),
    fetchAdCustomTags(ads.map((a) => a.ad_id)),
  ])
  const adUserTags = new Map<string, Set<string>>()
  for (const a of applied) adUserTags.set(a.ad_id, (adUserTags.get(a.ad_id) ?? new Set()).add(a.custom_tag_id))
  return { workspaceName: ws.data?.name, ads, tags: tagsByCreative(tags), thumbs, userTags, adUserTags }
}

export function Library() {
  const { id = '' } = useParams<{ id: string }>()
  const { base } = useWorkspaceMode()
  const [win, setWin] = useState<Window>('all')
  const [sort, setSort] = useState<SortKey>('spend')
  const [type, setType] = useState<TypeFilter>('all')
  const [tagFilter, setTagFilter] = useState<Record<TagFilterKey, string>>({ format: '', hook_type: '', angle: '' })
  const [userTag, setUserTag] = useState('')

  const { data, error, loading } = useAsync(() => loadLibrary(id, win), [id, win])

  const tagOptions = useMemo(() => {
    const opts: Record<TagFilterKey, string[]> = { format: [], hook_type: [], angle: [] }
    if (!data) return opts
    for (const key of TAG_FILTERS) {
      const values = new Set<string>()
      for (const m of data.tags.values()) {
        const v = m.get(key)?.value
        if (v) values.add(v)
      }
      opts[key] = [...values].sort()
    }
    return opts
  }, [data])

  const visible = useMemo(() => {
    if (!data) return []
    const s = SORTS.find((x) => x.key === sort) ?? SORTS[0]!
    return data.ads
      .filter((a) => type === 'all' || a.creative_type === type || (type === 'image' && a.creative_type === 'carousel'))
      .filter((a) =>
        TAG_FILTERS.every((k) => !tagFilter[k] || data.tags.get(a.creative_id ?? '')?.get(k)?.value === tagFilter[k]),
      )
      .filter((a) => !userTag || (data.adUserTags.get(a.ad_id)?.has(userTag) ?? false))
      .sort((x, y) => {
        const a = x[s.key]
        const b = y[s.key]
        if (a == null && b == null) return y.spend - x.spend
        if (a == null) return 1
        if (b == null) return -1
        return s.asc ? a - b : b - a
      })
  }, [data, sort, type, tagFilter, userTag])

  const summary = useMemo(() => {
    const spend = visible.reduce((t, a) => t + a.spend, 0)
    const value = visible.reduce((t, a) => t + a.purchase_value, 0)
    const purchases = visible.reduce((t, a) => t + a.purchases, 0)
    return { spend, roas: spend > 0 ? value / spend : null, cpa: purchases > 0 ? spend / purchases : null }
  }, [visible])

  const filtersActive = type !== 'all' || !!userTag || TAG_FILTERS.some((k) => tagFilter[k])

  return (
    <main className="mx-auto max-w-6xl p-6">
      <WorkspaceNav id={id} name={data?.workspaceName} />

      <div className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <Select label="Window" value={win} onChange={(v) => setWin(v as Window)}
          options={[['all', 'All time'], ['90', 'Last 90 days'], ['30', 'Last 30 days'], ['7', 'Last 7 days']]} />
        <Select label="Type" value={type} onChange={(v) => setType(v as TypeFilter)}
          options={[['all', 'All'], ['video', 'Video'], ['image', 'Static']]} />
        {TAG_FILTERS.map((k) => (
          <Select key={k} label={TAG_LABEL[k]} value={tagFilter[k]}
            onChange={(v) => setTagFilter((f) => ({ ...f, [k]: v }))}
            options={[['', 'Any'], ...tagOptions[k].map((o): [string, string] => [o, o])]} />
        ))}
        {data && data.userTags.length > 0 && (
          <Select label="Custom tag" value={userTag} onChange={setUserTag}
            options={[['', 'Any'], ...data.userTags.map((t): [string, string] => [t.id, t.name])]} />
        )}
        <Select label="Sort by" value={sort} onChange={(v) => setSort(v as SortKey)}
          options={SORTS.map((s): [string, string] => [s.key, s.label])} />
        {filtersActive && (
          <button type="button" className="pb-2 text-neutral-500 underline hover:text-neutral-900"
            onClick={() => { setType('all'); setUserTag(''); setTagFilter({ format: '', hook_type: '', angle: '' }) }}>
            Clear filters
          </button>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      {data && (
        <p className="mb-4 text-sm text-neutral-600">
          <span className="font-medium text-neutral-900">{visible.length}</span> of {data.ads.length} ads ·{' '}
          <span className="font-medium text-neutral-900">{fmt.money(summary.spend)}</span> spend · ROAS{' '}
          <span className="font-medium text-neutral-900">{fmt.ratio(summary.roas)}</span> · CPA{' '}
          <span className="font-medium text-neutral-900">{fmt.money(summary.cpa)}</span>
        </p>
      )}

      {loading && !data && <p className="text-sm text-neutral-500">Loading ads…</p>}

      {data && data.ads.length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-600">
          No ads yet. Connect a Meta ad account on the{' '}
          <Link to={`${base}/w/${id}`} className="underline">Overview</Link> tab and run a sync.
        </div>
      )}

      {data && data.ads.length > 0 && visible.length === 0 && (
        <p className="text-sm text-neutral-600">No ads match these filters.</p>
      )}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data && visible.map((ad) => (
          <AdCard key={ad.ad_id} ad={ad} workspaceId={id}
            userTags={data.userTags.filter((t) => data.adUserTags.get(ad.ad_id)?.has(t.id))}
            tags={data.tags.get(ad.creative_id ?? '')} thumb={ad.thumbnail_path ? data.thumbs[ad.thumbnail_path] : undefined} />
        ))}
      </ul>
    </main>
  )
}

function AdCard({ ad, tags, thumb, workspaceId, userTags }: {
  ad: AdPerf
  userTags: UserTag[]
  tags: Map<string, CreativeTag> | undefined
  thumb: string | undefined
  workspaceId: string
}) {
  const { base } = useWorkspaceMode()
  const lowData = ad.impressions < LOW_DATA_IMPRESSIONS
  const chips = (['format', 'hook_type', 'angle'] as const)
    .map((k) => tags?.get(k)?.value)
    .filter((v): v is string => !!v)
  const isVideo = ad.creative_type === 'video'

  return (
    <li className="overflow-hidden rounded-lg border border-neutral-200 bg-white transition hover:border-neutral-400">
      <Link to={`${base}/w/${workspaceId}/ads/${ad.ad_id}`} className="block">
        <div className="relative aspect-[4/5] bg-neutral-100">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-neutral-400">
              <span className="text-3xl" aria-hidden>{isVideo ? '▶' : '▦'}</span>
              <span className="text-xs">{isVideo ? 'Video' : 'Static'}{isVideo && ad.duration_s ? ` · ${fmt.seconds(ad.duration_s)}` : ''}</span>
            </div>
          )}
          <div className="absolute left-2 top-2 flex gap-1">
            {ad.status && ad.status !== 'ACTIVE' && (
              <span className="rounded bg-white/90 px-1.5 py-0.5 text-[11px] text-neutral-700">{ad.status.toLowerCase()}</span>
            )}
            {lowData && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800" title={`Fewer than ${LOW_DATA_IMPRESSIONS.toLocaleString()} impressions`}>
                low data
              </span>
            )}
          </div>
        </div>
        <div className="p-3">
          <p className="truncate text-sm font-medium" title={ad.name ?? ''}>{ad.name ?? ad.external_id}</p>
          <div className="mt-1.5 flex min-h-5 flex-wrap gap-1">
            {chips.map((c) => (
              <span key={c} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-700">{c}</span>
            ))}
            {userTags.map((t) => (
              <span key={t.id} className="flex items-center gap-1 rounded border border-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-700">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color ?? '#a3a3a3' }} aria-hidden />
                {t.name}
              </span>
            ))}
          </div>
          <dl className="mt-3 grid grid-cols-4 gap-1 text-xs">
            <Metric label="Spend" value={fmt.money(ad.spend)} />
            <Metric label="ROAS" value={fmt.ratio(ad.roas)} />
            <Metric label="CTR" value={fmt.pct(ad.ctr)} />
            <Metric label="Hook" value={isVideo ? fmt.pct(ad.hook_rate, 1) : '—'} />
          </dl>
        </div>
      </Link>
    </li>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium tabular-nums text-neutral-900">{value}</dd>
    </div>
  )
}

function Select({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string][]
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-neutral-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm">
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  )
}
