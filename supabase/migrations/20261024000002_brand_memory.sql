-- Brand memory for the brief generator: guidelines the owner writes, and learnings
-- (the latest strategist summary is appended automatically by the worker).
create table brand_memory (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  guidelines text not null default '',
  learnings text not null default '',
  updated_at timestamptz not null default now()
);
alter table brand_memory enable row level security;
create policy "owner manages brand memory" on brand_memory for all
  using (owns_workspace(workspace_id)) with check (owns_workspace(workspace_id));
