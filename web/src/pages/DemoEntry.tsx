import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

/** /demo → the public demo workspace's library. */
export function DemoEntry() {
  const demo = useAsync(async () => {
    const { data, error } = await supabase.from('workspaces').select('id').eq('is_demo', true).limit(1).maybeSingle()
    if (error) throw new Error(error.message)
    return data?.id ?? null
  }, [])
  if (demo.data) return <Navigate to={`/demo/w/${demo.data}/library`} replace />
  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-sm text-neutral-500">
      {demo.error ?? (demo.loading ? 'Loading the demo…' : 'The demo is not available right now.')}
    </main>
  )
}
