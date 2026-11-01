import { ArrowRight, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { WorkspaceAvatar } from '../components/AppShell'
import { Badge, Button, Card, ErrorText, Loading, PageHeader } from '../components/ui'
import { useAuth } from '../lib/useAuth'
import type { Workspace } from '../lib/types'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

export function Workspaces() {
  const { session } = useAuth()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const list = useAsync(async () => {
    const { data, error: err } = await supabase.from('workspaces').select('*').order('created_at', { ascending: true })
    if (err) throw new Error(err.message)
    return data as Workspace[]
  }, [])
  const workspaces = list.data ?? []

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!session) return
    const { error: err } = await supabase.from('workspaces').insert({ owner_id: session.user.id, name: name.trim() })
    if (err) {
      setError(err.message)
      return
    }
    setName('')
    list.reload()
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Workspaces" description="One workspace per brand, each connected to one Meta ad account." />

      {list.loading && !list.data && <Loading />}
      {list.data && workspaces.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link to={`/app/w/${w.id}`}
                className="group flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 transition hover:border-[var(--line-strong)] hover:bg-[var(--panel-2)]">
                <WorkspaceAvatar name={w.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{w.name}</span>
                  <span className="block text-xs text-[var(--faint)]">Created {new Date(w.created_at).toLocaleDateString()}</span>
                </span>
                {w.is_demo && <Badge tone="accent">Demo</Badge>}
                <ArrowRight size={15} className="text-[var(--faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--text)]" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Card className="mt-6">
        <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--muted)]">{workspaces.length ? 'New workspace' : 'Create your first workspace'}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Brand name" required className="h-9 px-3 text-sm" />
          </label>
          <Button type="submit" variant="primary"><Plus size={15} /> Create</Button>
        </form>
      </Card>

      <div className="mt-4"><ErrorText>{error ?? list.error}</ErrorText></div>
    </div>
  )
}
