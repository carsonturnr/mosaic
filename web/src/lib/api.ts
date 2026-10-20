import { supabase } from './supabase'

const base = (import.meta.env.VITE_WORKER_API_URL ?? '').replace(/\/$/, '')

export interface SyncRunSummary {
  job: string
  status: string
  stats: Record<string, unknown> | null
}

export interface MetaAdAccount {
  id: string
  name: string
  account_status: number | null
  currency: string | null
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  if (!base) throw new Error('VITE_WORKER_API_URL is not set')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('not signed in')
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text.slice(0, 300)}`)
  }
  return (await res.json()) as T
}

export const workerApi = {
  refresh: (workspaceId: string) =>
    call<{ runs: SyncRunSummary[] }>(`/workspaces/${workspaceId}/refresh`),
  metaAdAccounts: (userAccessToken: string) =>
    call<MetaAdAccount[]>('/meta/adaccounts', { user_access_token: userAccessToken }),
  metaConnect: (workspaceId: string, userAccessToken: string, adAccountId: string) =>
    call<{ data_source_id: string; backfill_started: boolean }>(
      `/workspaces/${workspaceId}/meta/connect`,
      { user_access_token: userAccessToken, ad_account_id: adAccountId },
    ),
}
