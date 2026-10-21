import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/useAuth'

export function SiteHeader() {
  const { session } = useAuth()
  return (
    <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
      <Link to="/" className="text-base font-semibold tracking-tight">
        Mosaic
      </Link>
      <nav className="flex items-center gap-5 text-sm text-neutral-600">
        <a href="/#how" className="hover:text-neutral-900">
          How it works
        </a>
        <a href="https://github.com/carsonturnr/mosaic" className="hover:text-neutral-900">
          GitHub
        </a>
        <Link
          to={session ? '/app' : '/sign-in'}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-900 hover:bg-neutral-50"
        >
          {session ? 'Open app' : 'Sign in'}
        </Link>
      </nav>
    </header>
  )
}

const YEAR = new Date().getFullYear()

export function SiteFooter() {
  return (
    <footer className="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-10 text-sm text-neutral-500 sm:flex-row sm:justify-between">
      <span>© {YEAR} Mosaic. Open source under the MIT license.</span>
      <nav className="flex gap-4">
        <Link to="/privacy" className="hover:text-neutral-900">
          Privacy
        </Link>
        <Link to="/terms" className="hover:text-neutral-900">
          Terms
        </Link>
        <a href="https://github.com/carsonturnr/mosaic" className="hover:text-neutral-900">
          GitHub
        </a>
      </nav>
    </footer>
  )
}

export function SitePage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  )
}

export function Prose({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-neutral-500">Last updated {updated}</p>
      <div className="prose-mosaic mt-8 space-y-4 text-[15px] leading-relaxed text-neutral-800">{children}</div>
    </main>
  )
}
