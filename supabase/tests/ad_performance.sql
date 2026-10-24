-- Runs in CI after the migrations. Raises on any wrong number or RLS leak.
do $$
declare
  u1 uuid := '11111111-1111-1111-1111-111111111111';
  u2 uuid := '22222222-2222-2222-2222-222222222222';
  ws uuid; cv uuid; ci uuid; av uuid; ai uuid;
  r record;
begin
  insert into auth.users values (u1), (u2);
  insert into workspaces (owner_id, name) values (u1, 'A') returning id into ws;
  insert into creatives (workspace_id, external_id, type, duration_s) values (ws, 'cv', 'video', 20) returning id into cv;
  insert into creatives (workspace_id, external_id, type) values (ws, 'ci', 'image') returning id into ci;
  insert into ads (workspace_id, external_id, name, creative_id) values (ws, 'av', 'Video ad', cv) returning id into av;
  insert into ads (workspace_id, external_id, name, creative_id) values (ws, 'ai', 'Image ad', ci) returning id into ai;
  insert into ads (workspace_id, external_id, name) values (ws, 'empty', 'No data');
  insert into ad_daily_metrics (ad_id, date, spend, impressions, clicks, link_clicks, purchases, purchase_value, video_3s_views, video_thruplays) values
    (av, '2026-10-01', 10, 1000, 20, 15, 1, 50, 300, 150),
    (av, '2026-10-02', 30, 3000, 40, 35, 3, 150, 900, 300),
    (ai, '2026-10-01', 5, 2000, 10, 8, 0, 0, null, null);

  select * into r from ad_performance(ws) where external_id = 'av';
  assert r.spend = 40 and r.impressions = 4000 and r.active_days = 2, 'video totals';
  assert round(r.ctr, 6) = 0.015 and r.cpa = 10 and r.roas = 5, 'video rates';
  assert round(r.hook_rate, 6) = 0.3 and round(r.hold_rate, 6) = 0.375, 'video hook/hold';

  select * into r from ad_performance(ws) where external_id = 'ai';
  assert r.cpa is null and r.roas = 0 and r.hook_rate is null and r.hold_rate is null, 'image rates';

  select * into r from ad_performance(ws) where external_id = 'empty';
  assert r.spend = 0 and r.ctr is null and r.active_days = 0, 'ad without data';

  select * into r from ad_performance(ws, '2026-10-02', '2026-10-02') where external_id = 'av';
  assert r.spend = 30 and r.active_days = 1, 'date window';
end $$;

-- RLS: another user sees nothing through the function
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  assert (select count(*) from ad_performance((select id from workspaces where name = 'A'))) = 0, 'rls leak';
end $$;
reset role;

-- Demo workspaces are readable without owning them; private ones are not.
insert into auth.users values ('33333333-3333-3333-3333-333333333333');
insert into workspaces (owner_id, name, is_demo) values ('33333333-3333-3333-3333-333333333333', 'Demo', true);
-- hosted Supabase grants these by default; RLS is what restricts rows
grant usage on schema public to anon;
grant select on all tables in schema public to anon;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  assert (select count(*) from workspaces where name = 'Demo') = 1, 'anon cannot see demo';
  assert (select count(*) from workspaces where name = 'A') = 0, 'anon sees private workspace';
end $$;
reset role;
