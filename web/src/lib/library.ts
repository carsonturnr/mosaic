import { supabase } from './supabase'

/** One row of ad_performance(). Rates are null when their denominator is zero. */
export interface AdPerf {
  ad_id: string
  external_id: string
  name: string | null
  status: string | null
  creative_id: string | null
  creative_type: 'video' | 'image' | 'carousel' | null
  storage_path: string | null
  thumbnail_path: string | null
  duration_s: number | null
  perception_status: string | null
  first_date: string | null
  last_date: string | null
  active_days: number
  spend: number
  impressions: number
  clicks: number
  link_clicks: number
  purchases: number
  purchase_value: number
  video_3s_views: number | null
  video_thruplays: number | null
  ctr: number | null
  cpc: number | null
  cpm: number | null
  cpa: number | null
  roas: number | null
  hook_rate: number | null
  hold_rate: number | null
}

export interface CreativeTag {
  creative_id: string
  dimension_key: string
  value: string
  confidence: number | null
  source: 'ai' | 'user'
  model: string | null
}

export type Window = 'all' | '90' | '30' | '7'

export function windowRange(w: Window): { since?: string; until?: string } {
  if (w === 'all') return {}
  const until = new Date()
  const since = new Date(until)
  since.setDate(since.getDate() - Number(w) + 1)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { since: iso(since), until: iso(until) }
}

export async function fetchPerformance(workspaceId: string, w: Window): Promise<AdPerf[]> {
  const { since, until } = windowRange(w)
  const { data, error } = await supabase.rpc('ad_performance', {
    p_workspace: workspaceId,
    ...(since ? { p_since: since } : {}),
    ...(until ? { p_until: until } : {}),
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as AdPerf[]
}

export async function fetchTags(creativeIds: string[]): Promise<CreativeTag[]> {
  if (creativeIds.length === 0) return []
  const { data, error } = await supabase
    .from('creative_tags')
    .select('creative_id, dimension_key, value, confidence, source, model')
    .in('creative_id', creativeIds)
  if (error) throw new Error(error.message)
  return data as CreativeTag[]
}

/** Signed URLs for private storage paths; missing paths map to undefined. */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return {}
  const { data, error } = await supabase.storage.from('creatives').createSignedUrls(unique, 3600)
  if (error) throw new Error(error.message)
  const out: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl) out[item.path] = item.signedUrl
  return out
}

export function tagsByCreative(tags: CreativeTag[]): Map<string, Map<string, CreativeTag>> {
  const out = new Map<string, Map<string, CreativeTag>>()
  for (const t of tags) {
    const m = out.get(t.creative_id) ?? new Map<string, CreativeTag>()
    const prev = m.get(t.dimension_key)
    // a user tag beats an AI tag for the same dimension
    if (!prev || (t.source === 'user' && prev.source !== 'user')) m.set(t.dimension_key, t)
    out.set(t.creative_id, m)
  }
  return out
}

/** Below this, rankings are noise; the UI marks the ad as low data. */
export const LOW_DATA_IMPRESSIONS = 5000
