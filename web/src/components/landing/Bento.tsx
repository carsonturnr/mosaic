import type { ReactNode } from 'react'

function Card({ className = '', eyebrow, title, body, children }: {
  className?: string
  eyebrow: string
  title: string
  body: string
  children: ReactNode
}) {
  return (
    <div className={`group relative flex flex-col overflow-hidden rounded-2xl border border-[var(--site-line)] bg-[var(--site-card)] p-6 transition hover:border-white/15 ${className}`}>
      <div className="relative min-h-0 flex-1">{children}</div>
      <div className="relative mt-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--site-muted)]">{eyebrow}</p>
        <h3 className="mt-2 text-lg font-medium tracking-tight">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--site-muted)]">{body}</p>
      </div>
    </div>
  )
}

// ---- visuals -------------------------------------------------------------------

const SCENES = [
  { w: 3, hook: true, line: '“Still waking up exhausted?”' },
  { w: 4, line: 'Close-up, product pour' },
  { w: 5, line: '“I swapped my morning coffee…”' },
  { w: 3, line: 'Before / after, split screen' },
  { w: 4, line: 'Offer card: 20% off' },
]

function SceneTimeline() {
  const total = SCENES.reduce((t, s) => t + s.w, 0)
  return (
    <div className="flex h-full flex-col justify-center gap-4">
      <div className="flex gap-1" aria-hidden>
        {SCENES.map((s, i) => (
          <div key={i} style={{ flexGrow: s.w }} className="min-w-0 basis-0">
            <div
              className={`h-24 rounded-md border sm:h-32 ${s.hook ? 'border-[#9085e9]/60' : 'border-white/[0.06]'}`}
              style={{ background: `linear-gradient(160deg, hsl(${250 - i * 28} 40% 22%), hsl(${250 - i * 28} 55% 38%))` }}
            />
          </div>
        ))}
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full" aria-hidden>
        {SCENES.map((s, i) => (
          <div key={i} style={{ width: `${(s.w / total) * 100}%` }} className={`${s.hook ? 'bg-[#9085e9]' : 'bg-white/15'} ${i ? 'ml-0.5' : ''}`} />
        ))}
      </div>
      <ul className="space-y-1.5 font-mono text-[11px]">
        {SCENES.slice(0, 3).map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className={s.hook ? 'text-[#b3a8ff]' : 'text-[var(--site-muted)]'}>{s.hook ? 'HOOK 0–3s' : `SCENE ${i + 1}`}</span>
            <span className="truncate text-[#c9ccd1]">{s.line}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const RANKS = [
  { name: 'Problem/pain', est: 2.4, lo: 2.0, hi: 2.8, n: 6 },
  { name: 'Curiosity', est: 1.9, lo: 1.5, hi: 2.3, n: 5 },
  { name: 'Bold claim', est: 1.45, lo: 1.3, hi: 1.6, n: 4 },
  { name: 'Testimonial', est: 1.5, lo: 0.6, hi: 2.9, n: 1, low: true },
]

function Rankings() {
  const max = 3.2
  const pct = (v: number) => `${(v / max) * 100}%`
  return (
    <div className="space-y-3.5 pt-1" role="img" aria-label="ROAS by hook type with confidence intervals. Testimonial has too little data to rank.">
      {RANKS.map((r) => (
        <div key={r.name} className={r.low ? 'opacity-45' : ''}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-[#c9ccd1]">{r.name} <span className="text-[var(--site-muted)]">· {r.n} ads</span></span>
            <span className="font-mono text-[var(--site-text)]">{r.low ? 'low data' : `${r.est.toFixed(1)}×`}</span>
          </div>
          <div className="relative h-4">
            <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.08]" />
            <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#3987e5]/35" style={{ left: pct(r.lo), width: `calc(${pct(r.hi)} - ${pct(r.lo)})` }} />
            <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--site-card)] bg-[#3987e5]" style={{ left: pct(r.est) }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// 22 ads, 4 concepts
const CLUSTERS = [9, 6, 4, 3]
const CLUSTER_VARS = ['var(--cluster-1)', 'var(--cluster-2)', 'var(--cluster-3)', 'var(--cluster-4)']

function Diversity() {
  return (
    <div>
      <p className="text-4xl font-semibold tracking-tight">
        4 <span className="text-[var(--site-muted)]">concepts,</span>
      </p>
      <p className="text-4xl font-semibold tracking-tight text-[var(--site-muted)]">not 22.</p>
      <div className="mt-5 flex flex-wrap gap-3" aria-hidden>
        {CLUSTERS.map((n, c) => (
          <div key={c} className="flex flex-wrap gap-1 rounded-lg border border-white/[0.06] p-1.5" style={{ maxWidth: 96 }}>
            {Array.from({ length: n }, (_, i) => (
              <span key={i} className="h-3.5 w-3.5 rounded-[3px]" style={{ background: CLUSTER_VARS[c], opacity: 1 - i * 0.06 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function Citations() {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4 text-sm leading-relaxed text-[#c9ccd1]">
      Cut <span className="text-[var(--site-text)]">Ad 000</span>: offer-first UGC returned{' '}
      <span className="rounded bg-white/[0.06] px-1 font-mono text-[var(--site-text)]">0.65×</span> ROAS on{' '}
      <span className="rounded bg-white/[0.06] px-1 font-mono text-[var(--site-text)]">$4,729</span> spend.
      <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[10px]">
        <span className="rounded border border-white/10 px-1.5 py-0.5 text-[#b3a8ff]">ad 000</span>
        <span className="rounded border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-0.5 text-emerald-300">✓ roas 0.65 matches</span>
        <span className="rounded border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-0.5 text-emerald-300">✓ spend 4729 matches</span>
      </div>
    </div>
  )
}

const TAXONOMY = [
  ['hook_type', ['problem/pain', 'curiosity', 'bold claim', 'testimonial']],
  ['angle', ['social proof', 'price/value', 'comparison']],
  ['format', ['UGC', 'founder story', 'demo']],
] as const

function Taxonomy() {
  return (
    <div className="space-y-3">
      {TAXONOMY.map(([k, vals]) => (
        <div key={k}>
          <p className="mb-1.5 font-mono text-[10px] text-[var(--site-muted)]">{k}</p>
          <div className="flex flex-wrap gap-1.5">
            {vals.map((v) => (
              <span key={v} className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-xs text-[#c9ccd1]">{v}</span>
            ))}
            <span className="rounded-md border border-dashed border-white/15 px-2 py-0.5 text-xs text-[var(--site-muted)]">+ add</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function Brief() {
  return (
    <pre className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/30 p-4 font-mono text-[11px] leading-relaxed text-[#c9ccd1]">
      <span className="text-[var(--site-muted)]">BRIEF 01 · from ad 012</span>
      {'\n'}<span className="text-[#b3a8ff]">HOOK</span>   "3 p.m. crash again?"
      {'\n'}<span className="text-[#b3a8ff]">ANGLE</span>  problem/pain → solution
      {'\n'}<span className="text-[#b3a8ff]">FORMAT</span> UGC, 20–25 s, selfie
      {'\n'}<span className="text-[#b3a8ff]">TEST</span>   vs. curiosity hook, $50/day
    </pre>
  )
}

export function Bento() {
  return (
    <div className="grid gap-4 md:grid-cols-6">
      <Card className="md:col-span-4" eyebrow="Perceive" title="Every ad, broken down scene by scene"
        body="Vision models split each video into scenes with transcript, on-screen text and B-roll type. The first three seconds are tagged as the hook.">
        <SceneTimeline />
      </Card>
      <Card className="md:col-span-2" eyebrow="Analyze" title="Rankings you can trust"
        body="Empirical-Bayes shrinkage pulls low-spend ads toward the account average, so a $40 ad never gets crowned the winner.">
        <Rankings />
      </Card>
      <Card className="md:col-span-2" eyebrow="Cluster" title="Real concept diversity"
        body="Near-duplicates are grouped into true concepts and weighted by spend.">
        <Diversity />
      </Card>
      <Card className="md:col-span-2" eyebrow="Explain" title="Claims with receipts"
        body="Every recommendation cites the ads and numbers behind it, checked against your data before you see it.">
        <Citations />
      </Card>
      <Card className="md:col-span-2" eyebrow="Your framework" title="Tags in your language"
        body="Edit the taxonomy to match how you already buy media. Add custom tags and filter by anything.">
        <Taxonomy />
      </Card>
      <Card className="md:col-span-6 lg:col-span-6" eyebrow="Act" title="Briefs, not pixels"
        body="Turn a winning hook into new scripts, hook lists and a test plan your editors can shoot tomorrow.">
        <div className="grid gap-4 md:grid-cols-2">
          <Brief />
          <pre className="hidden overflow-hidden rounded-xl border border-white/[0.07] bg-black/30 p-4 font-mono text-[11px] leading-relaxed text-[#c9ccd1] md:block">
            <span className="text-[var(--site-muted)]">BRIEF 02 · new angle</span>
            {'\n'}<span className="text-[#b3a8ff]">HOOK</span>   "I tested 4 energy drinks so you don't have to"
            {'\n'}<span className="text-[#b3a8ff]">ANGLE</span>  comparison
            {'\n'}<span className="text-[#b3a8ff]">FORMAT</span> talking head, 30 s
            {'\n'}<span className="text-[#b3a8ff]">WHY</span>    no comparison ads in 30 days
          </pre>
        </div>
      </Card>
    </div>
  )
}
