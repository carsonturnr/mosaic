import { supabase } from './supabase'

export type AppliesTo = 'ad' | 'hook' | 'scene'

export interface Dimension {
  key: string
  label: string
  description: string | null
  allowedValues: string[] | null // null = free text
  appliesTo: AppliesTo
  /** 'default' = system only, 'override' = workspace edit of a default, 'custom' = workspace only */
  origin: 'default' | 'override' | 'custom'
  rowId: string | null // workspace row id, if any
}

interface Row {
  id: string
  workspace_id: string | null
  key: string
  label: string
  description: string | null
  allowed_values: unknown
  applies_to: string
}

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/

export function validKey(key: string): boolean {
  return KEY_RE.test(key)
}

/** Clean a list of values typed one per line: trim, drop blanks, dedupe case-insensitively. */
export function parseValues(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const v = raw.trim()
    if (!v || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    out.push(v)
  }
  return out
}

function toValues(v: unknown): string[] | null {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null
}

/** System defaults overlaid with the workspace's rows (same rule the worker uses). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function fetchTaxonomy(workspaceId: string): Promise<Dimension[]> {
  // the id goes into a PostgREST filter string, so only ever accept a UUID
  if (!UUID_RE.test(workspaceId)) throw new Error('Invalid workspace id')
  const { data, error } = await supabase
    .from('taxonomy_dimensions')
    .select('id, workspace_id, key, label, description, allowed_values, applies_to')
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
  if (error) throw new Error(error.message)
  const rows = data as Row[]
  const system = new Map(rows.filter((r) => r.workspace_id === null).map((r) => [r.key, r]))
  const mine = new Map(rows.filter((r) => r.workspace_id === workspaceId).map((r) => [r.key, r]))
  const keys = [...new Set([...system.keys(), ...mine.keys()])]
  return keys.map((key) => {
    const r = mine.get(key) ?? system.get(key)!
    return {
      key,
      label: r.label,
      description: r.description,
      allowedValues: toValues(r.allowed_values),
      appliesTo: (r.applies_to as AppliesTo) ?? 'ad',
      origin: mine.has(key) ? (system.has(key) ? 'override' : 'custom') : 'default',
      rowId: mine.get(key)?.id ?? null,
    }
  })
}

export async function saveDimension(
  workspaceId: string,
  d: Pick<Dimension, 'key' | 'label' | 'description' | 'allowedValues' | 'appliesTo'>,
): Promise<void> {
  if (!validKey(d.key)) throw new Error('Key must be lowercase letters, numbers and underscores, starting with a letter.')
  if (!d.label.trim()) throw new Error('Label is required.')
  const { error } = await supabase.from('taxonomy_dimensions').upsert(
    {
      workspace_id: workspaceId,
      key: d.key,
      label: d.label.trim(),
      description: d.description?.trim() || null,
      allowed_values: d.allowedValues,
      applies_to: d.appliesTo,
    },
    { onConflict: 'workspace_id,key' },
  )
  if (error) throw new Error(error.message)
}

/** Remove the workspace row: an override falls back to the default, a custom dimension disappears. */
export async function deleteWorkspaceDimension(rowId: string): Promise<void> {
  const { error } = await supabase.from('taxonomy_dimensions').delete().eq('id', rowId)
  if (error) throw new Error(error.message)
}

// --- custom tags -------------------------------------------------------------------

export interface CustomTag {
  id: string
  name: string
  color: string | null
}

export const TAG_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'] as const

export async function fetchCustomTags(workspaceId: string): Promise<CustomTag[]> {
  const { data, error } = await supabase
    .from('custom_tags')
    .select('id, name, color')
    .eq('workspace_id', workspaceId)
    .order('name')
  if (error) throw new Error(error.message)
  return data as CustomTag[]
}

export async function createCustomTag(workspaceId: string, name: string, color: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Tag name is required.')
  const { error } = await supabase.from('custom_tags').insert({ workspace_id: workspaceId, name: trimmed, color })
  if (error) throw new Error(error.code === '23505' ? `A tag named "${trimmed}" already exists.` : error.message)
}

export async function deleteCustomTag(id: string): Promise<void> {
  const { error } = await supabase.from('custom_tags').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function fetchAdCustomTags(adIds: string[]): Promise<{ ad_id: string; custom_tag_id: string }[]> {
  if (adIds.length === 0) return []
  const { data, error } = await supabase.from('ad_custom_tags').select('ad_id, custom_tag_id').in('ad_id', adIds)
  if (error) throw new Error(error.message)
  return data as { ad_id: string; custom_tag_id: string }[]
}

export async function setAdCustomTag(adId: string, tagId: string, on: boolean): Promise<void> {
  const q = on
    ? supabase.from('ad_custom_tags').upsert({ ad_id: adId, custom_tag_id: tagId }, { onConflict: 'ad_id,custom_tag_id' })
    : supabase.from('ad_custom_tags').delete().eq('ad_id', adId).eq('custom_tag_id', tagId)
  const { error } = await q
  if (error) throw new Error(error.message)
}
