import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'

export function SignIn() {
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  if (session) return <Navigate to="/" replace />

  const sendMagicLink = async (e: FormEvent) => {
    e.preventDefault()
    setStatus('sending')
    setError(null)
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (err) {
      setError(err.message)
      setStatus('error')
    } else {
      setStatus('sent')
    }
  }

  const signInWithGoogle = async () => {
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (err) setError(err.message)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Mosaic</h1>
        <p className="text-sm text-neutral-600">Your in-house creative strategist for Meta ads.</p>
      </div>

      <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={status === 'sending'}
          className="rounded bg-neutral-900 px-3 py-2 text-white disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending…' : 'Send magic link'}
        </button>
        {status === 'sent' && <p className="text-sm text-green-700">Check your inbox for a sign-in link.</p>}
      </form>

      <button
        type="button"
        onClick={() => void signInWithGoogle()}
        className="rounded border border-neutral-300 px-3 py-2"
      >
        Continue with Google
      </button>

      {error && <p className="text-sm text-red-700">{error}</p>}
    </main>
  )
}
