-- Agent runs take minutes, longer than one web request may stay open, so they run
-- as background jobs. The web app polls this table for status.
create table agent_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind report_kind not null,
  request text,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  report_id uuid references reports(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index agent_jobs_workspace on agent_jobs (workspace_id, created_at desc);
alter table agent_jobs enable row level security;
create policy "owner reads agent jobs" on agent_jobs for select using (owns_workspace(workspace_id));
create policy "anyone reads demo agent jobs" on agent_jobs for select to anon, authenticated using (is_demo_workspace(workspace_id));
