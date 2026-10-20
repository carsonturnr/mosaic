# Mosaic — MVP Spec

Oct 14, 2026 · @Carson

## Overview

Mosaic is an AI creative strategist for Meta ads: a brand owner connects their ad account and gets every ad broken down, tied to its KPIs, and turned into clear guidance on what to double down on. Target: MVP live and demo-ready by Dec 6, 2026, in about 95 hours, with no ad spend.

- **One-liner:** an in-house creative strategist for brands that can't afford one.
- **User:** a DTC brand owner with one Meta ad account (spending roughly $5k–50k/month).
- **Primary goal:** a resume-grade applied-AI product: real Meta integration, a vision pipeline, grounded agents, evals and tracing.
- **Secondary goal:** usable and sellable as-is, so the demo is a real product, not a mockup.
- **Name:** Mosaic.

**Success criteria for the MVP**

1. A Meta sandbox ad account connects through Meta sign-in and syncs automatically on schedule, with synthetic performance data layered on.
2. Every ad (video and static) is broken down and tagged without manual work.
3. The dashboard shows which hooks, angles, formats and personas win, with confidence levels.
4. The strategist report and briefs cite the specific ads and numbers behind every claim.
5. An evals dashboard shows real accuracy and grounding numbers.
6. The app is deployed, with a seeded demo workspace and a 2–3 minute demo video.

## Core user flow

The whole experience is sign up, connect, wait a few minutes, then explore.

1. **Sign up** with email or Google.
2. **Connect Meta:** "Continue with Facebook," grant read access, pick the ad account.
3. **First sync:** the app imports campaigns, ad sets, ads, creatives and 90 days of daily KPIs, with a progress screen while it works.
4. **Breakdown:** every video and static ad is processed and tagged automatically.
5. **Explore:** the creative library, performance analysis and similarity views are ready.
6. **Act:** read the strategist report, generate briefs off winning hooks, export a test plan.
7. **Stay current:** new and changed ads and fresh KPIs arrive on the sync schedule, and new ads are tagged on arrival.

## MVP features

Ten features make up the MVP; the first five are the data foundation, the last five are the intelligence on top.

1. **Accounts and Meta connection**
   - Email/Google sign-up via Supabase Auth.
   - Meta sign-in (Facebook Login for Business) with read access to ads; choose one ad account.
   - Works for anyone added as a tester on your Meta app until App Review clears.
2. **Automatic sync**
   - Imports campaigns, ad sets, ads, creatives (video files, images, copy, headlines) and daily KPIs.
   - KPIs: spend, impressions, CTR, CPC, CPM, conversions, CPA, ROAS, plus hook rate (3-second views ÷ impressions) and hold rate (completions ÷ 3-second views) for video.
   - Schedule and refresh button detailed in the sync section below.
3. **Ad breakdown (perception pipeline)**
   - **Video:** split into scenes; per scene, a transcript, on-screen text, visual description and B-roll type.
   - **Hook analysis:** the first 3 seconds get their own tags (hook type, opening visual, first line).
   - **Whole-ad tags:** angle, persona, format (UGC, talking head, demo, montage…), offer, proof type, CTA, length.
   - **Static images:** the same tags from the image, headline and primary text.
   - Every tag is structured JSON with a confidence score.
4. **Tagging system**
   - AI tags follow a taxonomy built from your media-buying framework, editable in settings.
   - Users create custom tags and apply them to any ad; all tags are filterable.
5. **Creative library**
   - Ad wall with thumbnails, key KPIs and tags; filter and sort by any tag, format, date or metric.
   - Ad detail view: video player with a scene timeline, transcript, tags and KPI chart over time.
6. **Performance analysis**
   - Hooks, angles, personas, formats and offers ranked by KPI, with confidence levels.
   - Small-spend ads are pulled toward the account average (statistical shrinkage), so a $40 ad can't be crowned the winner.
   - Static vs video comparison.
   - Trends over time per tag.
   - Outliers: ads performing far above or below their peer group, flagged automatically.
7. **Similarity and concept diversity**
   - Finds ads sharing similar B-roll, scenes or scripts (visual and text embeddings).
   - Groups near-duplicates into true concepts and scores diversity ("4 real concepts, not 22").
8. **Strategist report**
   - What's working, what to double down on, what to cut, which concepts are missing.
   - Every claim links to the ads and numbers behind it.
   - Regenerates after each sync.
9. **Brief generator**
   - Pick a winning ad or hook; get variations and new angles to test.
   - Outputs text: briefs, video scripts, hook lists, written direction for static images. No image generation.
   - Export a test plan (which concepts to launch, in what order).
10. **Evals and tracing dashboard**
    - Tagging accuracy, grounding checks, agent traces and cost per account. Detailed in the evals section.

Two supporting pieces round out the MVP: a **seeded demo workspace** (a fictional brand with realistic synthetic data, so the demo never depends on a live account) and **onboarding** (empty states and a short first-run tour).

## Data sync with Meta

Sync runs on a schedule rather than in real time: Meta doesn't push KPI changes, its numbers lag anyway, and creative decisions happen over days, not minutes.

| Job | Frequency | What it does |
| --- | --- | --- |
| Structure sync | Every 4 hours | Finds new, edited, paused or deleted ads; queues new creatives for breakdown |
| Today's KPIs | Every 4 hours | Pulls today's numbers per ad |
| Restatement re-pull | Nightly | Re-pulls the last 28 days, because Meta revises past results as late conversions get attributed |
| Initial backfill | Once, on connect | 90 days of daily KPIs plus all active and recent ads |
| Refresh now | On demand | Runs structure sync and today's KPIs immediately |

