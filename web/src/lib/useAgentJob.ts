import { useCallback, useEffect, useRef, useState } from 'react'
import { workerApi } from './api'
import { supabase } from './supabase'

export type JobKind = 'strategist' | 'brief'
type Status = 'idle' | 'queued' | 'running' | 'done' | 'failed'

/**
 * Agent runs take a minute or more, so the worker runs them as background jobs.
 * Start one, poll its row until it finishes, then call onDone. Picks up a job that
 * is already running when the page opens.
 */
export function useAgentJob(workspaceId: string, kind: JobKind, onDone: () => void) {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  }, [onDone])

  // resume an in-flight job on mount
  useEffect(() => {
    let cancelled = false
    void supabase
      .from('agent_jobs')
      .select('id, status')
      .eq('workspace_id', workspaceId)
      .eq('kind', kind)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const job = data?.[0]
        if (!cancelled && job) {
          setJobId(job.id)
          setStatus(job.status as Status)
        }
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, kind])

  // poll while queued or running
  useEffect(() => {
    if (!jobId || (status !== 'queued' && status !== 'running')) return
    const timer = setInterval(() => {
      void supabase
        .from('agent_jobs')
        .select('status, error')
        .eq('id', jobId)
        .single()
        .then(({ data }) => {
          if (!data) return
          setStatus(data.status as Status)
          if (data.status === 'failed') setError(data.error ?? 'The run failed.')
          if (data.status === 'done') done.current()
        })
    }, 3000)
    return () => clearInterval(timer)
  }, [jobId, status])

  const start = useCallback(
    async (request?: string) => {
      setError(null)
      setStatus('queued')
      try {
        const res =
          kind === 'strategist'
            ? await workerApi.strategistReport(workspaceId)
            : await workerApi.briefs(workspaceId, request)
        setJobId(res.job_id)
      } catch (e) {
        setStatus('failed')
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [workspaceId, kind],
  )

  return { start, error, busy: status === 'queued' || status === 'running', status }
}
