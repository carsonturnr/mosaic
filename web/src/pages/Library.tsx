import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Image as ImageIcon, LayoutGrid, Play, X } from 'lucide-react'
import { buttonClass } from '../components/buttonClass'
import { Badge, Button, EmptyState, ErrorText, Loading, PageHeader, SelectField } from '../components/ui'
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
  ads: AdPerf[]
  tags: Map<string, Map<string, CreativeTag>>
  thumbs: Record<string, string>
  userTags: UserTag[]
  adUserTags: Map<string, Set<string>> // ad_id -> custom tag ids
}

async function loadLibrary(id: string, w: Window): Promise<LibraryData> {
  const ads = await fetchPerformance(id, w)
  const creativeIds = ads.map((a) => a.creative_id).filter((c): c is string => !!c)
  const [tags, thumbs, userTags, applied] = await Promise.all([
    fetchTags(creativeIds),
    signedUrls(ads.map((a) => a.thumbnail_path ?? '').filter(Boolean)),
    fetchCustomTags(id),
    fetchAdCustomTags(ads.map((a) => a.ad_id)),
  ])
  const adUserTags = new Map<string, Set<string>>()
  for (const a of applied) adUserTags.set(a.ad_id, (adUserTags.get(a.ad_id) ?? new Set()).add(a.custom_tag_id))
  return { ads, tags: tagsByCreative(tags), thumbs, userTags, adUserTags }
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
    <>
      <PageHeader title="Library" description="Every ad with its tags and results. Click one for the scene-by-scene breakdown." />

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3">
        <SelectField label="Window" value={win} onChange={(v) => setWin(v as Window)}
          options={[['all', 'All time'], ['90', 'Last 90 days'], ['30', 'Last 30 days'], ['7', 'Last 7 days']]} />
        <SelectField label="Type" value={type} onChange={(v) => setType(v as TypeFilter)}
          options={[['all', 'All'], ['video', 'Video'], ['image', 'Static']]} />
        {TAG_FILTERS.map((k) => (
          <SelectField key={k} label={TAG_LABEL[k]} value={tagFilter[k]}
            onChange={(v) => setTagFilter((f) => ({ ...f, [k]: v }))}
            options={[['', 'Any'], ...tagOptions[k].map((o): [string, string] => [o, o])]} />
        ))}
        {data && data.userTags.length > 0 && (
          <SelectField label="Custom tag" value={userTag} onChange={setUserTag}
            options={[['', 'Any'], ...data.userTags.map((t): [string, string] => [t.id, t.name])]} />
        )}
        <div className="ml-auto flex items-end gap-2">
          {filtersActive && (
            <Button variant="ghost" size="sm" className="mb-0.5"
              onClick={() => { setType('all'); setUserTag(''); setTagFilter({ format: '', hook_type: '', angle: '' }) }}>
              <X size={13} /> Clear
            </Button>
          )}
          <SelectField label="Sort by" value={sort} onChange={(v) => setSort(v as SortKey)}
            options={SORTS.map((s): [string, string] => [s.key, s.label])} />
        </div>
      </div>

      {error && <div className="mb-4"><ErrorText>{error}</ErrorText></div>}

      {data && data.ads.length > 0 && (
        <p className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--muted)]">
          <span><span className="font-mono text-[var(--text)]">{visible.length}</span> of {data.ads.length} ads</span>
          <span><span className="font-mono text-[var(--text)]">{fmt.money(summary.spend)}</span> spend</span>
          <span><span className="font-mono text-[var(--text)]">{fmt.ratio(summary.roas)}</span> ROAS</span>
          <span><span className="font-mono text-[var(--text)]">{fmt.money(summary.cpa)}</span> CPA</span>
        </p>
      )}

      {loading && !data && <Loading label="Loading ads…" />}

      {data && data.ads.length === 0 && (
        <EmptyState icon={<LayoutGrid size={18} />} title="No ads yet"
          action={<Link to={`${base}/w/${id}`} className={buttonClass('secondary')}>Go to Overview</Link>}>
          Connect a Meta ad account on the Overview page and run a sync. Ads appear here with their tags and results.
        </EmptyState>
      )}

      {data && data.ads.length > 0 && visible.length === 0 && (
        <EmptyState title="No ads match these filters" />
      )}

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {data && visible.map((ad) => (
          <AdCard key={ad.ad_id} ad={ad} workspaceId={id}
            userTags={data.userTags.filter((t) => data.adUserTags.get(ad.ad_id)?.has(t.id))}
            tags={data.tags.get(ad.creative_id ?? '')} thumb={ad.thumbnail_path ? data.thumbs[ad.thumbnail_path] : undefined} />
        ))}
      </ul>
    </>
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
    <li>
      <Link to={`${base}/w/${workspaceId}/ads/${ad.ad_id}`}
        className="group block overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] transition hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-xl hover:shadow-black/40">
        <div className="relative aspect-[4/5] bg-gradient-to-br from-[#1d1838] to-[#2c2552]">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" loading="lazy" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 text-white/40">
              {isVideo ? <Play size={22} /> : <ImageIcon size={22} />}
              <span className="text-xs">{isVideo ? 'Video' : 'Static'}</span>
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent" aria-hidden />
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {ad.status && ad.status !== 'ACTIVE' && <Badge className="bg-black/60 text-white/80 backdrop-blur">{ad.status.toLowerCase()}</Badge>}
            {lowData && <Badge tone="warn" className="bg-black/60 backdrop-blur" title={`Fewer than ${LOW_DATA_IMPRESSIONS.toLocaleString()} impressions`}>low data</Badge>}
          </div>
          {isVideo && ad.duration_s != null && (
            <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/90 backdrop-blur">{fmt.seconds(ad.duration_s)}</span>
          )}
        </div>
        <div className="p-3">
          <p className="truncate text-sm font-medium" title={ad.name ?? ''}>{ad.name ?? ad.external_id}</p>
          <div className="mt-1.5 flex min-h-5 flex-wrap gap-1">
            {chips.map((c) => <Badge key={c}>{c}</Badge>)}
            {userTags.map((t) => (
              <Badge key={t.id}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color ?? '#a3a3a3' }} aria-hidden />
                {t.name}
              </Badge>
            ))}
          </div>
          <dl className="mt-3 grid grid-cols-4 gap-1 border-t border-[var(--line)] pt-2.5 text-[11px]">
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
    <div className="min-w-0">
      <dt className="text-[var(--faint)]">{label}</dt>
      <dd className="truncate font-mono tabular-nums text-[var(--text)]">{value}</dd>
    </div>
  )
}
