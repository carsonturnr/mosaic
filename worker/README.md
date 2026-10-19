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
