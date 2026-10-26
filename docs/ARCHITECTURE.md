# Mosaic — Architecture

> Scope, architecture, data model, analytics and conventions. The product spec is in [MOSAIC_MVP.md](MOSAIC_MVP.md).

## 1. What we're building

**Mosaic is an AI creative strategist for Meta ads.** A DTC brand owner connects their Meta ad account; Mosaic imports every ad, breaks each creative down scene by scene with vision models, ties those tags to performance, and turns it into guidance: what's working, what to double down on, what to cut, and briefs for the next tests.

- **One-liner:** an in-house creative strategist for brands that can't afford one.
- **User:** a DTC brand owner with one Meta ad account.
- **Goal:** a polished, deployed, demo-ready MVP by **Dec 6, 2026** (~95 hours at ~15 h/week). Primary purpose is a resume-grade applied-AI project; secondary is a product that could actually be sold.
- **Builder:** solo developer. Keep everything simple, typed, and tested.

### Success criteria (definition of done)
1. A Meta sandbox ad account connects via Meta sign-in and syncs on schedule, with synthetic performance data layered on.
2. Every ad (video and static) is broken down and tagged automatically.
3. Dashboard ranks hooks, angles, personas, formats, offers by KPI, with confidence levels.
4. Strategist report and briefs cite the specific ads and numbers behind every claim.
5. Evals dashboard shows real tagging-accuracy and grounding numbers.
6. Deployed, with a seeded demo workspace and a 2–3 minute demo video.

---

## 2. Current status (as of Oct 26, 2026)

