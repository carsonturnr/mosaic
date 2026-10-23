-- Per-ad totals and derived rates over an optional date window.
-- Used by the creative library and as the base for tag-level analytics.
-- security invoker: RLS on ads / creatives / ad_daily_metrics applies to the caller.

create or replace function ad_performance(
  p_workspace uuid,
  p_since date default null,
  p_until date default null
)
returns table (
  ad_id uuid,
  external_id text,
  name text,
  status text,
  creative_id uuid,
  creative_type creative_type,
  storage_path text,
  thumbnail_path text,
  duration_s numeric,
  perception_status text,
  first_date date,
  last_date date,
  active_days int,
  spend numeric,
  impressions bigint,
  clicks bigint,
  link_clicks bigint,
  purchases numeric,
  purchase_value numeric,
  video_3s_views bigint,
  video_thruplays bigint,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  cpa numeric,
  roas numeric,
  hook_rate numeric,
  hold_rate numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with totals as (
    select
      a.id as ad_id,
      min(m.date) as first_date,
      max(m.date) as last_date,
      count(m.date)::int as active_days,
      coalesce(sum(m.spend), 0) as spend,
      coalesce(sum(m.impressions), 0)::bigint as impressions,
      coalesce(sum(m.clicks), 0)::bigint as clicks,
      coalesce(sum(m.link_clicks), 0)::bigint as link_clicks,
      coalesce(sum(m.purchases), 0) as purchases,
      coalesce(sum(m.purchase_value), 0) as purchase_value,
      sum(m.video_3s_views)::bigint as video_3s_views,
      sum(m.video_thruplays)::bigint as video_thruplays
    from ads a
    left join ad_daily_metrics m
      on m.ad_id = a.id
     and (p_since is null or m.date >= p_since)
     and (p_until is null or m.date <= p_until)
    where a.workspace_id = p_workspace
    group by a.id
  )
  select
    a.id,
    a.external_id,
    a.name,
    a.status,
    c.id,
    c.type,
    c.storage_path,
    c.thumbnail_path,
    c.duration_s,
    c.perception_status,
    t.first_date,
    t.last_date,
    t.active_days,
    t.spend,
    t.impressions,
    t.clicks,
    t.link_clicks,
    t.purchases,
    t.purchase_value,
    t.video_3s_views,
    t.video_thruplays,
    case when t.impressions > 0 then t.clicks::numeric / t.impressions end,
    case when t.clicks > 0 then t.spend / t.clicks end,
    case when t.impressions > 0 then t.spend * 1000 / t.impressions end,
    case when t.purchases > 0 then t.spend / t.purchases end,
    case when t.spend > 0 then t.purchase_value / t.spend end,
    case when t.impressions > 0 and t.video_3s_views is not null
         then t.video_3s_views::numeric / t.impressions end,
    case when coalesce(t.video_3s_views, 0) > 0
         then t.video_thruplays::numeric / t.video_3s_views end
  from totals t
  join ads a on a.id = t.ad_id
  left join creatives c on c.id = a.creative_id;
$$;

grant execute on function ad_performance(uuid, date, date) to authenticated;
