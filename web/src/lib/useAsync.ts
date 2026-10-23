import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  reload: () => void
}

/**
 * Run an async loader whenever its dependencies change. State is only set from
 * the promise callback, and a stale response never overwrites a newer one.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const seq = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loader = useCallback(load, deps)

  useEffect(() => {
    const mine = ++seq.current
    loader().then(
      (value) => {
        if (mine !== seq.current) return
        setData(value)
        setError(null)
        setLoading(false)
      },
      (err: unknown) => {
        if (mine !== seq.current) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      },
    )
  }, [loader, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}
