-- Row-level security: a user can access rows only for workspaces they own.
-- The worker uses the service role key and bypasses RLS.

create or replace function owns_workspace(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspaces w
    where w.id = ws and w.owner_id = auth.uid()
  );
$$;

-- workspaces -----------------------------------------------------------------
alter table workspaces enable row level security;
create policy "owner selects workspace" on workspaces for select
  using (owner_id = auth.uid());
create policy "owner inserts workspace" on workspaces for insert
  with check (owner_id = auth.uid());
create policy "owner updates workspace" on workspaces for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes workspace" on workspaces for delete
  using (owner_id = auth.uid());

-- tables with a direct workspace_id ------------------------------------------
-- data_sources is read-only from the client: the worker writes it (tokens).
alter table data_sources enable row level security;
create policy "owner selects data_sources" on data_sources for select
  using (owns_workspace(workspace_id));

alter table campaigns enable row level security;
create policy "owner reads campaigns" on campaigns for select
  using (owns_workspace(workspace_id));

alter table ad_sets enable row level security;
create policy "owner reads ad_sets" on ad_sets for select
  using (owns_workspace(workspace_id));

alter table creatives enable row level security;
create policy "owner reads creatives" on creatives for select
  using (owns_workspace(workspace_id));

alter table ads enable row level security;
create policy "owner reads ads" on ads for select
  using (owns_workspace(workspace_id));

alter table concept_clusters enable row level security;
create policy "owner reads concept_clusters" on concept_clusters for select
  using (owns_workspace(workspace_id));

alter table reports enable row level security;
create policy "owner reads reports" on reports for select
  using (owns_workspace(workspace_id));

-- user-editable, workspace-scoped
alter table custom_tags enable row level security;
create policy "owner manages custom_tags" on custom_tags for all
  using (owns_workspace(workspace_id)) with check (owns_workspace(workspace_id));

-- taxonomy: system defaults (workspace_id null) are readable by everyone signed in;
-- workspace overrides are owner-managed.
alter table taxonomy_dimensions enable row level security;
create policy "read system and own taxonomy" on taxonomy_dimensions for select
  using (workspace_id is null or owns_workspace(workspace_id));
create policy "owner manages own taxonomy" on taxonomy_dimensions for all
  using (workspace_id is not null and owns_workspace(workspace_id))
  with check (workspace_id is not null and owns_workspace(workspace_id));

-- tables scoped through a parent ---------------------------------------------
alter table ad_daily_metrics enable row level security;
create policy "owner reads ad_daily_metrics" on ad_daily_metrics for select
  using (exists (select 1 from ads a where a.id = ad_id and owns_workspace(a.workspace_id)));

alter table scenes enable row level security;
create policy "owner reads scenes" on scenes for select
  using (exists (select 1 from creatives c where c.id = creative_id and owns_workspace(c.workspace_id)));

alter table creative_tags enable row level security;
create policy "owner reads creative_tags" on creative_tags for select
  using (exists (select 1 from creatives c where c.id = creative_id and owns_workspace(c.workspace_id)));
create policy "owner manages user creative_tags" on creative_tags for all
  using (source = 'user' and exists (select 1 from creatives c where c.id = creative_id and owns_workspace(c.workspace_id)))
  with check (source = 'user' and exists (select 1 from creatives c where c.id = creative_id and owns_workspace(c.workspace_id)));

alter table ad_custom_tags enable row level security;
create policy "owner manages ad_custom_tags" on ad_custom_tags for all
  using (exists (select 1 from ads a where a.id = ad_id and owns_workspace(a.workspace_id)))
  with check (exists (select 1 from ads a where a.id = ad_id and owns_workspace(a.workspace_id)));

alter table creative_embeddings enable row level security;
create policy "owner reads creative_embeddings" on creative_embeddings for select
  using (exists (select 1 from creatives c where c.id = creative_id and owns_workspace(c.workspace_id)));

alter table concept_cluster_members enable row level security;
create policy "owner reads concept_cluster_members" on concept_cluster_members for select
  using (exists (select 1 from concept_clusters k where k.id = cluster_id and owns_workspace(k.workspace_id)));

alter table sync_runs enable row level security;
create policy "owner reads sync_runs" on sync_runs for select
  using (exists (select 1 from data_sources d where d.id = data_source_id and owns_workspace(d.workspace_id)));

-- eval_runs is not workspace-scoped; readable by any signed-in user for the evals dashboard.
alter table eval_runs enable row level security;
create policy "authenticated reads eval_runs" on eval_runs for select
  to authenticated using (true);

-- the derived view runs with the invoker's rights so RLS on ad_daily_metrics applies
alter view ad_daily_metrics_derived set (security_invoker = on);
