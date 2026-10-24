-- Public, read-only access to demo workspaces (is_demo = true) so the landing page
-- can link to a live demo without sign-in. Owners keep their existing policies;
-- these extra SELECT policies only ever match demo rows.

create or replace function is_demo_workspace(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspaces where id = ws and is_demo)
$$;
grant execute on function is_demo_workspace(uuid) to anon, authenticated;

create policy "anyone reads demo workspaces" on workspaces for select to anon, authenticated using (is_demo);
create policy "anyone reads demo data_sources" on data_sources for select to anon, authenticated using (is_demo_workspace(workspace_id));
create policy "anyone reads demo campaigns" on campaigns for select to anon, authenticated using (is_demo_workspace(workspace_id));
create policy "anyone reads demo ad_sets" on ad_sets for select to anon, authenticated using (is_demo_workspace(workspace_id));
create policy "anyone reads demo creatives" on creatives for select to anon, authenticated using (is_demo_workspace(workspace_id));
create policy "anyone reads demo ads" on ads for select to anon, authenticated using (is_demo_workspace(workspace_id));
create policy "anyone reads demo concept_clusters" on concept_clusters for select to anon, authenticated using (is_demo_workspace(workspace_id));
create policy "anyone reads demo reports" on reports for select to anon, authenticated using (is_demo_workspace(workspace_id));
create policy "anyone reads demo custom_tags" on custom_tags for select to anon, authenticated using (is_demo_workspace(workspace_id));
create policy "anyone reads demo analysis" on analysis_snapshots for select to anon, authenticated using (is_demo_workspace(workspace_id));
create policy "anyone reads demo metrics" on ad_daily_metrics for select to anon, authenticated
  using (exists (select 1 from ads a where a.id = ad_id and is_demo_workspace(a.workspace_id)));
create policy "anyone reads demo scenes" on scenes for select to anon, authenticated
  using (exists (select 1 from creatives c where c.id = creative_id and is_demo_workspace(c.workspace_id)));
create policy "anyone reads demo creative_tags" on creative_tags for select to anon, authenticated
  using (exists (select 1 from creatives c where c.id = creative_id and is_demo_workspace(c.workspace_id)));
create policy "anyone reads demo cluster members" on concept_cluster_members for select to anon, authenticated
  using (exists (select 1 from creatives c where c.id = creative_id and is_demo_workspace(c.workspace_id)));
create policy "anyone reads demo ad_custom_tags" on ad_custom_tags for select to anon, authenticated
  using (exists (select 1 from ads a where a.id = ad_id and is_demo_workspace(a.workspace_id)));
create policy "anyone reads demo sync_runs" on sync_runs for select to anon, authenticated
  using (exists (select 1 from data_sources d where d.id = data_source_id and is_demo_workspace(d.workspace_id)));

grant execute on function ad_performance(uuid, date, date) to anon;

-- Demo creative files: first path segment is the workspace id.
create policy "anyone reads demo creative files" on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'creatives'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and is_demo_workspace(((storage.foldername(name))[1])::uuid)
  );