- Meta developer app **"Mosaic"** created (App ID `4146949778771922`), in Development mode, with the **Create & manage ads with Marketing API** use case. `ads_read`, `ads_management`, `business_management`, `pages_show_list`, `pages_read_engagement` show "Ready for testing".
- Sandbox ad account created: **`act_1129851222828729`** ("Mosaic Dev", USD, America/Chicago), associated with the "Mosaic Dev" Facebook page.
- **Meta access is working (Oct 19).** The app is connected to a separate business portfolio, **Mosaic Ads** (`1650747423354771`). A system user **`mosaic-sync`** (Admin) has the Mosaic app (full access) and the sandbox ad account granted to it. Its non-expiring token (ads_read, ads_management, business_management) lives in `.env` as `META_ACCESS_TOKEN` and successfully reads `act_1129851222828729`.
- Personal user tokens do NOT work for the sandbox account; always use the system user token for API calls.
- Business verification is not done yet; it is only needed for App Review (week 5).
- **Sandbox limits (tested):** campaigns, ad sets and image uploads work; ads and ad creatives cannot be created while the app is in Development mode. Ads, creatives and all KPIs therefore come from the synthetic layer (`SandboxSyntheticSource`). Switching the app to Live needs a Privacy Policy URL — optional.
- Sandbox fixtures and gotchas: test campaign `120330001596475419`, ad set `120330001596476119`, page `1413908748461370`. Campaign creation requires `is_adset_budget_sharing_enabled=false` when not using CBO. Creative creation in dev mode fails with error subcode 1885183.
- **Week 1 done:** private repo `carsonturnr/mosaic`; Supabase schema + derived-metrics view + taxonomy seed, RLS verified; worker `DataSource` protocol + pydantic models; synthetic generator v1 (all five planted patterns, deterministic, `evals/answer_key.json`, 17 tests); web scaffold (React 19, strict TS, Tailwind v4, magic-link + Google sign-in, workspace pages); test campaign/ad set/image in the sandbox as fixtures.
- **Week 2 code done (Oct 20):** `mosaic.store` (Supabase + in-memory), `mosaic.sync` (idempotent upserts, `sync_runs`), `mosaic.seed` (synthetic workspace seeded in the hosted project: 24 ads, 90 days, ground-truth tags as `creative_tags` with `model='synthetic'`), `MetaLiveSource` (pagination, throttle backoff, appsecret_proof; insight mappers), `mosaic.jobs` (backfill / structure / today / restatement / refresh), FastAPI worker API (`/workspaces/{id}/refresh`, `/meta/adaccounts`, `/workspaces/{id}/meta/connect`; auth = Supabase user JWT with ownership check, or `WORKER_API_KEY`), `modal_app.py` (4-hourly + nightly schedules + ASGI), Vault helpers (`vault_store_secret` / `vault_read_secret`, service role only), web workspace page with Refresh and Connect Meta (FB JS SDK). 39 worker tests.
- **Week 3 code done (Oct 21):** `mosaic.media` (ingest to private `creatives` bucket, ffprobe, skip unchanged hash), `perception/scenes.py` (PySceneDetect, 0.5 s min, forced 3.0 s boundary, keyframes), `mosaic.llm` (the one LLM wrapper: validation + one retry, backoff, content cache, tracing), `providers.GeminiProvider` (`gemini-2.5-flash`), `perception/tagging.py` + `pipeline.py`, Modal `perceive` every 4 h, CLI `python -m mosaic.perception <files>`. 51 tests. Not yet run against a real model.
- **Deployed (Oct 21):** web at https://mosaicads.vercel.app (Vercel team Creation, auto-deploys from GitHub `main`, root `web/`); worker on Modal app `mosaic` with API at https://carsonturnr--mosaic-web.us-east.modal.run and schedules structure/today_kpis/perceive every 4 h, restatement nightly 08:00 UTC; config from Modal secret `mosaic-env`. Meta insight/creative field names verified live (`MOSAIC_LIVE_META=1 uv run pytest tests/test_meta_live.py`). When running Modal CLI after sourcing `.env`, unset the empty `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` or they override `~/.modal.toml`.
- **Week 4 progress (Oct 23):** `ad_performance(workspace, since, until)` SQL function (security invoker, tested in CI via `supabase/tests/`); Modal structure sync spawns `perceive` when new creatives appear; web creative library (`/app/w/:id/library`: filters, sort, low-data badge under 5,000 impressions) and ad detail (`/app/w/:id/ads/:adId`: media, KPIs, daily chart, tags with source, scene timeline). Synthetic ground-truth tags display as source "Synthetic". Settings tab (`/app/w/:id/settings`): edit default dimensions as workspace overrides with reset, add custom dimensions, custom tags with colors applied on ad detail and filterable in the library; `length_bucket` is computed and read-only. Remaining: the owner's own taxonomy content, and perception edge cases once real ads exist.
- **Weeks 5–7 code done (Oct 24):** analytics (`mosaic.analytics`: beta-binomial and gamma-Poisson shrinkage with priors capped at one typical ad, tag rankings incl. static vs video with a 10% minimum lift, weekly trends, robust-z outliers, fading ads, underfunded winners, concept clusters on tags + Gemini script embeddings with a spend-weighted diversity score) stored as `analysis_snapshots` (7/30/90/all) after every metrics sync; agents (`mosaic.agents`: one shared loop, strategist report and brief generator on `claude-opus-5-5` with typed read-only tools, strict submit tools, server-side refusal fallbacks, grounding validator with one retry); evals (`mosaic.evals`: planted problems 100% on 8 seeds gated in CI against `evals/baseline.json`, grounding pass rate, tagging F1 scorer; nightly `nightly_evals` on Modal writes `eval_runs`); web tabs Analysis, Report, Briefs, Evals page, brand memory; public read-only demo (`/demo`, fictional brand Driftwell, `seed --demo`).
- **Oct 26:** agents live on `claude-opus-5-5` as background jobs (`agent_jobs`, Modal `agent_job`), traced in Langfuse. Tagging runs on `gemini-3.5-flash` with a 3-minute timeout; a free-tier daily cap (`QuotaExhausted`) defers the rest of the batch to the next run. Local dev workspaces (`source_kind = 'local'`, `mosaic.datasources.local`): real ad files plus stored tagging results, with synthetic performance planted on the ads' own tags; seeded once with `python -m mosaic.seed --local <folder> <tags.json>`, skipped by scheduled jobs, never demo-readable. A private workspace of 40 public dev ads is seeded this way; all planted patterns surface in its analysis.
- **Blocked / pending:** Facebook Login for Business needs a configuration id (`VITE_META_CONFIG_ID`). Tagging F1 needs the hand-labeled set. Static creatives from the Ad Library carry no copy, so they get no script embedding and cluster on tags alone.
- **Creatives for development:** 20–40 public ads from ONE brand via the Meta Ad Library, stored in Supabase Storage only; the local media folder is git-ignored. **Before anything public** (demo video, deployed link, public repo), swap them for the owner's own creatives or a fictional brand so synthetic metrics never sit on a real company's ads.

