import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Tags } from 'lucide-react'
import { Button, EmptyState, ErrorText, Loading, PageHeader } from '../components/ui'
import { signedUrls } from '../lib/library'
import { supabase } from '../lib/supabase'
import { fetchTaxonomy, type Dimension } from '../lib/taxonomy'
import type { Tables } from '../lib/types'
import { useAsync } from '../lib/useAsync'

// The fields the tagging eval scores (worker: mosaic.evals.tagging.FIELDS).
const FIELDS = ['hook_type', 'angle', 'format', 'offer', 'proof_type', 'cta']

type Creative = Pick<Tables<'creatives'>, 'id' | 'external_id' | 'type' | 'storage_path' | 'thumbnail_path'>
type Labels = Record<string, Record<string, string>> // creative id -> dimension -> value

interface LabelData {
  workspaceName: string | undefined
  creatives: Creative[]
  dims: Dimension[]
  labels: Labels
  urls: Record<string, string>
}

/** `only`: ad refs to restrict the set to (?ads=ref1,ref2), for labeling a sample. */
async function load(workspaceId: string, only: string[]): Promise<LabelData> {
  const [ws, cr, taxonomy] = await Promise.all([
    supabase.from('workspaces').select('name').eq('id', workspaceId).single(),
    supabase
      .from('creatives')
      .select('id, external_id, type, storage_path, thumbnail_path')
      .eq('workspace_id', workspaceId)
      .not('storage_path', 'is', null)
      .order('external_id'),
    fetchTaxonomy(workspaceId),
  ])
  // RLS hides other owners' workspaces, so a missing row means "not yours", not "empty"
  if (ws.error || !ws.data) throw new Error('Workspace not found, or it belongs to another account.')
  if (cr.error) throw new Error(cr.error.message)
  const all = cr.data as Creative[]
  const wanted = new Set(only.map((r) => r.replace(/^cr_/, '')))
  const creatives = wanted.size ? all.filter((c) => wanted.has(c.external_id.replace(/^cr_/, ''))) : all
  const ids = creatives.map((c) => c.id)
  const { data: rows, error } = ids.length
    ? await supabase.from('tag_labels').select('creative_id, dimension_key, value').in('creative_id', ids)
    : { data: [], error: null }
  if (error) throw new Error(error.message)
  const labels: Labels = {}
  for (const r of rows ?? []) (labels[r.creative_id] ??= {})[r.dimension_key] = r.value
  const urls = await signedUrls(creatives.flatMap((c) => [c.storage_path ?? '', c.thumbnail_path ?? '']))
  const dims = FIELDS.map((k) => taxonomy.find((d) => d.key === k)).filter(
    (d): d is Dimension => !!d && !!d.allowedValues?.length,
  )
  return { workspaceName: ws.data?.name, creatives, dims, labels, urls }
}

function fieldsFor(dims: Dimension[], c: Creative): Dimension[] {
  return dims.filter((d) => d.key !== 'hook_type' || c.type === 'video')
}

