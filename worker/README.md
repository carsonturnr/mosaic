# worker

Python package `mosaic` (FastAPI + Modal). Pipeline: sync → perceive → analyze → explain.

```bash
uv sync
uv run pytest
uv run ruff check .
```

Modules:
- `mosaic.models` — pydantic models for every external payload (campaigns, ad sets, ads, creatives, media, daily metrics).
- `mosaic.datasources` — `DataSource` protocol and implementations (`SandboxSyntheticSource` now; `MetaLiveSource`, `DemoSource` later).

## Run the API locally

```bash
uv run uvicorn mosaic.api:app --reload --port 8000
```

Set `WORKER_API_KEY` in the root `.env`. The web app authenticates with the user's Supabase session token; `WORKER_API_KEY` is for service-to-service calls.

## Seed the synthetic workspace

```bash
uv run python -m mosaic.seed --owner-email you@example.com
```

## Deploy to Modal

```bash
modal secret create mosaic-env SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... META_APP_ID=... META_APP_SECRET=... META_GRAPH_VERSION=v26.0 WORKER_API_KEY=... CORS_ORIGINS=https://your-app.vercel.app
modal deploy modal_app.py
```