- **Rate limits:** batch requests and spread jobs over time; one account is far below Meta's limits, but the design should scale.
- **Access path:** development mode with your account as admin for the MVP; Business Verification and App Review (Advanced Access) submitted in week 5, so public launch can follow the MVP.
- **V1.1:** Meta ad-account webhooks (if available for the app) to detect new ads faster. Exact permission names get confirmed against Meta's docs during setup.

**Data sources for the MVP (no live ad spend):**

- **Meta sandbox ad account:** the real API and real sign-in. Tested Oct 19: campaigns, ad sets and image uploads work; ads and ad creatives cannot be created while the app is in Development mode, so ads, creatives and all KPIs come from the synthetic layer. Sandbox ads never deliver, so they have no KPIs anyway.
- **Synthetic performance generator:** writes realistic daily KPIs for every sandbox ad, with planted patterns (winning hooks, fatiguing ads, near-duplicates performing alike, static vs video gaps), plus noise and uneven spend so the data isn't too clean. The planted patterns double as the answer key for evals.
- **Data-source layer:** the app reads live Meta, sandbox plus synthetic, or the demo workspace through the same interface, so a real ad account can connect later with no code changes.
- **Creatives for development:** 20–40 public ads from one brand (Meta Ad Library), kept private and git-ignored. Before anything public, swap them for own creatives or a fictional brand so synthetic metrics never sit on a real company's ads.

## Architecture and stack

The system is one pipeline: sync, perceive, analyze, explain. Each stage writes to Postgres, so every later stage reads structured data instead of raw media.

1. **Sync workers** (Python, scheduled) pull from the Meta Marketing API into Postgres and download media to storage.
2. **Perception workers** process new creatives: ffmpeg scene detection and keyframes, speech-to-text, then a vision model reads each scene and the whole ad and returns tags as structured JSON.
3. **Embeddings** of scenes, scripts and statics go into pgvector for similarity and concept clustering.
4. **Analytics layer** (SQL + Python stats) computes tag performance, shrinkage, trends, outliers and diversity.
5. **Agents** (strategist report, brief generator) call typed tools that query the analytics layer, and must cite ad IDs and numbers in their output.
6. **Tracing** records every model call, tool call, cost and latency.
7. **Web app** reads everything through Supabase.

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React + Vite + Tailwind, on Vercel | Your stack; fast to ship |
| Database, auth, storage | Supabase (Postgres + pgvector) | Your stack; free tier covers the MVP |
| Backend workers and API | Python (FastAPI) on Modal | Cron schedules, queues and GPUs built in; pay per use |
| Video and image understanding | Gemini Flash | Reads full video natively; cheap per minute |
| Speech-to-text | Whisper (via Gemini or a hosted API) | Accurate transcripts for hooks and scripts |
| Agents | Claude | Strongest tool use and structured outputs |
| Embeddings | A multimodal embedding model | Scene and script similarity |
| Tracing and evals | Langfuse | Free tier; standard in AI engineering teams |

Estimated running cost: $40–100/month during the build, with no ad spend needed.

## Evals

Evals are the resume centerpiece: they prove the AI is accurate and grounded, not just impressive-looking. They run in CI, so every prompt or model change re-runs them.

| Eval | How it works | Target |
| --- | --- | --- |
| Tagging accuracy | Compare AI tags to a hand-labeled set (start with \~100 ads: your campaign plus public ads), per tag field | Per-field F1, reported per tag |
| Grounding | Every number and ad cited in a report or brief is checked against the database automatically | 100% of cited numbers match |
| Diversity score validity | Does the clustering agree with your judgment of "same concept" on labeled pairs? | Agreement rate reported |
| Planted problems | Demo workspace seeded with known issues (a fatiguing ad, a hook that wins, near-duplicates); score whether the analysis finds them | All planted issues found |
| Brief quality | Rubric scored by an LLM judge, calibrated against your own ratings on a sample | Rubric score reported |
| Regression | All of the above re-run on every change | No drop vs last release |

The evals dashboard page shows these scores, plus Langfuse traces of agent runs, with cost and latency per account.

## Out of scope (V1.1 backlog)

These are cut to ship by Dec 6; most are a few hours each once the MVP exists.

- "Ask your ads" chat agent
- Creative fatigue alerts
- CSV import fallback
- Slack and email digests
- Meta webhooks for faster new-ad detection
- TikTok Ads integration
- Launching or staging campaigns from the app
- Image generation
- Agency / multi-account workspaces
- Billing and pricing tiers

## Hours, milestones and risks

The build totals about 95 hours, including 7 hours of sandbox and synthetic-data setup, finishing the week of Nov 30 at 15 hours a week (Thanksgiving week planned light). The week-by-week order lives in the combined build board.

| Workstream | Hours |
| --- | --- |
| Sandbox ad account, dev ad collection (public Ad Library ads from one brand), seeding script, synthetic KPI generator | 7 |
| Repo, Supabase schema, auth | 5 |
| Meta sign-in and account selection | 6 |
| Sync jobs and schedules | 10 |
| Media download and storage | 4 |
| Perception pipeline (video and static) | 14 |
| Taxonomy and custom tags | 5 |
| Creative library UI | 7 |
| Performance analysis | 9 |
| Similarity and diversity | 6 |
| Strategist report and brief generator | 8 |
| Evals and tracing dashboard | 8 |
| Demo workspace, polish, deploy, demo video | 6 |
| **Total** | **95** |

**Risks**

- **Synthetic data looks fake:** the generator adds noise, uneven spend and messy patterns, creatives are real files, and a live account can connect later without code changes.
- **Meta App Review delay:** doesn't block the MVP; testers can connect in development mode.
- **Video tagging cost or quality:** cap media length, cache results, and measure accuracy early with the labeled set.
- **Scope creep:** anything not in the feature list goes to the V1.1 backlog.
