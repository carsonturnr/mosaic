import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { WorkspaceNav } from '../components/WorkspaceNav'
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

async function load(workspaceId: string): Promise<LabelData> {
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
  if (cr.error) throw new Error(cr.error.message)
  const creatives = cr.data as Creative[]
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
  const { data, error, loading } = useAsync(() => load(id), [id])
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

  if (loading && !data) return <main className="mx-auto max-w-6xl p-6 text-sm text-neutral-500">Loading…</main>
  if (error || !data) return <main className="mx-auto max-w-6xl p-6 text-sm text-red-700">{error ?? 'Not found'}</main>

  const nav = <WorkspaceNav id={id} name={data.workspaceName} />
  if (!current) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        {nav}
        <p className="text-sm text-neutral-500">No ads with media to label in this workspace.</p>
      </main>
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
    <main className="mx-auto max-w-6xl p-6">
      {nav}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="max-w-2xl text-sm text-neutral-600">
          Label what you see. Mosaic's own tags are hidden here so they can't steer you; scores appear on the Evals page
          after the next eval run.
        </p>
        <span className="text-sm tabular-nums text-neutral-500">
          {labeled} of {creatives.length} labeled
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1" aria-label="Ads">
        {creatives.map((c, i) => (
          <button
            key={c.id}
            onClick={() => setIndex(i)}
            title={c.external_id}
            aria-label={`Ad ${i + 1}${done(c) ? ', labeled' : ''}`}
            aria-current={i === index}
            className={`h-2.5 w-2.5 rounded-full ${i === index ? 'ring-2 ring-neutral-900 ring-offset-1' : ''} ${done(c) ? 'bg-neutral-900' : 'bg-neutral-300'}`}
          />
        ))}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          <div className="overflow-hidden rounded-lg bg-neutral-100">
            {current.type === 'video' ? (
              <video key={current.id} src={media} poster={poster} controls playsInline className="max-h-[70vh] w-full" />
            ) : (
              <img src={media} alt="" className="max-h-[70vh] w-full object-contain" />
            )}
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Ad {index + 1} · {current.type} · {current.external_id}
          </p>
        </div>

        <div className="space-y-5">
          {fields.map((d) => (
            <fieldset key={d.key}>
              <legend className="text-sm font-medium">{d.label}</legend>
              {d.description && <p className="text-xs text-neutral-500">{d.description}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.allowedValues!.map((v) => {
                  const on = draft[d.key] === v
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDraft({ ...draft, [d.key]: v })}
                      className={`rounded-full border px-3 py-1 text-sm ${on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 text-neutral-700 hover:border-neutral-500'}`}
                    >
                      {v}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          ))}

          {saveError && <p className="text-sm text-red-700">{saveError}</p>}
          <div className="flex items-center gap-2 border-t border-neutral-200 pt-4">
            <button
              onClick={save}
              disabled={!complete || saving}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save and next'}
            </button>
            <button
              onClick={() => setIndex(Math.max(0, index - 1))}
              disabled={index === 0}
              className="rounded-md px-3 py-2 text-sm text-neutral-600 hover:text-neutral-900 disabled:opacity-40"
            >
              Back
            </button>
            <button
              onClick={() => setIndex((index + 1) % creatives.length)}
              className="rounded-md px-3 py-2 text-sm text-neutral-600 hover:text-neutral-900"
            >
              Skip
            </button>
            {!complete && <span className="text-xs text-neutral-500">Pick one value per field to save.</span>}
          </div>
        </div>
      </div>
    </main>
  )
}
