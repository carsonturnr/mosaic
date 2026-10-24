-- Precomputed analysis per workspace and window, written by the worker after each
-- metrics sync. The web app and the strategist agent read the same snapshot.
create table analysis_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  window_key text not null check (window_key in ('7', '30', '90', 'all')),
  since date not null,
  until date not null,
  computed_at timestamptz not null default now(),
  payload jsonb not null,
  unique (workspace_id, window_key)
);

alter table analysis_snapshots enable row level security;
create policy "owner reads analysis" on analysis_snapshots for select
  using (owns_workspace(workspace_id));
-- writes go through the service role only
