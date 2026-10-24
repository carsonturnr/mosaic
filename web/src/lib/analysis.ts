import { supabase } from './supabase'

// Mirrors worker/src/mosaic/analytics/compute.py (Snapshot). Keep in sync.

export type Metric = 'roas' | 'cpa' | 'ctr' | 'hook_rate' | 'hold_rate' | 'cvr'
export type WindowKey = '7' | '30' | '90' | 'all'
export type Verdict = 'winner' | 'loser' | 'neutral' | 'low_data'

export interface Est {
  value: number | null
  low: number | null
  high: number | null
  raw: number | null
}

export interface Totals {
  spend: number
  impressions: number
  clicks: number
  link_clicks: number
  purchases: number
  purchase_value: number
  video_3s_views: number
  video_thruplays: number
  video_impressions: number
}

export interface AdStats {
  ad_id: string
  external_id: string
  name: string
  creative_type: string
  format: string | null
  hook_type: string | null
  totals: Totals
  kpis: Record<Metric, Est>
  spend_share: number
  low_data: boolean
  flags: string[]
}

export interface TagValueStats {
  value: string
  n_ads: number
  ad_ids: string[]
  totals: Totals
  spend_share: number
  kpis: Record<Metric, Est>
  verdict: Record<Metric, Verdict>
}

export interface WeekPoint {
  week: string
  spend: number
  impressions: number
  roas: number | null
  ctr: number | null
  hook_rate: number | null
}

export interface Snapshot {
  since: string
  until: string
  account: Totals
  account_kpis: Record<Metric, number | null>
  ads: AdStats[]
  tags: Record<string, TagValueStats[]>
  trends: Record<string, Record<string, WeekPoint[]>>
  outliers: { ad_id: string; metric: Metric; z: number; direction: 'high' | 'low'; peer_group: string; value: number }[]
  fatigue: { ad_id: string; metric: 'ctr' | 'hook_rate'; early: number; late: number; change: number; p_value: number }[]
  underfunded: { ad_id: string; metric: Metric; low: number; account: number; spend_share: number }[]
}

export interface SnapshotRow {
  window_key: WindowKey
  since: string
  until: string
  computed_at: string
  payload: Snapshot
}

export async function fetchSnapshot(workspaceId: string, window: WindowKey): Promise<SnapshotRow | null> {
  const { data, error } = await supabase
    .from('analysis_snapshots')
    .select('window_key, since, until, computed_at, payload')
    .eq('workspace_id', workspaceId)
    .eq('window_key', window)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as unknown as SnapshotRow | null
}

/** Reference value a tag dimension's verdicts were computed against (ads carrying it). */
export function dimensionReference(rows: TagValueStats[], metric: Metric): number | null {
  const t = rows.reduce<Totals | null>((acc, r) => {
    if (!acc) return { ...r.totals }
    const out = { ...acc }
    for (const k of Object.keys(out) as (keyof Totals)[]) out[k] += r.totals[k]
    return out
  }, null)
  if (!t) return null
  const div = (a: number, b: number) => (b ? a / b : null)
  switch (metric) {
    case 'roas': return div(t.purchase_value, t.spend)
    case 'cpa': return div(t.spend, t.purchases)
    case 'ctr': return div(t.clicks, t.impressions)
    case 'hook_rate': return div(t.video_3s_views, t.video_impressions)
    case 'hold_rate': return div(t.video_thruplays, t.video_3s_views)
    case 'cvr': return div(t.purchases, t.link_clicks)
  }
}
