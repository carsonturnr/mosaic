import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { LogoMark } from '../components/Logo'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'

export function SignIn() {
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  if (session) return <Navigate to="/app" replace />

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
    <div className="site relative flex min-h-screen items-center justify-center overflow-hidden px-5 font-sans antialiased">
      <div className="site-grid-bg pointer-events-none absolute inset-0" aria-hidden />
      <div className="pointer-events-none absolute left-1/2 top-[-240px] h-[480px] w-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(144_133_233/0.18),transparent)]" aria-hidden />
      <main className="relative w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2 text-[15px] font-semibold tracking-tight">
          <LogoMark className="h-6 w-6" /> Mosaic
        </Link>
        <div className="rounded-2xl border border-[var(--site-line)] bg-[var(--site-card)] p-6 shadow-[0_40px_120px_-20px_rgb(0_0_0/0.8)]">
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-[var(--site-muted)]">Your in-house creative strategist for Meta ads.</p>

          <button type="button" onClick={() => void signInWithGoogle()}
            className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] text-sm font-medium transition hover:border-white/20 hover:bg-white/[0.07]">
            <GoogleMark /> Continue with Google
          </button>

          <div className="my-5 flex items-center gap-3 text-xs text-[var(--site-muted)]">
            <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
          </div>

          {status === 'sent' ? (
            <p className="rounded-lg border border-[#5fd4a0]/25 bg-[#5fd4a0]/10 px-3 py-2.5 text-sm text-[#5fd4a0]">Check your inbox for a sign-in link.</p>
          ) : (
            <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--site-muted)]">
                Email
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brand.com"
                  className="h-10 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-[var(--site-text)] outline-none transition placeholder:text-white/25 focus:border-[var(--v4)] focus:ring-4 focus:ring-[var(--v4)]/15" />
              </label>
              <button type="submit" disabled={status === 'sending'}
                className="h-10 rounded-lg bg-[var(--site-text)] text-sm font-medium text-[var(--site-bg)] transition hover:bg-white disabled:opacity-50">
                {status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </form>
          )}
          {error && <p className="mt-3 text-sm text-[#f2827f]">{error}</p>}
        </div>
      </main>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  )
}
