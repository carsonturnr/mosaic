# web

React 19 + Vite + TypeScript (strict) + Tailwind v4. Reads data from Supabase directly (RLS by workspace); calls the worker API for actions.

```bash
cp .env.example .env     # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm install
npm run dev
npm run build            # tsc -b && vite build
npm run lint             # oxlint
```

Current pages:
- `/sign-in` — magic link (email) and Google via Supabase Auth.
- `/` — list and create workspaces (requires auth).

`src/lib/database.types.ts` is hand-written for now; regenerate with `supabase gen types typescript --linked` once the project is linked.
