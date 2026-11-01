import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { buttonClass, type ButtonSize, type Variant } from './buttonClass'

// Building blocks for the product app. Colors come from the .app tokens in index.css.

export function PageHeader({ title, description, actions, meta }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">{description}</p>}
        {meta && <div className="mt-2 text-xs text-[var(--faint)]">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Card({ children, className = '', pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <div className={`rounded-xl border border-[var(--line)] bg-[var(--panel)] ${pad ? 'p-5' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function CardTitle({ children, aside, icon }: { children: ReactNode; aside?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
        {icon && <span className="text-[var(--muted)]">{icon}</span>}
        {children}
      </h2>
      {aside && <div className="text-xs text-[var(--muted)]">{aside}</div>}
    </div>
  )
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <h2 className="text-base font-semibold tracking-[-0.01em]">{children}</h2>
      {aside}
    </div>
  )
}

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: ButtonSize
}) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...rest} />
}

export type Tone = 'neutral' | 'accent' | 'good' | 'bad' | 'warn'
const TONE: Record<Tone, string> = {
  neutral: 'bg-white/[0.06] text-[var(--text-2)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent-2)]',
  good: 'bg-[var(--good-soft)] text-[var(--good)]',
  bad: 'bg-[var(--bad-soft)] text-[var(--bad)]',
  warn: 'bg-[var(--warn-soft)] text-[var(--warn)]',
}

export function Badge({ tone = 'neutral', children, className = '', title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ${TONE[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function Stat({ label, value, hint, active, tone }: { label: string; value: ReactNode; hint?: ReactNode; active?: boolean; tone?: Tone }) {
  const color = tone === 'good' ? 'text-[var(--good)]' : tone === 'bad' ? 'text-[var(--bad)]' : 'text-[var(--text)]'
  return (
    <div className={`rounded-xl border bg-[var(--panel)] px-4 py-3.5 ${active ? 'border-[var(--accent)]/60 ring-1 ring-[var(--accent)]/30' : 'border-[var(--line)]'}`}>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className={`mt-1 font-mono text-xl font-medium tabular-nums tracking-tight ${color}`}>{value}</dd>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--faint)]">{hint}</p>}
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--line-strong)] px-6 py-14 text-center">
      {icon && <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-2)]">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="mt-1.5 max-w-md text-sm leading-relaxed text-[var(--muted)]">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Callout({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  const border: Record<Tone, string> = {
    neutral: 'border-[var(--line)]',
    accent: 'border-[var(--accent)]/30',
    good: 'border-[var(--good)]/25',
    bad: 'border-[var(--bad)]/30',
    warn: 'border-[var(--warn)]/30',
  }
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${border[tone]} ${TONE[tone]}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 text-[var(--text-2)]">{children}</div>
    </div>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <Callout tone="bad">{children}</Callout>
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-[var(--muted)]">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--line-strong)] border-t-[var(--accent)]" aria-hidden />
      {label}
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T
  onChange: (v: T) => void
  options: readonly (readonly [T, string])[]
  label: string
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${v === value ? 'bg-white/[0.09] text-[var(--text)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
          {l}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--faint)]">{hint}</span>}
    </label>
  )
}

export function SelectField({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string][]
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--faint)]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 min-w-28 px-2 text-sm">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

/** Table shell: header row on a slightly raised surface, hairline rows. */
export function Table({ children, minWidth = 560 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      <table className="w-full text-left text-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-[var(--line)] [&_thead]:text-[11px] [&_thead]:uppercase [&_thead]:tracking-wide [&_thead]:text-[var(--faint)] [&_th]:px-4 [&_th]:py-2.5 [&_th]:font-medium [&_td]:px-4 [&_td]:py-2.5" style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}

export function AdRef({ to, children, title }: { to?: string; children: ReactNode; title?: string }) {
  const cls = 'inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition'
  return to ? (
    <Link to={to} title={title} className={`${cls} border-[var(--line-strong)] bg-white/[0.03] text-[var(--accent-2)] hover:border-[var(--accent)]/60`}>{children}</Link>
  ) : (
    <span className={`${cls} border-[var(--bad)]/40 text-[var(--bad)]`}>{children}</span>
  )
}
