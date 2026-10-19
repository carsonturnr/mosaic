# Mosaic

AI creative strategist for Meta ads. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for scope, architecture and build order.

## Layout

| Path | Contents |
| --- | --- |
| `web/` | React + Vite + TypeScript app (Vercel) |
| `worker/` | Python package `mosaic`: data sources, sync, perception, analytics, agents (FastAPI + Modal) |
| `supabase/` | migrations and seed SQL |
| `evals/` | labeled sets, eval runners, answer keys |
| `scripts/` | seeding (sandbox + synthetic) and one-off tools |

## Quick start

```bash
cp .env.example .env            # fill in values; never commit .env

# worker
cd worker
uv sync
uv run pytest
uv run ruff check .

# database (local)
supabase start
supabase db reset               # applies supabase/migrations + supabase/seed.sql
```
