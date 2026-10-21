import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import type { Workspace } from '../lib/types'
import { supabase } from '../lib/supabase'

export function Workspaces() {
  const { session, signOut } = useAuth()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    const { data, error: err } = await supabase
      .from('workspaces')
      .select('*')
      .order('created_at', { ascending: true })
    if (err) setError(err.message)
    else setWorkspaces(data)
  }

  useEffect(() => {
    void load()
  }, [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!session) return
    const { error: err } = await supabase
      .from('workspaces')
      .insert({ owner_id: session.user.id, name: name.trim() })
    if (err) {
      setError(err.message)
      return
    }
    setName('')
    await load()
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Workspaces</h1>
        <button type="button" onClick={() => void signOut()} className="text-sm text-neutral-600 underline">
          Sign out
        </button>
      </header>

      {workspaces.length === 0 ? (
        <p className="mb-6 text-sm text-neutral-600">
          No workspaces yet. Create one, then connect a Meta ad account.
        </p>
      ) : (
        <ul className="mb-6 divide-y divide-neutral-200 rounded border border-neutral-200">
          {workspaces.map((w) => (
            <li key={w.id} className="flex items-center justify-between px-4 py-3">
              <Link to={`/app/w/${w.id}`} className="underline">
                {w.name}
              </Link>
              {w.is_demo && <span className="text-xs text-neutral-500">demo</span>}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Workspace name"
          required
          className="flex-1 rounded border border-neutral-300 px-3 py-2"
        />
        <button type="submit" className="rounded bg-neutral-900 px-3 py-2 text-white">
          Create
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
    </main>
  )
}
