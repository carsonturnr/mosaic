const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

const DASH = '—'

export const fmt = {
  money: (v: number | null | undefined) => (v == null ? DASH : v >= 1000 ? usd0.format(v) : usd2.format(v)),
  int: (v: number | null | undefined) => (v == null ? DASH : int.format(v)),
  compact: (v: number | null | undefined) => (v == null ? DASH : compact.format(v)),
  pct: (v: number | null | undefined, digits = 2) => (v == null ? DASH : `${(v * 100).toFixed(digits)}%`),
  ratio: (v: number | null | undefined) => (v == null ? DASH : `${v.toFixed(2)}×`),
  seconds: (v: number | null | undefined) => (v == null ? DASH : `${Math.round(v)}s`),
}
