import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BrandMemory } from '../components/BrandMemory'
import { Button, Card, PageHeader } from '../components/ui'
import { workerApi } from '../lib/api'
import { supabase } from '../lib/supabase'
import {
  createCustomTag,
  deleteCustomTag,
  deleteWorkspaceDimension,
  fetchCustomTags,
  fetchTaxonomy,
  parseValues,
  saveDimension,
  TAG_COLORS,
  validKey,
  type AppliesTo,
  type Dimension,
} from '../lib/taxonomy'
import { useAsync } from '../lib/useAsync'

const APPLIES_LABEL: Record<AppliesTo, string> = { ad: 'Whole ad', hook: 'Hook (first 3 s)', scene: 'Each scene' }
const ORIGIN_LABEL: Record<Dimension['origin'], string> = { default: 'Default', override: 'Edited', custom: 'Yours' }
/** Filled in by the pipeline, not asked of the AI, so editing them would have no effect. */
const COMPUTED: Record<string, string> = { length_bucket: 'Computed from video length' }

export function Settings() {
  const { id = '' } = useParams<{ id: string }>()
  const taxonomy = useAsync(() => fetchTaxonomy(id), [id])
  const tags = useAsync(() => fetchCustomTags(id), [id])
  const [editing, setEditing] = useState<string | null>(null) // dimension key, or '__new__'
  const [error, setError] = useState<string | null>(null)

  const act = async (fn: () => Promise<void>, after: () => void) => {
    setError(null)
    try {
      await fn()
      after()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" description="The taxonomy the AI tags with, your own tags, and the brand memory briefs follow." />
      {error && <p className="mb-4 rounded-xl border border-[var(--bad)]/30 bg-[var(--bad-soft)] px-4 py-3 text-sm text-[var(--bad)]">{error}</p>}

      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Taxonomy</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
              The dimensions the AI tags every ad with. Edit them to match your media-buying framework; new ads are tagged
              against the current list. Leave values empty to let the AI answer in free text.
            </p>
          </div>
          <button type="button" onClick={() => setEditing('__new__')}
            className="shrink-0 rounded-lg border border-[var(--line-strong)] bg-[var(--panel-2)] px-3 py-1.5 text-sm font-medium hover:border-white/25">
            Add dimension
          </button>
        </div>

        {editing === '__new__' && (
          <DimensionForm
            initial={null}
            onCancel={() => setEditing(null)}
            onSave={(d) => act(() => saveDimension(id, d), () => { setEditing(null); taxonomy.reload() })}
            existingKeys={(taxonomy.data ?? []).map((d) => d.key)}
          />
        )}

        {taxonomy.loading && !taxonomy.data && <p className="mt-4 text-sm text-[var(--muted)]">Loading…</p>}
        <ul className="mt-4 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--panel)]">
          {(taxonomy.data ?? []).map((d) => (
            <li key={d.key} className="p-4">
              {editing === d.key ? (
                <DimensionForm
                  initial={d}
                  onCancel={() => setEditing(null)}
                  onSave={(next) => act(() => saveDimension(id, next), () => { setEditing(null); taxonomy.reload() })}
                  existingKeys={[]}
                />
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {d.label} <span className="font-mono text-xs font-normal text-[var(--faint)]">{d.key}</span>
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-normal ${d.origin === 'default' ? 'bg-white/[0.06] text-[var(--muted)]' : 'bg-[var(--accent-soft)] text-[var(--accent-2)]'}`}>
                        {ORIGIN_LABEL[d.origin]}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {APPLIES_LABEL[d.appliesTo]}{d.description ? ` · ${d.description}` : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {d.allowedValues === null ? (
                        <span className="text-xs italic text-[var(--muted)]">Free text</span>
                      ) : (
                        d.allowedValues.map((v) => (
                          <span key={v} className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-xs text-[var(--text-2)]">{v}</span>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-3 text-sm">
                    {COMPUTED[d.key] ? (
                      <span className="text-xs text-[var(--muted)]">{COMPUTED[d.key]}</span>
                    ) : (
                      <button type="button" className="text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setEditing(d.key)}>Edit</button>
                    )}
                    {d.rowId && (
                      <ConfirmButton
                        label={d.origin === 'override' ? 'Reset' : 'Delete'}
                        confirm={d.origin === 'override' ? 'Reset to default?' : 'Delete this dimension?'}
                        onConfirm={() => act(() => deleteWorkspaceDimension(d.rowId!), taxonomy.reload)}
                      />
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-base font-semibold">Custom tags</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Your own labels for ads, such as a test batch or a creator. Apply them from an ad's page.</p>
        <NewTagForm onCreate={(name, color) => act(() => createCustomTag(id, name, color), tags.reload)} />
        {tags.data && tags.data.length === 0 && <p className="mt-3 text-sm text-[var(--muted)]">No custom tags yet.</p>}
        <ul className="mt-3 flex flex-wrap gap-2">
          {(tags.data ?? []).map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--panel)] py-1 pl-2.5 pr-3 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color ?? '#a3a3a3' }} aria-hidden />
              {t.name}
              <ConfirmButton label="×" confirm={`Delete "${t.name}"?`} ariaLabel={`Delete ${t.name}`}
                onConfirm={() => act(() => deleteCustomTag(t.id), tags.reload)} />
            </li>
          ))}
        </ul>
      </section>
      <BrandMemory workspaceId={id} />
      <DataControls workspaceId={id} onError={setError} />
    </div>
  )
}

/** Meta's data deletion requirement: disconnect, or delete the workspace and everything in it. */
function DataControls({ workspaceId, onError }: { workspaceId: string; onError: (e: string | null) => void }) {
  const navigate = useNavigate()
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)
  const info = useAsync(async () => {
    const [ws, meta] = await Promise.all([
      supabase.from('workspaces').select('name, is_demo').eq('id', workspaceId).single(),
      supabase.from('data_sources').select('meta_ad_account_id, last_synced_at').eq('workspace_id', workspaceId).eq('kind', 'meta_live'),
    ])
    return { name: ws.data?.name ?? '', isDemo: ws.data?.is_demo ?? false, meta: meta.data ?? [] }
  }, [workspaceId])

  const run = async (fn: () => Promise<void>) => {
    onError(null)
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const disconnect = () => run(async () => { await workerApi.metaDisconnect(workspaceId); info.reload() })
  const remove = () => run(async () => { await workerApi.deleteWorkspace(workspaceId); navigate('/app') })

  if (!info.data) return null
  const { name, isDemo, meta } = info.data
  return (
    <section className="mt-12">
      <h2 className="text-base font-semibold">Data</h2>
      <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
        Disconnecting deletes the stored Meta access token and stops syncing. Deleting the workspace removes every ad,
        file, tag, report and token in it. Neither can be undone.
      </p>
      <Card className="mt-4 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Meta connection</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {meta.length
                ? `${meta.map((m) => m.meta_ad_account_id).join(', ')}${meta[0]?.last_synced_at ? ` · last synced ${new Date(meta[0].last_synced_at).toLocaleString()}` : ''}`
                : 'Not connected. Connect an ad account from the Overview.'}
            </p>
          </div>
          {meta.length > 0 && (
            <ConfirmButton label="Disconnect" confirm="Disconnect Meta?" onConfirm={() => void disconnect()} />
          )}
        </div>
        {!isDemo && (
          <div className="border-t border-[var(--line)] pt-5">
            <p className="text-sm font-medium">Delete workspace</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">Type <span className="font-mono text-[var(--text-2)]">{name}</span> to confirm.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="Workspace name"
                className="h-9 flex-1 px-3 text-sm" />
              <Button variant="danger" disabled={busy || confirmName !== name} onClick={() => void remove()}>
                {busy ? 'Deleting…' : 'Delete workspace'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </section>
  )
}

function DimensionForm({ initial, onSave, onCancel, existingKeys }: {
  initial: Dimension | null
  onSave: (d: Pick<Dimension, 'key' | 'label' | 'description' | 'allowedValues' | 'appliesTo'>) => void
  onCancel: () => void
  existingKeys: string[]
}) {
  const [key, setKey] = useState(initial?.key ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [values, setValues] = useState((initial?.allowedValues ?? []).join('\n'))
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(initial?.appliesTo ?? 'ad')
  const isNew = initial === null
  const keyProblem = isNew && key && (!validKey(key) ? 'Use lowercase letters, numbers and underscores.' : existingKeys.includes(key) ? 'That key already exists.' : null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (keyProblem) return
    const parsed = parseValues(values)
    onSave({ key, label, description, allowedValues: parsed.length ? parsed : null, appliesTo })
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 rounded-xl border border-[var(--line-strong)] bg-[var(--panel-2)] p-4 text-sm sm:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--muted)]">Label</span>
        <input required value={label} onChange={(e) => setLabel(e.target.value)} className="px-2 py-1.5" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--muted)]">Key</span>
        <input required value={key} disabled={!isNew} onChange={(e) => setKey(e.target.value.toLowerCase())}
          placeholder="e.g. creator" className="px-2 py-1.5 font-mono disabled:opacity-50" />
        {keyProblem && <span className="text-xs text-[var(--bad)]">{keyProblem}</span>}
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-xs text-[var(--muted)]">What it means (shown to the AI)</span>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className="px-2 py-1.5" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--muted)]">Allowed values, one per line (empty = free text)</span>
        <textarea rows={7} value={values} onChange={(e) => setValues(e.target.value)} className="px-2 py-1.5 font-mono text-xs" />
      </label>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--muted)]">Applies to</span>
          <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as AppliesTo)} className="px-2 py-1.5">
            {(Object.keys(APPLIES_LABEL) as AppliesTo[]).map((a) => <option key={a} value={a}>{APPLIES_LABEL[a]}</option>)}
          </select>
        </label>
        <div className="mt-auto flex gap-2">
          <button type="submit" className="rounded-lg bg-[var(--text)] px-3 py-1.5 font-medium text-[var(--bg)] hover:bg-white">Save</button>
          <button type="button" onClick={onCancel} className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 hover:bg-[var(--hover)]">Cancel</button>
        </div>
      </div>
    </form>
  )
}

function NewTagForm({ onCreate }: { onCreate: (name: string, color: string) => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(TAG_COLORS[0])
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onCreate(name, color); setName('') } }}
      className="mt-3 flex flex-wrap items-center gap-2 text-sm"
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag name"
        className="px-2 py-1.5" aria-label="New tag name" />
      <div className="flex gap-1" role="radiogroup" aria-label="Tag color">
        {TAG_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={`Color ${c}`} onClick={() => setColor(c)}
            className={`h-6 w-6 rounded-full border-2 ${c === color ? 'border-[var(--text)]' : 'border-transparent'}`} style={{ background: c }} />
        ))}
      </div>
      <button type="submit" className="rounded-lg bg-[var(--text)] px-3 py-1.5 font-medium text-[var(--bg)] hover:bg-white">Add tag</button>
    </form>
  )
}

/** Two-step button instead of window.confirm. */
function ConfirmButton({ label, confirm, onConfirm, ariaLabel }: { label: string; confirm: string; onConfirm: () => void; ariaLabel?: string }) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button type="button" aria-label={ariaLabel} className="text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="text-[var(--muted)]">{confirm}</span>
      <button type="button" className="font-medium text-[var(--bad)]" onClick={() => { setAsking(false); onConfirm() }}>Yes</button>
      <button type="button" className="text-[var(--muted)]" onClick={() => setAsking(false)}>No</button>
    </span>
  )
}
