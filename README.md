# Mosaic

**An AI creative strategist for Meta ads.** Connect an ad account and Mosaic imports every ad, breaks each creative down scene by scene with vision models, ties the tags to performance, and turns that into guidance: what's working, what to double down on, what to cut, and briefs for the next tests. Every claim cites the ads and numbers behind it.

Built as a solo applied-AI project. The target is a deployed, demo-ready MVP by December 2026. Status and the week-by-week plan live in [docs/BUILD_BOARD.md](docs/BUILD_BOARD.md).

[![CI](https://github.com/carsonturnr/mosaic/actions/workflows/ci.yml/badge.svg)](https://github.com/carsonturnr/mosaic/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## How it works

One pipeline: **sync → perceive → analyze → explain.**

1. **Sync.** Campaigns, ad sets, ads, creatives and daily KPIs are pulled from the Meta Marketing API on a schedule, through a `DataSource` interface that also runs on sandbox plus synthetic data and on a local demo fixture.
2. **Perceive.** Each video is split into scenes; every scene gets a transcript, on-screen text and a visual description. The first three seconds are tagged as the hook. Whole ads get angle, persona, format, offer, proof type and CTA, all as schema-validated JSON with confidence scores.
3. **Analyze.** Tag values are ranked by KPI with empirical-Bayes shrinkage so low-spend ads can't win by noise. Outliers, trends, static-vs-video, and concept clusters with a diversity score.
4. **Explain.** A strategist agent and a brief generator call typed tools over the analytics layer. A grounding validator checks every cited number against the database before a report is saved.

Evals run in CI: tagging accuracy against a labeled set, grounding, planted-problem detection on synthetic data, and brief quality.

## Stack

| Layer | Choice |
| --- | --- |
| Web | React 19, Vite, TypeScript (strict), Tailwind v4, Vercel |
| Data | Supabase (Postgres + pgvector, Auth, Storage, Vault) |
| Workers | Python 3.12, FastAPI, Modal (cron + queues) |
| Perception | Gemini Flash (video + image), ffmpeg + PySceneDetect |
| Agents | Claude with tool use and structured outputs |
| Tracing and evals | Langfuse |

## Repository layout

```
web/        React app: marketing site, auth, creative library, dashboards
worker/     Python package `mosaic`: data sources, sync, perception, analytics, agents
supabase/   migrations and seed SQL
evals/      labeled sets, eval runners, planted-pattern answer key
docs/       MVP spec, build board, decision history
scripts/    seeding and one-off tools
```

## Development

Requirements: Node 22, [uv](https://docs.astral.sh/uv/), the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
git clone https://github.com/carsonturnr/mosaic && cd mosaic
cp .env.example .env && cp web/.env.example web/.env   # fill in Supabase keys

# database
supabase link --project-ref <your-project-ref>
supabase db push --include-seed

# worker
cd worker && uv sync
uv run pytest
uv run python -m mosaic.seed --owner-email you@example.com   # synthetic workspace
uv run uvicorn mosaic.api:app --reload --port 8000

# web
cd ../web && npm install && npm run dev
```

The synthetic data generator plants known patterns (a winning hook type, fatiguing ads, near-duplicates, a hidden low-spend winner) and writes them to `evals/answer_key.json`, so the analysis layer can be tested without spending on ads.

## Documents

- [docs/MOSAIC_MVP.md](docs/MOSAIC_MVP.md): product spec and success criteria
- [docs/BUILD_BOARD.md](docs/BUILD_BOARD.md): live plan with checkboxes
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): architecture brief and conventions used while building

## License

MIT. See [LICENSE](LICENSE).
