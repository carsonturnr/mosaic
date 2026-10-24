import { Bento } from '../components/landing/Bento'
import { ProductPreview } from '../components/landing/ProductPreview'
import { REPO, SitePage } from '../components/SiteFrame'
import { WaitlistForm } from '../components/WaitlistForm'

const STEPS = [
  { n: '01', title: 'Connect', body: 'Link your Meta ad account. Read-only.' },
  { n: '02', title: 'Perceive', body: 'Every ad is broken into scenes, hooks and tags.' },
  { n: '03', title: 'Analyze', body: 'Tags are tied to results with honest stats.' },
  { n: '04', title: 'Explain', body: 'Scale, cut and make next, with citations.' },
]

const STACK = ['Gemini', 'Claude', 'Postgres', 'pgvector', 'Supabase', 'Modal', 'React', 'TypeScript', 'Python']

export function Landing() {
  return (
    <SitePage>
      <main>
        {/* ---------------------------------------------------------------- hero */}
        <section className="relative overflow-hidden">
          <div className="site-grid-bg pointer-events-none absolute inset-0" aria-hidden />
          <div className="pointer-events-none absolute left-1/2 top-[-280px] h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(144_133_233/0.2),transparent)]" aria-hidden />
          <div className="relative mx-auto max-w-6xl px-5 pb-10 pt-20 text-center sm:pt-28">
            <a href={REPO} className="rise inline-flex items-center gap-2 rounded-full border border-[var(--site-line)] bg-white/[0.03] py-1 pl-1 pr-3 text-xs text-[var(--site-muted)] transition hover:border-white/20 hover:text-[var(--site-text)]">
              <span className="rounded-full bg-white/[0.08] px-2 py-0.5 font-medium text-[var(--site-text)]">Open source</span>
              Building in public on GitHub
              <span aria-hidden>→</span>
            </a>
            <h1 className="rise rise-1 mx-auto mt-7 max-w-4xl text-[40px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-7xl">
              Know which ads win,
              <br />
              <span className="accent-text pr-2 font-serif font-normal italic tracking-[-0.01em]">and why.</span>
            </h1>
            <p className="rise rise-2 mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--site-muted)]">
              An AI creative strategist for Meta ads. See what's working, and what to make next.
            </p>
            <div id="waitlist" className="rise rise-3 mt-9 scroll-mt-24">
              <WaitlistForm product="mosaic" source="landing-hero" align="center" />
            </div>
            <p className="rise rise-3 mt-4 text-sm">
              <a href="/demo" className="text-[var(--site-text)] underline decoration-white/30 underline-offset-4 transition hover:decoration-white">
                Or explore the live demo →
              </a>
            </p>
            <ul className="rise rise-3 mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-[var(--site-muted)]">
              {['Read-only', 'Every claim cited', 'Free in early access'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <span className="text-[var(--v5)]" aria-hidden>✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div id="product" className="rise rise-4 relative mx-auto max-w-6xl scroll-mt-20 px-5 pb-24">
            <ProductPreview />
          </div>
        </section>

        {/* ------------------------------------------------------- how it works */}
        <section id="how" className="scroll-mt-16 border-t border-[var(--site-line)]">
          <div className="mx-auto max-w-6xl px-5 py-24">
            <SectionHead eyebrow="How it works" title="From ad account to answer" body="Four steps. Every answer traces back to its source." />
            <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-[var(--site-line)] bg-[var(--site-line)] sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n} className="bg-[var(--site-bg)] p-6">
                  <p className="font-mono text-xs text-[var(--v5)]">{s.n}</p>
                  <h3 className="mt-6 text-base font-medium">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--site-muted)]">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------------------ features */}
        <section className="border-t border-[var(--site-line)]">
          <div className="mx-auto max-w-6xl px-5 py-24">
            <SectionHead eyebrow="Features" title="A strategist's whole job" body="Done on every ad, every sync." />
            <div className="mt-14">
              <Bento />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ grounded */}
        <section id="grounded" className="scroll-mt-16 border-t border-[var(--site-line)]">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--site-muted)]">Grounding</p>
              <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-[-0.03em] sm:text-5xl">
                Every number is checked{' '}
                <span className="font-serif font-normal italic text-[var(--site-muted)]">before you see it.</span>
              </h2>
              <p className="mt-5 max-w-md text-base leading-relaxed text-[var(--site-muted)]">
                Each claim cites ads and numbers. A validator checks them against your data before the report is saved.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-[#c9ccd1]">
                {['Mismatches are regenerated or flagged', 'Accuracy is scored in CI on every change'].map((t) => (
                  <li key={t} className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--v4)]" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <CodePanel />
          </div>
        </section>

        {/* ------------------------------------------------------- open source */}
        <section className="border-t border-[var(--site-line)]">
          <div className="mx-auto max-w-6xl px-5 py-20 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--site-muted)]">Built in the open</p>
            <p className="mx-auto mt-4 max-w-xl text-lg text-[#c9ccd1]">
              Pipeline, statistics and evals, all open source.
            </p>
            <ul className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-2">
              {STACK.map((s) => (
                <li key={s} className="rounded-full border border-[var(--site-line)] px-3 py-1 font-mono text-xs text-[var(--site-muted)]">{s}</li>
              ))}
            </ul>
            <a href={REPO} className="mt-8 inline-flex items-center gap-2 rounded-lg border border-[var(--site-line)] bg-white/[0.03] px-4 py-2 text-sm transition hover:border-white/20">
              <GitHubIcon />
              View the code on GitHub
            </a>
          </div>
        </section>

        {/* --------------------------------------------------------------- CTA */}
        <section className="relative overflow-hidden border-t border-[var(--site-line)]">
          <div className="pointer-events-none absolute bottom-[-320px] left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(144_133_233/0.16),transparent)]" aria-hidden />
          <div className="relative mx-auto max-w-6xl px-5 py-28 text-center">
            <h2 className="mx-auto max-w-3xl text-4xl font-semibold leading-tight tracking-[-0.03em] sm:text-6xl">
              Stop guessing
              <br />
              <span className="accent-text pr-2 font-serif font-normal italic">what to make next.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-[var(--site-muted)]">Free during early access.</p>
            <div className="mt-9">
              <WaitlistForm product="mosaic" source="landing-footer" align="center" />
            </div>
          </div>
        </section>
      </main>
    </SitePage>
  )
}