---

## 3. MVP features

1. **Accounts & Meta connection** — Supabase Auth (email/Google). Facebook Login for Business with `ads_read` (and `ads_management` for seeding). Pick one ad account per workspace.
2. **Automatic sync** — campaigns, ad sets, ads, creatives (video files, images, primary text, headline, CTA) and daily KPIs. Schedule in §6.
3. **Ad breakdown (perception pipeline)**
   - Video → scenes; per scene: transcript, on-screen text, visual description, B-roll type, keyframe.
   - Hook (first 3 seconds) gets its own tags: hook type, opening visual, first line.
   - Whole-ad tags: angle, persona, format (UGC, talking head, demo, montage, static…), offer, proof type, CTA, length bucket.
   - Static images: same tags from image + copy.
   - All tags are structured JSON validated against a schema, each with a confidence score.
4. **Tagging system** — AI tags follow an editable taxonomy (owner's media-buying framework; seed defaults in §8). Users can create custom tags and apply them to ads. All tags filterable.
5. **Creative library** — ad wall (thumbnail, key KPIs, tags), filters/sorting; ad detail with video player + scene timeline, transcript, tags, KPI-over-time chart.
6. **Performance analysis**
   - Tag values ranked by KPI with confidence (empirical-Bayes shrinkage so low-spend ads can't "win").
   - Static vs video comparison.
   - Trends over time per tag.
   - Outliers: ads far above/below their peer group, flagged.
7. **Similarity & concept diversity** — find ads with similar B-roll/scenes/scripts (embeddings); cluster near-duplicates into true concepts; diversity score ("4 real concepts, not 22").
8. **Strategist report** — what's working, double down, cut, missing concepts. Every claim cites ad IDs and numbers. Regenerates after each sync.
9. **Brief generator** — from a winning ad or hook: variations and new angles as text (briefs, scripts, hook lists, written static direction). Export a test plan. **No image generation.**
10. **Evals & tracing dashboard** — tagging accuracy, grounding checks, planted-problem detection, agent traces and cost per account.

Supporting: **seeded demo workspace** (fictional brand + synthetic data with planted issues) and **onboarding** (empty states, short first-run tour).

### Out of scope (V1.1 backlog — do not build now)
"Ask your ads" chat agent · creative fatigue alerts · CSV import · Slack/email digests · Meta webhooks · TikTok · launching/staging campaigns · image generation · agency/multi-account workspaces · billing.

---

## 4. Stack

| Layer | Choice |
| --- | --- |
| Frontend | React + Vite + TypeScript (strict) + Tailwind, deployed on Vercel |
| DB / auth / storage | Supabase (Postgres + pgvector, Auth, Storage) |
| Workers / API | Python 3.12 + FastAPI on **Modal** (cron schedules, queues, GPU if needed) |
| Python tooling | `uv`, `ruff`, `pydantic` v2, `pytest` |
| Video/image understanding | Gemini Flash (native video input, structured JSON output) |
| Speech-to-text | Gemini transcription or Whisper (hosted) |
| Scene detection | ffmpeg + PySceneDetect |
| Agents | Claude (tool use + structured outputs) |
| Embeddings | A multimodal embedding model (choose one; record the dimension in the migration) |
| Tracing & evals | Langfuse |

Budget: ~$40–100/month during the build. Cache aggressively; never re-tag a creative whose hash hasn't changed.

---

## 5. Architecture

One pipeline: **sync → perceive → analyze → explain**. Each stage writes structured rows to Postgres; later stages never re-read raw media.

1. **Sync workers** pull from a `DataSource` (see §6) into Postgres and download media to Supabase Storage.
2. **Perception workers** process new/changed creatives: scene detection + keyframes → transcript → vision-model tagging (JSON schema) → embeddings.
3. **Analytics layer** (SQL views + Python) computes tag performance with shrinkage, trends, outliers, clusters, diversity.
4. **Agents** (strategist, brief generator) call typed tools over the analytics layer and must output claims with citations (ad IDs + metric values).
5. **Grounding validator** checks every cited number against the DB before a report is saved.
6. **Tracing**: every model/tool call goes to Langfuse with workspace ID, cost, latency.
7. **Web app** reads via Supabase (RLS by workspace); calls the worker API for actions (refresh, generate report, generate brief).

### Repo layout
```
/web            React + Vite app
/worker         Python package: data sources, sync, perception, analytics, agents (FastAPI + Modal)
/supabase       migrations, seed SQL
/evals          labeled sets, eval runners, results
/scripts        seeding (sandbox + synthetic), one-off tools
docs/ARCHITECTURE.md
```

---

## 6. Data sources & Meta integration

### Data-source layer (build this first)
All reads go through one interface so the app works identically on live Meta, sandbox + synthetic, or the demo workspace.

```python
class DataSource(Protocol):
    def list_campaigns(self) -> list[Campaign]: ...
    def list_ad_sets(self) -> list[AdSet]: ...
    def list_ads(self) -> list[Ad]: ...
    def get_creative(self, creative_external_id: str) -> Creative: ...
    def download_media(self, creative: Creative) -> MediaFile: ...
    def get_daily_metrics(self, ad_ids: list[str], since: date, until: date) -> list[AdDailyMetric]: ...
```

Implementations:
- `MetaLiveSource` — Marketing API (Graph API v26.0).
- `SandboxSyntheticSource` — structure from the Meta sandbox where possible; ads/creatives/metrics from local seed + synthetic generator.
- `DemoSource` — fully local fixtures for the demo workspace.

### Meta notes
- Sandbox ad accounts never deliver, so they have **no performance data**. Meta's docs (2024) also state ads and ad creatives can't be created in sandbox mode — **test this**. If true: campaigns/ad sets live in the sandbox; ads, creatives and all metrics come from the synthetic layer, keyed so the UI is identical.
- Tokens: short-lived user tokens expire in hours. For background sync, exchange for a long-lived token (`/oauth/access_token?grant_type=fb_exchange_token…`) and store it encrypted (Supabase Vault). Never log tokens. Never commit them.
- Insights: request daily breakdown (`time_increment=1`) at ad level. Needed fields include spend, impressions, reach, clicks, inline link clicks, actions/action_values (purchases, purchase value), and video metrics (3-second views, thruplays, p25/p50/p75/p100). **Confirm exact field names in Meta's docs** before coding the mapper.
- Respect rate limits: batch requests, back off on throttling errors, spread jobs.

### Sync schedule
| Job | Frequency | Purpose |
| --- | --- | --- |
| Structure sync | every 4 h | new/edited/paused/deleted ads; queue new creatives for perception |
| Today's KPIs | every 4 h | today's numbers per ad |
| Restatement re-pull | nightly | re-pull last 28 days (Meta revises past results) |
| Initial backfill | on connect | 90 days of daily KPIs + all active/recent ads |
| Refresh now | on demand | structure + today's KPIs |

---

## 7. Database schema (starting point)

```sql
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

create table data_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind source_kind not null,
  meta_ad_account_id text,               -- e.g. act_1129851222828729
  token_secret_id uuid,                  -- Supabase Vault reference, never the raw token
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

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

create table creatives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  external_id text not null,
  type creative_type not null,
  primary_text text, headline text, cta_type text,
  storage_path text, thumbnail_path text, content_hash text,
  duration_s numeric, width int, height int,
  perception_status text not null default 'pending',  -- pending | processing | done | failed
  raw jsonb,
  unique (workspace_id, external_id)
);

create table ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_set_id uuid references ad_sets(id) on delete cascade,
  creative_id uuid references creatives(id),
  external_id text not null,
  name text, status text, created_time timestamptz, raw jsonb,
  unique (workspace_id, external_id)
);

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
-- Derived metrics (CTR, CPC, CPM, CPA, ROAS, hook rate = 3s views / impressions,
-- hold rate = thruplays / 3s views) live in a view, not in the table.

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
  applies_to text not null default 'ad', -- 'ad' | 'hook' | 'scene'
  unique (workspace_id, key)
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
  kind text not null,                    -- 'visual' | 'script' | 'static'
  model text not null,
  embedding vector(1024)                 -- set to the chosen model's dimension
);

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

create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  data_source_id uuid not null references data_sources(id) on delete cascade,
  job text not null, status text not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  stats jsonb, error text
);

create table eval_runs (
  id uuid primary key default gen_random_uuid(),
  suite text not null, git_sha text, metrics jsonb not null,
  created_at timestamptz not null default now()
);
```
Enable RLS on every workspace-scoped table: a user can access rows only for workspaces they own.

---

## 8. Perception & tagging

- **Scene detection:** PySceneDetect (content detector) with a minimum scene length (~0.5 s); always force a boundary at 3.0 s so the hook is its own segment.
- **Tagging call:** one vision-model call per creative with the full video (or image + copy) and the taxonomy, returning JSON validated by pydantic. Retry once on validation failure, then mark `failed`.
- **Default taxonomy** (editable; owner will replace with his framework):
  - `hook_type`: problem/pain, curiosity/question, bold claim, stat/number, demo/visual, testimonial, us-vs-them, pattern interrupt, offer-first
  - `angle`: performance/results, convenience, price/value, quality/ingredients, social proof, identity/lifestyle, problem-solution, comparison
  - `persona`: free text, normalized by clustering
  - `format`: UGC, talking head, product demo, montage/B-roll, static image, carousel, text-on-screen, founder story
  - `offer`: none, % discount, $ off, free shipping, bundle, free gift, trial
  - `proof_type`: none, reviews/stars, testimonial, before/after, expert, data/stat, press
  - `cta`: shop now, learn more, sign up, get offer, other
  - `length_bucket`: ≤15 s, 16–30 s, 31–60 s, >60 s, static
- **Caching:** skip perception when `content_hash` is unchanged.

---

## 9. Analytics

- **Shrinkage:** rate metrics (CTR, hook rate, hold rate, CVR) use a beta-binomial empirical-Bayes prior fit on the account; CPA/ROAS use spend-weighted estimates pulled toward the account mean. Show a confidence band; hide "winner" badges below a minimum spend/impression threshold.
- **Tag performance:** aggregate by tag value over a selectable window; rank by chosen KPI; show n ads, spend, shrunk KPI, interval.
- **Outliers:** robust z-score (median/MAD) of shrunk KPI within peer group (same format + objective); flag |z| ≥ 2.
- **Trends:** weekly series per tag value.
- **Clustering:** combine visual + script embeddings with key tags; agglomerative clustering with a distance threshold (tunable). **Diversity score** = effective number of concepts weighted by spend = exp(Shannon entropy of spend share across clusters).

---

## 10. Agents

- **Strategist report agent** (Claude) with typed tools: `get_tag_performance`, `get_outliers`, `get_clusters`, `get_ad_detail`, `search_ads`. Output schema: sections (working / double down / cut / missing concepts), each item = `{claim, ad_ids[], metrics{name: value}}`.
- **Brief generator** with the same tools plus brand memory (guidelines + past learnings stored per workspace). Output: briefs, scripts, hook lists, static-image direction, test-plan rows.
- **Citation format (as built):** instead of `metrics{name: value}`, each claim carries `metrics: [{entity, metric, value, window}]` where entity is `ad:<ref>`, `tag:<dimension>=<value>`, `concepts` or `account`, so every number can be checked against a specific row.
- **Grounding validator:** before saving, every `ad_id` must exist in the workspace and every cited metric must match the DB within rounding. Failed → regenerate once → otherwise save with `grounding_passed=false` and surface a warning.
- All calls traced in Langfuse.

---

## 11. Synthetic data generator

Purpose: realistic daily KPIs for every ad with **planted patterns**, which also serve as the eval answer key.

- Inputs: ads + their (ground-truth) tags, date range (e.g. 90 days), random seed.
- Spend allocation per ad per day with uneven distribution (a few ads take most spend), ad start/stop dates.
- Base rates per format; multipliers by hook type and angle (e.g. one hook type clearly wins).
- **Planted patterns:** a winning hook type; 2 fatiguing ads (hook rate and CTR decay over time); near-duplicate pairs with correlated performance; static vs video gap; one hidden high-performer with low spend (tests shrinkage).
- Noise: binomial sampling for clicks/conversions, day-of-week effects.
- Output: rows in `ad_daily_metrics` + `evals/answer_key.json` describing every planted pattern.
- Deterministic given the seed.

---

## 12. Evals (run in CI on every change)

| Eval | Method | Target |
| --- | --- | --- |
| Tagging accuracy | Compare AI tags to ~100 hand-labeled public ads spanning 3–5 brands (kept private) | Per-field F1 reported |
| Grounding | Validator over every report/brief | 100% of cited numbers match |
| Diversity validity | Agreement with human "same concept?" labels on pairs | Agreement rate reported |
| Planted problems | Run analysis on synthetic data; check each planted pattern is surfaced | All found |
| Brief quality | LLM judge rubric, calibrated against owner's ratings | Score reported |
| Regression | All of the above vs last run | No drop |

Results written to `eval_runs` and shown on the evals dashboard page.

---

## 13. Environment variables

```
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Meta
META_APP_ID=4146949778771922
META_APP_SECRET=
META_SANDBOX_AD_ACCOUNT_ID=act_1129851222828729
META_ACCESS_TOKEN=            # dev only; production tokens live in Supabase Vault
META_GRAPH_VERSION=v26.0

# AI
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
EMBEDDING_API_KEY=

# Tracing
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=

# Modal
MODAL_TOKEN_ID=
MODAL_TOKEN_SECRET=
```
`.env` is git-ignored. Provide `.env.example` with empty values.

---

## 14. Build order (~15 h/week; MVP done Dec 6)

| Week of | Focus | Tasks |
| --- | --- | --- |
| Oct 19 | Foundation (done) | Repo + Supabase + auth; migrations from §7; data-source interface; synthetic generator v1; Meta access via system user; collect public ads from one brand |
| Oct 26 | Connect & sync | `MetaLiveSource`; Facebook Login for Business + account selection with long-lived token in Supabase Vault; sync jobs on Modal (backfill, 4-hourly, nightly re-pull, refresh button); seed script writing the synthetic account into a workspace |
| Nov 2 | Breakdown | Media download/storage; scene detection; transcripts; vision tagging (video + static) |
| Nov 9 | Library | Taxonomy settings + custom tags; creative library + ad detail with scene timeline; start labeled eval set |
| Nov 16 | Analysis | Tag performance with shrinkage; static vs video; trends; outliers; embeddings + clusters + diversity score; submit Business Verification/App Review |
| Nov 23 (light) | Strategist | Strategist report + brief generator with grounding validator; Langfuse tracing |
| Nov 30 | Ship | Eval suite in CI + dashboard; demo workspace with planted issues; swap real-brand ads before anything public; onboarding polish; deploy; demo video |

### Rules
- New ideas → V1.1 backlog, never the current week.
- If a week runs 3+ hours over, cut the lowest item (test-plan export, outlier flags) rather than slipping the date.
- Each feature works end to end before styling.
- If it won't appear in the demo video or the evals, it waits.

---

## 15. Conventions

- TypeScript strict; no `any`. Python fully typed; pydantic models for every external payload and every LLM output.
- Small, reviewable commits. Tests for analytics math, the synthetic generator, the grounding validator and the Meta mappers.
- Never log or commit secrets/tokens.
- Every LLM call goes through one wrapper that handles retries, schema validation, caching and Langfuse tracing.
- Prefer boring, explicit code over clever abstractions.
