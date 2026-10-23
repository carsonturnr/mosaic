// A static, styled preview of the app: the creative library on the left and a
// strategist report on the right. Sample data only; labeled as such under the frame.

const ADS = [
  { id: '012', hook: 'problem/pain', format: 'UGC', roas: 2.24, spend: '$1.7K', tone: ['#2c2552', '#6f62d6'], tag: 'winner' },
  { id: '006', hook: 'problem/pain', format: 'UGC', roas: 2.57, spend: '$1.4K', tone: ['#241e45', '#4a3fa0'], tag: 'low data' },
  { id: '007', hook: 'bold claim', format: 'demo', roas: 1.41, spend: '$35.6K', tone: ['#3a3266', '#9085e9'], tag: null },
  { id: '003', hook: 'us-vs-them', format: 'demo', roas: 1.65, spend: '$4.7K', tone: ['#1d1838', '#5b4fc4'], tag: null },
  { id: '000', hook: 'offer-first', format: 'UGC', roas: 0.65, spend: '$4.7K', tone: ['#2a2a30', '#5b5b66'], tag: 'cut' },
  { id: '019', hook: 'static', format: 'static', roas: 1.3, spend: '$2.7K', tone: ['#2c2552', '#b3a8ff'], tag: null },
] as const

function AdTile({ ad }: { ad: (typeof ADS)[number] }) {
  const badge =
    ad.tag === 'winner'
      ? 'bg-[var(--v5)] text-[var(--v1)]'
      : 'bg-black/40 text-[var(--site-muted)]'
  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.02]">
      <div className="relative aspect-[4/5]" style={{ background: `linear-gradient(150deg, ${ad.tone[0]}, ${ad.tone[1]})` }}>
        <div className="absolute inset-x-3 bottom-3 space-y-1.5" aria-hidden>
          <div className="h-1.5 w-3/4 rounded-full bg-white/50" />
          <div className="h-1.5 w-1/2 rounded-full bg-white/30" />
        </div>
        {ad.format !== 'static' && (
          <div className="absolute left-1/2 top-[40%] flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 backdrop-blur" aria-hidden>
            <span className="ml-0.5 text-[9px] text-white">▶</span>
          </div>
        )}
        {ad.tag && <span className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-[9px] font-medium ${badge}`}>{ad.tag}</span>}
      </div>
      <div className="p-2">
        <p className="truncate text-[10px] text-[var(--site-text)]">Ad {ad.id} · {ad.format}</p>
        <p className="mt-0.5 truncate text-[9px] text-[var(--site-muted)]">{ad.hook}</p>
        <div className="mt-1.5 flex justify-between font-mono text-[9px]">
          <span className="text-[var(--site-muted)]">{ad.spend}</span>
          <span className="text-[var(--site-text)]">{ad.roas.toFixed(2)}×</span>
        </div>
      </div>
    </div>
  )
}

function Cite({ id }: { id: string }) {
  return (
    <span className="ml-1 inline-flex items-center rounded border border-white/10 bg-white/[0.04] px-1 font-mono text-[9px] text-[var(--v5)]">
      ad {id}
    </span>
  )
}

export function ProductPreview() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-x-10 -top-10 bottom-0 rounded-[40px] bg-[radial-gradient(ellipse_at_top,rgb(144_133_233/0.22),transparent_65%)] blur-2xl" aria-hidden />
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0c0c0f] shadow-[0_40px_120px_-20px_rgb(0_0_0/0.8)] ring-1 ring-white/[0.03]">
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="ml-3 font-mono text-[10px] text-[var(--site-muted)]">mosaic / library</span>
        </div>

        <div className="grid md:grid-cols-[1.45fr_1fr]">
          <div className="border-white/[0.07] p-4 md:border-r">
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[10px]">
              {['Last 30 days', 'Video', 'Hook: any', 'Sort: ROAS'].map((f) => (
                <span key={f} className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[var(--site-muted)]">{f}</span>
              ))}
            </div>
            <div className="mb-3 grid grid-cols-4 gap-2">
              {[['Spend', '$83.6K'], ['ROAS', '1.46×'], ['CPA', '$38.99'], ['Hook rate', '27.4%']].map(([k, v]) => (
                <div key={k} className="rounded-md border border-white/[0.07] bg-white/[0.02] px-2 py-1.5">
                  <p className="text-[9px] text-[var(--site-muted)]">{k}</p>
                  <p className="font-mono text-[12px] text-[var(--site-text)]">{v}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
              {ADS.map((ad) => <AdTile key={ad.id} ad={ad} />)}
            </div>
          </div>

          <div className="border-t border-white/[0.07] p-4 md:border-t-0">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-[var(--site-text)]">Strategist report</p>
              <span className="flex items-center gap-1 rounded-full bg-[var(--v4)]/15 px-2 py-0.5 text-[9px] text-[var(--v5)]">
                <span aria-hidden>✓</span> 9 numbers verified
              </span>
            </div>
            <div className="mt-3 space-y-3 text-[11px] leading-relaxed text-[#c9ccd1]">
              <Section title="What's working" dot="bg-[var(--v5)]">
                Problem/pain hooks lead at <b className="font-mono font-medium text-[var(--site-text)]">2.4×</b> ROAS vs. <b className="font-mono font-medium text-[var(--site-text)]">1.46×</b> average.
                <Cite id="012" /><Cite id="006" />
              </Section>
              <Section title="Double down" dot="bg-[var(--v4)]">
                Ad 012: <b className="font-mono font-medium text-[var(--site-text)]">1.8%</b> CTR on just <b className="font-mono font-medium text-[var(--site-text)]">$1.7K</b>. Scale it.
                <Cite id="012" />
              </Section>
              <Section title="Cut" dot="bg-[var(--v2)]">
                Offer-first UGC returned <b className="font-mono font-medium text-[var(--site-text)]">0.65×</b> on <b className="font-mono font-medium text-[var(--site-text)]">$4.7K</b>.
                <Cite id="000" />
              </Section>
              <Section title="Missing concepts" dot="bg-white/30">
                No testimonial hooks in 30 days.
              </Section>
            </div>
            <button type="button" tabIndex={-1} className="mt-4 w-full rounded-md border border-white/10 bg-white/[0.04] py-1.5 text-[10px] text-[var(--site-text)]">
              Write 3 briefs from problem/pain →
            </button>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-[var(--site-muted)]">Sample data.</p>
    </div>
  )
}

function Section({ title, dot, children }: { title: string; dot: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--site-muted)]">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
        {title}
      </p>
      <p>{children}</p>
    </div>
  )
}
