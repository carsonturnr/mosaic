import { Prose, SitePage } from '../components/SiteFrame'

export function Privacy() {
  return (
    <SitePage>
      <Prose title="Privacy Policy" updated="October 21, 2026">
        <p>
          Mosaic ("we", "us") is an analytics tool for Meta advertising accounts. This policy explains what
          we collect, why, and what we do with it. The short version: we read your ad data to analyze it for
          you, we never write to your ad account, and we never sell your data.
        </p>

        <h2 className="pt-2 text-lg font-semibold">What we collect</h2>
        <p>
          <strong>Account information.</strong> Your email address when you sign up or join the waitlist, and
          your name if you sign in with Google.
        </p>
        <p>
          <strong>Meta advertising data.</strong> When you connect a Meta ad account, we use the Meta Marketing
          API with the permissions you grant (<code>ads_read</code>, and <code>ads_management</code> only for
          reading creative assets) to import campaigns, ad sets, ads, ad creatives (video and image files,
          primary text, headlines, calls to action) and daily performance metrics such as spend, impressions,
          clicks, conversions and video view metrics. We read this data on a schedule to keep your workspace
          current. We do not create, edit, pause or delete anything in your ad account.
        </p>
        <p>
          <strong>Derived data.</strong> We generate transcripts, scene descriptions, tags, embeddings and
          reports from your creatives and metrics. These are stored in your workspace.
        </p>
        <p>
          <strong>Usage data.</strong> Standard server logs and error reports needed to run the service.
        </p>

        <h2 className="pt-2 text-lg font-semibold">How we use it</h2>
        <p>
          To provide the product: breaking down creatives, computing performance by tag, and generating
          reports and briefs for your workspace. To improve the product: aggregate, de-identified evaluation
          of how accurately our models tag creatives. To contact you about the service.
        </p>

        <h2 className="pt-2 text-lg font-semibold">Third parties we rely on</h2>
        <p>
          Supabase (database, authentication and file storage), Vercel (web hosting), Modal (background
          processing), Google (Gemini models for video and image understanding), Anthropic (Claude models for
          reports and briefs) and Langfuse (tracing of model calls). Creative files and text are sent to the
          model providers only to produce your analysis. Meta access tokens are stored encrypted and are never
          shared.
        </p>

        <h2 className="pt-2 text-lg font-semibold">Retention and deletion</h2>
        <p>
          Your data is retained while your workspace exists. You can disconnect your Meta account at any time,
          which revokes our access and stops syncing. You can request deletion of your workspace and all data
          derived from it by contacting us, and we will complete it within 30 days. You can also remove Mosaic
          from your Meta account under Business Integrations in your Facebook settings.
        </p>

        <h2 className="pt-2 text-lg font-semibold">Your rights</h2>
        <p>
          You may request a copy of your data, correction, or deletion at any time. Contact us using the link
          below.
        </p>

        <h2 className="pt-2 text-lg font-semibold">Changes and contact</h2>
        <p>
          We will post changes to this policy on this page and update the date above. Questions:{' '}
          <a className="underline" href="https://github.com/carsonturnr/mosaic/issues">
            open an issue on GitHub
          </a>
          .
        </p>
      </Prose>
    </SitePage>
  )
}