export function Label() {
  const { id = '' } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const ads = params.get('ads') ?? ''
  const { data, error, loading } = useAsync(
    () => load(id, ads.split(',').map((a) => a.trim()).filter(Boolean)),
    [id, ads],
  )
  const [labels, setLabels] = useState<Labels>({})
  const [index, setIndex] = useState(0)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const creatives = useMemo(() => data?.creatives ?? [], [data])
  const done = (c: Creative) => !!data && fieldsFor(data.dims, c).every((d) => labels[c.id]?.[d.key])

  useEffect(() => {
    if (!data) return
    setLabels(data.labels)
    const first = data.creatives.findIndex((c) => !fieldsFor(data.dims, c).every((d) => data.labels[c.id]?.[d.key]))
    setIndex(first === -1 ? 0 : first)
  }, [data])

  const current = creatives[index]
  useEffect(() => {
    setDraft(current ? { ...(labels[current.id] ?? {}) } : {})
    setSaveError(null)
    // reset only when the ad changes, not when labels update after a save
  }, [current?.id])

  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorText>{error ?? 'Not found'}</ErrorText>

  const header = (
    <PageHeader title="Label ads"
      description="Label what you see. Mosaic's own tags are hidden here so they can't steer you; accuracy appears on the Evals page after the next eval run." />
  )
  if (!current) {
    return (
      <>
        {header}
        <EmptyState icon={<Tags size={18} />} title="Nothing to label">No ads with media in this workspace.</EmptyState>
      </>
    )
  }

  const fields = fieldsFor(data.dims, current)
  const complete = fields.every((d) => draft[d.key])
  const labeled = creatives.filter(done).length
  const media = current.storage_path ? data.urls[current.storage_path] : undefined
  const poster = current.thumbnail_path ? data.urls[current.thumbnail_path] : undefined

  const nextUnlabeled = (from: number, next: Labels): number => {
    for (let step = 1; step <= creatives.length; step++) {
      const i = (from + step) % creatives.length
      const c = creatives[i]!
      if (!fieldsFor(data.dims, c).every((d) => next[c.id]?.[d.key])) return i
    }
    return Math.min(from + 1, creatives.length - 1)
  }

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    const rows = fields.map((d) => ({ creative_id: current.id, dimension_key: d.key, value: draft[d.key]! }))
    const { error: err } = await supabase.from('tag_labels').upsert(rows, { onConflict: 'creative_id,dimension_key' })
    setSaving(false)
    if (err) {
      setSaveError(err.message)
      return
    }
    const next = { ...labels, [current.id]: { ...(labels[current.id] ?? {}), ...draft } }
    setLabels(next)
    setIndex(nextUnlabeled(index, next))
  }

  return (
    <>
      {header}
      <div className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-[var(--muted)]">Progress</span>
          <span className="font-mono tabular-nums"><span className="text-[var(--text)]">{labeled}</span> <span className="text-[var(--faint)]">/ {creatives.length}</span></span>
        </div>
        <div className="mt-2 h-1 rounded-full bg-white/[0.06]">
          <div className="h-1 rounded-full bg-[var(--accent)] transition-all" style={{ width: `${(labeled / creatives.length) * 100}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Ads">
          {creatives.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setIndex(i)}
              title={c.external_id}
              aria-label={`Ad ${i + 1}${done(c) ? ', labeled' : ''}`}
              aria-current={i === index}
              className={`h-2.5 w-2.5 rounded-full transition ${i === index ? 'ring-2 ring-[var(--accent-2)] ring-offset-2 ring-offset-[var(--panel)]' : ''} ${done(c) ? 'bg-[var(--accent)]' : 'bg-white/15 hover:bg-white/30'}`}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="md:sticky md:top-8 md:self-start">
          <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-black">
            {current.type === 'video' ? (
              <video key={current.id} src={media} poster={poster} controls playsInline className="max-h-[70vh] w-full" />
            ) : (
              <img src={media} alt="" className="max-h-[70vh] w-full object-contain" />
            )}
          </div>
          <p className="mt-2 font-mono text-xs text-[var(--faint)]">
            Ad {index + 1} · {current.type} · {current.external_id}
          </p>
        </div>

        <div className="space-y-4">
          {fields.map((d) => (
            <fieldset key={d.key} className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
              <legend className="sr-only">{d.label}</legend>
              <p className="text-sm font-medium" aria-hidden>{d.label}</p>
              {d.description && <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{d.description}</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {d.allowedValues!.map((v) => {
                  const on = draft[d.key] === v
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDraft({ ...draft, [d.key]: v })}
                      className={`rounded-full border px-3 py-1 text-sm transition ${on ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]' : 'border-[var(--line-strong)] text-[var(--muted)] hover:border-white/25 hover:text-[var(--text)]'}`}
                    >
                      {v}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          ))}

          <ErrorText>{saveError}</ErrorText>
          <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 bg-[var(--bg)]/90 px-1 py-3 backdrop-blur">
            <Button variant="primary" onClick={() => void save()} disabled={!complete || saving}>
              {saving ? 'Saving…' : 'Save and next'}
            </Button>
            <Button variant="ghost" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>Back</Button>
            <Button variant="ghost" onClick={() => setIndex((index + 1) % creatives.length)}>Skip</Button>
            {!complete && <span className="text-xs text-[var(--faint)]">Pick one value per field to save.</span>}
          </div>
        </div>
      </div>
    </>
  )
}