function SectionHead({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="max-w-2xl">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--site-muted)]">{eyebrow}</p>
      <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-[-0.03em] sm:text-5xl">{title}</h2>
      <p className="mt-4 text-base leading-relaxed text-[var(--site-muted)]">{body}</p>
    </div>
  )
}

function CodePanel() {
  const k = 'text-[var(--v5)]'
  const s = 'text-[var(--v6)]'
  const n = 'text-[var(--site-text)]'
  const m = 'text-[var(--site-muted)]'
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--site-line)] bg-[var(--site-card)]">
      <div className="flex items-center gap-1 border-b border-[var(--site-line)] px-3 py-2 font-mono text-[11px]">
        <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[var(--site-text)]">claim.json</span>
        <span className="px-2 py-1 text-[var(--site-muted)]">validator.log</span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-6 text-[#c9ccd1]">
        {'{\n'}
        {'  '}<span className={k}>"section"</span>: <span className={s}>"cut"</span>,{'\n'}
        {'  '}<span className={k}>"claim"</span>: <span className={s}>"Offer-first UGC is losing money."</span>,{'\n'}
        {'  '}<span className={k}>"ad_ids"</span>: [<span className={s}>"syn_ad_000"</span>],{'\n'}
        {'  '}<span className={k}>"metrics"</span>: {'{\n'}
        {'    '}<span className={k}>"roas"</span>: <span className={n}>0.65</span>,{'\n'}
        {'    '}<span className={k}>"spend"</span>: <span className={n}>4728.81</span>{'\n'}
        {'  }\n}'}
      </pre>
      <div className="border-t border-[var(--site-line)] bg-black/25 px-5 py-4 font-mono text-[12px] leading-6">
        <p><span className="text-[var(--v5)]">✓</span> <span className={m}>ad</span> syn_ad_000 <span className={m}>exists in workspace</span></p>
        <p><span className="text-[var(--v5)]">✓</span> <span className={m}>roas</span> 0.65 <span className={m}>= db 0.6514 (rounded)</span></p>
        <p><span className="text-[var(--v5)]">✓</span> <span className={m}>spend</span> 4728.81 <span className={m}>= db 4728.81</span></p>
        <p className="mt-1 text-[var(--v5)]">grounding_passed: true</p>
      </div>
    </div>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}
