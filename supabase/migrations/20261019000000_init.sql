-- Mosaic initial schema (docs/ARCHITECTURE.md §7).
-- Workspace-scoped tables; RLS policies live in the next migration.

create extension if not exists vector;

create type source_kind as enum ('meta_live', 'sandbox_synthetic', 'demo');
create type creative_type as enum ('video', 'image', 'carousel');
create type tag_source as enum ('ai', 'user');
create type report_kind as enum ('strategist', 'brief');

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index workspaces_owner_id_idx on workspaces(owner_id);

create table data_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind source_kind not null,
  meta_ad_account_id text,               -- e.g. act_1129851222828729
  token_secret_id uuid,                  -- Supabase Vault reference, never the raw token
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index data_sources_workspace_id_idx on data_sources(workspace_id);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  external_id text not null,
  name text, objective text, status text,
  created_time timestamptz, raw jsonb,
  unique (workspace_id, external_id)
);

create table ad_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete cascade,
  external_id text not null,
  name text, status text, optimization_goal text, daily_budget_cents bigint, raw jsonb,
  unique (workspace_id, external_id)
);
create index ad_sets_campaign_id_idx on ad_sets(campaign_id);

create table creatives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  external_id text not null,
  type creative_type not null,
  primary_text text, headline text, cta_type text,
  storage_path text, thumbnail_path text, content_hash text,
  duration_s numeric, width int, height int,
  perception_status text not null default 'pending'
    check (perception_status in ('pending', 'processing', 'done', 'failed')),
  raw jsonb,
  unique (workspace_id, external_id)
);
create index creatives_perception_status_idx on creatives(workspace_id, perception_status);

create table ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_set_id uuid references ad_sets(id) on delete cascade,
  creative_id uuid references creatives(id),
  external_id text not null,
  name text, status text, created_time timestamptz, raw jsonb,
  unique (workspace_id, external_id)
);
create index ads_ad_set_id_idx on ads(ad_set_id);
create index ads_creative_id_idx on ads(creative_id);

create table ad_daily_metrics (
  ad_id uuid not null references ads(id) on delete cascade,
  date date not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  reach bigint, clicks bigint, link_clicks bigint,
  purchases numeric, purchase_value numeric,
  video_3s_views bigint, video_thruplays bigint,
  video_p25 bigint, video_p50 bigint, video_p75 bigint, video_p100 bigint,
  synced_at timestamptz not null default now(),
  primary key (ad_id, date)
);
create index ad_daily_metrics_date_idx on ad_daily_metrics(date);

-- Derived metrics live in a view, not in the table.
create view ad_daily_metrics_derived as
select
  m.*,
  a.workspace_id,
  case when m.impressions > 0 then m.clicks::numeric / m.impressions end                 as ctr,
  case when m.clicks > 0 then m.spend / m.clicks end                                     as cpc,
  case when m.impressions > 0 then m.spend * 1000 / m.impressions end                    as cpm,
  case when coalesce(m.purchases, 0) > 0 then m.spend / m.purchases end                  as cpa,
  case when m.spend > 0 then coalesce(m.purchase_value, 0) / m.spend end                 as roas,
  case when m.impressions > 0 then m.video_3s_views::numeric / m.impressions end         as hook_rate,
  case when coalesce(m.video_3s_views, 0) > 0
       then m.video_thruplays::numeric / m.video_3s_views end                            as hold_rate
from ad_daily_metrics m
join ads a on a.id = m.ad_id;

create table scenes (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references creatives(id) on delete cascade,
  idx int not null,
  start_s numeric not null, end_s numeric not null,
  keyframe_path text, transcript text, on_screen_text text,
  visual_description text, broll_type text,
  unique (creative_id, idx)
);

create table taxonomy_dimensions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,  -- null = system default
  key text not null, label text not null, description text,
  allowed_values jsonb,                  -- null = free text
  applies_to text not null default 'ad' check (applies_to in ('ad', 'hook', 'scene')),
  unique nulls not distinct (workspace_id, key)
);

create table creative_tags (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references creatives(id) on delete cascade,
  scene_id uuid references scenes(id) on delete cascade,
  dimension_key text not null,
  value text not null,
  confidence numeric,
  source tag_source not null default 'ai',
  model text,
  created_at timestamptz not null default now()
);
create index creative_tags_creative_id_idx on creative_tags(creative_id);
create index creative_tags_dimension_value_idx on creative_tags(dimension_key, value);

create table custom_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null, color text,
  unique (workspace_id, name)
);
create table ad_custom_tags (
  ad_id uuid references ads(id) on delete cascade,
  custom_tag_id uuid references custom_tags(id) on delete cascade,
  primary key (ad_id, custom_tag_id)
);

create table creative_embeddings (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references creatives(id) on delete cascade,
  scene_id uuid references scenes(id) on delete cascade,
  kind text not null check (kind in ('visual', 'script', 'static')),
  model text not null,
  embedding vector(1024)                 -- TODO: set to the chosen embedding model's dimension
);
create index creative_embeddings_creative_id_idx on creative_embeddings(creative_id);

create table concept_clusters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_at timestamptz not null default now(),
  label text, summary text
);
create table concept_cluster_members (
  cluster_id uuid references concept_clusters(id) on delete cascade,
  creative_id uuid references creatives(id) on delete cascade,
  primary key (cluster_id, creative_id)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind report_kind not null,
  input_snapshot jsonb, content jsonb not null, citations jsonb,
  grounding_passed boolean, model text, trace_id text,
  created_at timestamptz not null default now()
);
create index reports_workspace_kind_idx on reports(workspace_id, kind, created_at desc);

create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  data_source_id uuid not null references data_sources(id) on delete cascade,
  job text not null, status text not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  stats jsonb, error text
);
create index sync_runs_data_source_id_idx on sync_runs(data_source_id, started_at desc);

create table eval_runs (
  id uuid primary key default gen_random_uuid(),
  suite text not null, git_sha text, metrics jsonb not null,
  created_at timestamptz not null default now()
);
