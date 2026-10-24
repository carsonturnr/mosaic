import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { LogoMark } from './Logo'

export const REPO = 'https://github.com/carsonturnr/mosaic'

export function SiteHeader() {
  const { session } = useAuth()
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--site-line)] bg-[color-mix(in_srgb,var(--site-bg)_75%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <Link to="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <LogoMark className="h-5 w-5" />
          Mosaic
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-[var(--site-muted)] md:flex">
          <a href="/#product" className="transition hover:text-[var(--site-text)]">Product</a>
          <a href="/#how" className="transition hover:text-[var(--site-text)]">How it works</a>
          <a href="/#grounded" className="transition hover:text-[var(--site-text)]">Grounding</a>
          <a href="/demo" className="transition hover:text-[var(--site-text)]">Live demo</a>
          <a href={REPO} className="transition hover:text-[var(--site-text)]">GitHub</a>
        </nav>
        <div className="flex items-center gap-2 text-sm">
          <Link to={session ? '/app' : '/sign-in'} className="rounded-md px-3 py-1.5 text-[var(--site-muted)] transition hover:text-[var(--site-text)]">
            {session ? 'Open app' : 'Sign in'}
          </Link>
          <a href="/#waitlist" className="rounded-md bg-[var(--site-text)] px-3 py-1.5 font-medium text-[var(--site-bg)] transition hover:bg-white">
            Get early access
          </a>
        </div>
      </div>
    </header>
  )
}

const YEAR = new Date().getFullYear()

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--site-line)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 text-sm text-[var(--site-muted)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <LogoMark className="h-4 w-4" />
          <span>© {YEAR} Mosaic · Open source under the MIT license</span>
        </div>
        <nav className="flex gap-5">
          <Link to="/privacy" className="hover:text-[var(--site-text)]">Privacy</Link>
          <Link to="/terms" className="hover:text-[var(--site-text)]">Terms</Link>
          <a href={REPO} className="hover:text-[var(--site-text)]">GitHub</a>
        </nav>
      </div>
    </footer>
  )
}

export function SitePage({ children }: { children: ReactNode }) {
  return (
    <div className="site min-h-screen font-sans antialiased">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  )
}

export function Prose({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-[var(--site-muted)]">Last updated {updated}</p>
      <div className="mt-10 space-y-4 text-[15px] leading-relaxed text-[#c9ccd1] [&_a]:text-[var(--site-text)] [&_code]:rounded [&_code]:bg-white/5 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px] [&_h2]:text-[var(--site-text)] [&_strong]:text-[var(--site-text)]">
        {children}
      </div>
    </main>
  )
}
