import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { WorkspaceNav } from '../components/WorkspaceNav'
import { workerApi, type MetaAdAccount } from '../lib/api'
import { loginWithFacebook } from '../lib/meta'
import { supabase } from '../lib/supabase'
import type { DataSource, SyncRun, Workspace as WorkspaceRow } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { useWorkspaceMode } from '../lib/workspaceBase'

interface Counts {
  campaigns: number
  ads: number
  creatives: number
}

interface Overview {
  workspace: WorkspaceRow
  sources: DataSource[]
  runs: SyncRun[]
  counts: Counts
}

export function Workspace() {
  const { id } = useParams<{ id: string }>()
  const { readOnly } = useWorkspaceMode()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fbToken, setFbToken] = useState<string | null>(null)
  const [adAccounts, setAdAccounts] = useState<MetaAdAccount[]>([])

  const overview = useAsync(async (): Promise<Overview | undefined> => {
    if (!id) return undefined
    const [ws, ds, cCamp, cAds, cCr] = await Promise.all([
      supabase.from('workspaces').select('*').eq('id', id).single(),
      supabase.from('data_sources').select('*').eq('workspace_id', id),
      supabase.from('campaigns').select('id', { count: 'exact', head: true }).eq('workspace_id', id),
      supabase.from('ads').select('id', { count: 'exact', head: true }).eq('workspace_id', id),
      supabase.from('creatives').select('id', { count: 'exact', head: true }).eq('workspace_id', id),
    ])
    if (ws.error) throw new Error(ws.error.message)
    const sources = (ds.data ?? []) as DataSource[]
    let runs: SyncRun[] = []
    if (sources.length > 0) {
      const r = await supabase
        .from('sync_runs')
        .select('*')
        .in(
          'data_source_id',
          sources.map((d) => d.id),
        )
        .order('started_at', { ascending: false })
        .limit(10)
      runs = (r.data ?? []) as SyncRun[]
    }
    return {
      workspace: ws.data as WorkspaceRow,
      sources,
      runs,
      counts: { campaigns: cCamp.count ?? 0, ads: cAds.count ?? 0, creatives: cCr.count ?? 0 },
    }
  }, [id])
  const workspace = overview.data?.workspace ?? null
  const sources = overview.data?.sources ?? []
  const runs = overview.data?.runs ?? []
  const counts = overview.data?.counts ?? null

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      overview.reload()
    }
  }

  const refresh = () =>
    run('refresh', async () => {
      if (id) await workerApi.refresh(id)
    })

  const startConnect = () =>
    run('connect', async () => {
      const token = await loginWithFacebook()
      setFbToken(token)
      setAdAccounts(await workerApi.metaAdAccounts(token))
    })

  const finishConnect = (accountId: string) =>
    run('connect', async () => {
      if (!id || !fbToken) return
      await workerApi.metaConnect(id, fbToken, accountId)
      setFbToken(null)
      setAdAccounts([])
    })

  if (!id) return null

  return (
    <main className="mx-auto max-w-3xl p-6">
      <WorkspaceNav id={id} name={workspace?.name} />

      {counts && (
        <dl className="mb-6 grid grid-cols-3 gap-3 text-sm">
          {(['campaigns', 'ads', 'creatives'] as const).map((k) => (
            <div key={k} className="rounded border border-neutral-200 p-3">
              <dt className="text-neutral-500">{k}</dt>
              <dd className="text-lg font-medium">{counts[k]}</dd>
            </div>
          ))}
        </dl>
      )}

      <section className="mb-6">
        <h2 className="mb-2 font-medium">Data sources</h2>
        {sources.length === 0 ? (
          <p className="text-sm text-neutral-600">No data source yet. Connect a Meta ad account to start syncing.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 text-sm">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-2">
                <span>
                  {s.kind} {s.meta_ad_account_id ? `· ${s.meta_ad_account_id}` : ''}
                </span>
                <span className="text-neutral-500">
                  {s.last_synced_at ? `synced ${new Date(s.last_synced_at).toLocaleString()}` : 'never synced'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy !== null || sources.length === 0}
            className="rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy === 'refresh' ? 'Refreshing…' : 'Refresh now'}
          </button>
          <button
            type="button"
            onClick={() => void startConnect()}
            disabled={busy !== null}
            className="rounded border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50"
          >
            {busy === 'connect' ? 'Connecting…' : 'Connect Meta ad account'}
          </button>
        </div>
        )}
        {adAccounts.length > 0 && (
          <ul className="mt-3 divide-y divide-neutral-200 rounded border border-neutral-200 text-sm">
            {adAccounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-2">
                <span>
                  {a.name} <span className="text-neutral-500">({a.id}, {a.currency ?? '—'})</span>
                </span>
                <button
                  type="button"
                  onClick={() => void finishConnect(a.id)}
                  className="rounded bg-neutral-900 px-2 py-1 text-xs text-white"
                >
                  Use this account
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-medium">Recent sync runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-neutral-600">No runs yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-1">Job</th>
                <th>Status</th>
                <th>Started</th>
                <th>Stats</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-neutral-200">
                  <td className="py-1">{r.job}</td>
                  <td className={r.status === 'failed' ? 'text-red-700' : ''}>{r.status}</td>
                  <td>{new Date(r.started_at).toLocaleString()}</td>
                  <td className="font-mono text-xs text-neutral-600">
                    {r.stats ? JSON.stringify(r.stats) : r.error?.slice(0, 80) ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {(error ?? overview.error) && <p className="mt-4 text-sm text-red-700">{error ?? overview.error}</p>}
    </main>
  )
}
