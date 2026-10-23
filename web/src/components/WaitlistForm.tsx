import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Status = 'idle' | 'sending' | 'done' | 'exists' | 'error'

export function WaitlistForm({ product, source, align = 'left' }: {
  product: 'mosaic' | 'stride_lab'
  source: string
  align?: 'left' | 'center'
}) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setStatus('sending')
    const { error } = await supabase.from('waitlist').insert({ product, email: email.trim(), source })
    if (!error) setStatus('done')
    else if (error.code === '23505') setStatus('exists')
    else setStatus('error')
  }

  if (status === 'done' || status === 'exists') {
    return (
      <p className={`flex items-center gap-2 text-sm text-[var(--site-text)] ${align === 'center' ? 'justify-center' : ''}`} role="status">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400" aria-hidden>✓</span>
        {status === 'done' ? "You're on the list. We'll email you when it's ready." : "You're already on the list."}
      </p>
    )
  }

  return (
    <form onSubmit={submit} className={`flex w-full max-w-md flex-col gap-2 sm:flex-row ${align === 'center' ? 'mx-auto' : ''}`}>
      <label className="sr-only" htmlFor={`waitlist-${source}`}>Email</label>
      <input
        id={`waitlist-${source}`}
        type="email"
        required
        placeholder="you@brand.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="h-11 w-full shrink-0 rounded-lg border sm:w-auto sm:flex-1 border-[var(--site-line)] bg-white/[0.04] px-3.5 text-sm text-[var(--site-text)] outline-none transition placeholder:text-[var(--site-muted)] focus:border-white/25 focus:bg-white/[0.06]"
      />
      <button
        type="submit"
        disabled={status === 'sending'}
        className="h-11 rounded-lg bg-[var(--site-text)] px-5 text-sm font-medium text-[var(--site-bg)] transition hover:bg-white disabled:opacity-50"
      >
        {status === 'sending' ? 'Joining…' : 'Get early access'}
      </button>
      {status === 'error' && <p className="text-sm text-red-400 sm:basis-full">Something went wrong. Try again.</p>}
    </form>
  )
}
