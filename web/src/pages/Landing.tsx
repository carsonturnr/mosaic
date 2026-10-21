import { SitePage } from '../components/SiteFrame'
import { WaitlistForm } from '../components/WaitlistForm'

const steps = [
  {
    title: 'Connect',
    body: 'Sign in with Meta and pick an ad account. Mosaic imports campaigns, ads, creatives and 90 days of daily results, then keeps them current on a schedule.',
  },
  {
    title: 'Break down',
    body: 'Every video is split into scenes with a transcript, on-screen text and a visual description. The first three seconds are tagged as the hook. Statics get the same treatment from the image and copy.',
  },
  {
    title: 'Analyze',
    body: 'Hooks, angles, personas, formats and offers are ranked by the KPI you care about, with confidence levels so a forty-dollar ad never gets crowned the winner.',
  },
  {
    title: 'Act',
    body: 'A strategist report says what is working, what to double down on, what to cut and which concepts are missing. Every claim links to the ads and numbers behind it.',
  },
]

const features = [
  ['Scene-level breakdown', 'Transcript, on-screen text, visuals and B-roll type for every scene of every ad.'],
  ['Hook analysis', 'Hook type, opening visual and first line, tied to hook rate and hold rate.'],
  ['Your taxonomy', 'Tags follow your media-buying framework. Edit it, add custom tags, filter by anything.'],
  ['Honest rankings', 'Statistical shrinkage pulls low-spend ads toward the account average before anything is called a winner.'],
  ['Concept diversity', 'Near-duplicates are clustered into real concepts, so you know whether you have 4 ideas or 22.'],
  ['Cited reports', 'Reports and briefs quote specific ads and metrics, and every number is checked against the database.'],
  ['Briefs, not pixels', 'Variations and new angles as scripts, hook lists and written direction. No image generation.'],
  ['Evals you can see', 'Tagging accuracy, grounding checks and planted-problem detection, published on a dashboard.'],
]

export function Landing() {
  return (
    <SitePage>
      <main>
        <section className="mx-auto max-w-5xl px-6 pt-16 pb-20 sm:pt-24">
          <p className="text-sm font-medium text-neutral-500">For DTC brands running Meta ads</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            An in-house creative strategist, for brands that can't afford one.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-neutral-600">
            Mosaic connects to your ad account, breaks every creative down scene by scene, ties what it sees
            to performance, and tells you what to make next, with the receipts.
          </p>
          <div className="mt-8">
            <WaitlistForm product="mosaic" source="landing-hero" />
            <p className="mt-2 text-xs text-neutral-500">Early access is free while we build. No spam.</p>
          </div>
        </section>

        <section id="how" className="border-t border-neutral-200 bg-neutral-50">
          <div className="mx-auto max-w-5xl px-6 py-16">
            <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
            <ol className="mt-8 grid gap-8 sm:grid-cols-2">
              {steps.map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-medium text-white">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-medium">{s.title}</h3>
                    <p className="mt-1 text-sm text-neutral-600">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">What you get</h2>
          <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(([title, body]) => (
              <li key={title} className="rounded-lg border border-neutral-200 p-4">
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="mt-1 text-sm text-neutral-600">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-neutral-200">
          <div className="mx-auto max-w-5xl px-6 py-16">
            <h2 className="text-2xl font-semibold tracking-tight">Built in the open</h2>
            <p className="mt-3 max-w-2xl text-neutral-600">
              Mosaic is open source and under active development. The code, the evals and the week-by-week plan
              are all on GitHub. Reports only ever read from your ad account; nothing is written to it.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <a
                href="https://github.com/carsonturnr/mosaic"
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
              >
                View on GitHub
              </a>
              <WaitlistForm product="mosaic" source="landing-footer" />
            </div>
          </div>
        </section>
      </main>
    </SitePage>
  )
}
