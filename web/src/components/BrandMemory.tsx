import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

export function BrandMemory({ workspaceId }: { workspaceId: string }) {
  const mem = useAsync(async () => {
    const { data, error } = await supabase.from('brand_memory').select('guidelines, learnings').eq('workspace_id', workspaceId).maybeSingle()
    if (error) throw new Error(error.message)
    return data ?? { guidelines: '', learnings: '' }
  }, [workspaceId])
  const [draft, setDraft] = useState<{ guidelines: string; learnings: string } | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const value = draft ?? mem.data ?? { guidelines: '', learnings: '' }

  const save = async () => {
    setStatus('saving')
    const { error } = await supabase.from('brand_memory').upsert({ workspace_id: workspaceId, ...value, updated_at: new Date().toISOString() })
    setStatus(error ? 'error' : 'saved')
    if (!error) { setDraft(null); mem.reload() }
  }

  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold">Brand memory</h2>
      <p className="mt-1 text-sm text-neutral-600">Briefs follow these. The latest report summary is added to learnings automatically.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {(['guidelines', 'learnings'] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-neutral-600">{k === 'guidelines' ? 'Guidelines (voice, claims to avoid, must-haves)' : 'Learnings (what you already know works or fails)'}</span>
            <textarea rows={6} value={value[k]} onChange={(e) => { setDraft({ ...value, [k]: e.target.value }); setStatus('idle') }}
              className="rounded-md border border-neutral-300 px-3 py-2" />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <button type="button" onClick={() => void save()} disabled={status === 'saving' || !draft}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-40">{status === 'saving' ? 'Saving…' : 'Save'}</button>
        {status === 'saved' && <span className="text-emerald-700">Saved</span>}
        {status === 'error' && <span className="text-red-700">Could not save</span>}
      </div>
    </section>
  )
}
