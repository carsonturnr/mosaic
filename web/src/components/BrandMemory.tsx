import { Globe, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { workerApi } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import { Button } from './ui'

export function BrandMemory({ workspaceId }: { workspaceId: string }) {
  const mem = useAsync(async () => {
    const { data, error } = await supabase.from('brand_memory').select('guidelines, learnings').eq('workspace_id', workspaceId).maybeSingle()
    if (error) throw new Error(error.message)
    return data ?? { guidelines: '', learnings: '' }
  }, [workspaceId])
  const [draft, setDraft] = useState<{ guidelines: string; learnings: string } | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [url, setUrl] = useState('')
  const [pasted, setPasted] = useState('')
  const [mode, setMode] = useState<'url' | 'text'>('url')
  const [learning, setLearning] = useState<'idle' | 'busy' | 'drafted'>('idle')
  const [learnError, setLearnError] = useState<string | null>(null)
  const value = draft ?? mem.data ?? { guidelines: '', learnings: '' }

  const save = async () => {
    setStatus('saving')
    const { error } = await supabase.from('brand_memory').upsert({ workspace_id: workspaceId, ...value, updated_at: new Date().toISOString() })
    setStatus(error ? 'error' : 'saved')
    if (!error) { setDraft(null); setLearning('idle'); mem.reload() }
  }

  const learn = async (e: FormEvent) => {
    e.preventDefault()
    setLearning('busy')
    setLearnError(null)
    try {
      const { guidelines } = await workerApi.learnBrand(workspaceId, mode === 'url' ? { url: url.trim() } : { text: pasted })
      setDraft({ ...value, guidelines })
      setStatus('idle')
      setLearning('drafted')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const clean = msg.replace(/^\d+: /, '').replace(/^\{"detail":"(.*)"\}$/, '$1')
      setLearnError(clean)
      setLearning('idle')
      if (clean.includes('paste')) setMode('text') // the site blocks automated reading
    }
  }

  return (
    <section className="mt-12">
      <h2 className="text-base font-semibold">Brand memory</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">Briefs follow these. The latest report summary is added to learnings automatically.</p>

      <form onSubmit={learn} className="mt-4 rounded-xl border border-[var(--accent)]/25 bg-[linear-gradient(135deg,var(--accent-soft),transparent_65%)] p-4">
        <p className="flex items-center gap-2 text-sm font-medium"><Sparkles size={14} className="text-[var(--accent-2)]" /> Learn your brand from your website</p>
        <p className="mt-1 text-xs text-[var(--muted)]">Mosaic reads the page and drafts your product, audience, voice and claims to avoid. Review it below, then save.</p>
        {mode === 'url' ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Website</span>
              <Globe size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourbrand.com" required className="h-9 w-full pl-8 pr-3 text-sm" />
            </label>
            <Button type="submit" variant="accent" disabled={learning === 'busy' || !url.trim()}>
              {learning === 'busy' ? 'Reading the site…' : 'Draft guidelines'}
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <label className="block">
              <span className="sr-only">Brand copy</span>
              <textarea rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} required
                placeholder="Paste your homepage or About page copy: what you sell, who it's for, why people buy."
                className="w-full px-3 py-2 text-sm" />
            </label>
            <Button type="submit" variant="accent" disabled={learning === 'busy' || pasted.trim().length < 40}>
              {learning === 'busy' ? 'Reading…' : 'Draft guidelines'}
            </Button>
          </div>
        )}
        <button type="button" onClick={() => { setMode(mode === 'url' ? 'text' : 'url'); setLearnError(null) }}
          className="mt-2 text-xs text-[var(--accent-2)] hover:text-[var(--text)]">
          {mode === 'url' ? 'Or paste text instead' : 'Use a website link instead'}
        </button>
        {learnError && <p className="mt-2 text-xs text-[var(--bad)]">{learnError}</p>}
        {learning === 'drafted' && <p className="mt-2 text-xs text-[var(--good)]">Drafted below. Edit anything that's off, then save.</p>}
      </form>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {(['guidelines', 'learnings'] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-[var(--muted)]">{k === 'guidelines' ? 'Guidelines (voice, claims to avoid, must-haves)' : 'Learnings (what you already know works or fails)'}</span>
            <textarea rows={9} value={value[k]} onChange={(e) => { setDraft({ ...value, [k]: e.target.value }); setStatus('idle') }}
              className={`px-3 py-2 ${k === 'guidelines' && learning === 'drafted' ? 'ring-1 ring-[var(--accent)]/50' : ''}`} />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={status === 'saving' || !draft}>{status === 'saving' ? 'Saving…' : 'Save'}</Button>
        {status === 'saved' && <span className="text-[var(--good)]">Saved</span>}
        {status === 'error' && <span className="text-[var(--bad)]">Could not save</span>}
      </div>
    </section>
  )
}
