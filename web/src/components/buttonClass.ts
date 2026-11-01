// Shared with links styled as buttons, so it lives outside the component file.

export type Variant = 'primary' | 'secondary' | 'ghost' | 'accent'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-[var(--text)] text-[var(--bg)] hover:bg-white',
  accent: 'bg-[var(--accent)] text-white hover:bg-[var(--accent-2)] hover:text-[var(--bg)]',
  secondary: 'border border-[var(--line-strong)] bg-[var(--panel-2)] text-[var(--text)] hover:border-white/25',
  ghost: 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]',
}
const SIZE = { sm: 'h-7 px-2.5 text-xs gap-1.5', md: 'h-9 px-3.5 text-sm gap-2' }

export type ButtonSize = keyof typeof SIZE

export function buttonClass(variant: Variant = 'secondary', size: ButtonSize = 'md') {
  return `inline-flex items-center justify-center rounded-lg font-medium transition disabled:pointer-events-none disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]}`
}
