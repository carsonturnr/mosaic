# supabase

- `migrations/` — applied in filename order by `supabase db reset` / `supabase db push`.
  - `20261019000000_init.sql` — schema from docs/ARCHITECTURE.md §7 plus the derived-metrics view.
  - `20261019000001_rls.sql` — RLS: owners read their workspace rows; the worker writes with the service role.
- `seed.sql` — default taxonomy dimensions (§8).

`supabase init` has not been run (no `config.toml` yet); run it before `supabase start`. Keep the generated `config.toml`, ignore `.branches/` and `.temp/`.
