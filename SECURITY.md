# Security

Mosaic handles Meta advertising data and access tokens, so security reports are taken seriously.

**Please do not open a public issue for a vulnerability.** Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). You will get an acknowledgement within a few days.

Scope includes the web app, the worker API, the database policies in `supabase/`, and anything that could expose a workspace's data or tokens to another user.

Notes on the design:

- Meta tokens are stored in Supabase Vault; the database only holds the secret id. Tokens never appear in logs or in client code.
- Every workspace-scoped table has row-level security; the browser only ever uses the anon key plus the user's session.
- The worker runs with the service role and authorizes requests by verifying the caller's Supabase session and workspace ownership.
