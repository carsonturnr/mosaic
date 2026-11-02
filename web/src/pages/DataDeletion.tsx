import { Link } from 'react-router-dom'
import { CONTACT, Prose, SitePage } from '../components/SiteFrame'

export function DataDeletion() {
  return (
    <SitePage>
      <Prose title="Data Deletion" updated="November 2, 2026">
        <p>
          You can remove the data Mosaic holds about you and your ad accounts at any time. There are three ways,
          depending on how much you want removed.
        </p>

        <h2 className="pt-2 text-lg font-semibold">1. Disconnect Meta</h2>
        <p>
          In Mosaic, open your workspace, go to <strong>Settings → Data</strong> and click <strong>Disconnect</strong>.
          This deletes the stored Meta access token and stops all syncing. Ads already imported stay in the workspace
          until you delete it.
        </p>

        <h2 className="pt-2 text-lg font-semibold">2. Delete a workspace</h2>
        <p>
          In <strong>Settings → Data</strong>, type the workspace name and click <strong>Delete workspace</strong>. This
          immediately and permanently deletes the Meta access token, every imported campaign, ad, creative file and
          metric, and everything derived from them: transcripts, scenes, tags, embeddings, reports and briefs.
        </p>

        <h2 className="pt-2 text-lg font-semibold">3. Delete your account</h2>
        <p>
          Email <a className="underline" href={`mailto:${CONTACT}?subject=Delete%20my%20Mosaic%20account`}>{CONTACT}</a>{' '}
          from the address you sign in with and ask for your account to be deleted. We delete the account and all of its
          workspaces within 30 days and reply to confirm.
        </p>

        <h2 className="pt-2 text-lg font-semibold">Removing Mosaic from Facebook</h2>
        <p>
          You can also revoke Mosaic's access from Facebook: go to <strong>Settings &amp; privacy → Settings → Business
          integrations</strong>, select Mosaic and click <strong>Remove</strong>. Mosaic can no longer read your ad
          accounts after that. To also delete the data already imported, use option 2 or 3 above.
        </p>

        <p className="pt-2">
          See the <Link className="underline" to="/privacy">Privacy Policy</Link> for what we collect and why.
        </p>
      </Prose>
    </SitePage>
  )
}
