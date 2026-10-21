"""Modal deployment: scheduled sync and perception jobs + the FastAPI worker API.

    modal secret create mosaic-env \
        SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
        META_APP_ID=... META_APP_SECRET=... META_GRAPH_VERSION=v26.0 \
        WORKER_API_KEY=... GEMINI_API_KEY=...
    modal deploy modal_app.py
"""

from __future__ import annotations

from typing import Any

import modal

app = modal.App("mosaic")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install_from_pyproject("pyproject.toml")
    .add_local_python_source("mosaic")
)
secrets = [modal.Secret.from_name("mosaic-env")]


def _run(job: str) -> list[dict[str, Any]]:
    from mosaic import jobs
    from mosaic.config import Settings
    from mosaic.store import SupabaseStore

    settings = Settings.from_env()
    store = SupabaseStore(settings.supabase_url, settings.supabase_service_role_key)
    results = jobs.for_all_sources(store, settings, job)
    print(f"{job}: {results}")
    return results


@app.function(image=image, secrets=secrets, schedule=modal.Period(hours=4), timeout=1800)
def structure_sync() -> list[dict[str, Any]]:
    return _run("structure")


@app.function(image=image, secrets=secrets, schedule=modal.Period(hours=4), timeout=1800)
def today_kpis() -> list[dict[str, Any]]:
    return _run("today_kpis")


@app.function(image=image, secrets=secrets, schedule=modal.Cron("0 8 * * *"), timeout=3600)
def restatement() -> list[dict[str, Any]]:
    return _run("restatement")


@app.function(image=image, secrets=secrets, schedule=modal.Period(hours=4), timeout=3600)
def perceive() -> list[dict[str, Any]]:
    """Runs after structure sync picks up new creatives; skips unchanged hashes."""
    from mosaic import jobs
    from mosaic.config import Settings
    from mosaic.media import SupabaseStorage
    from mosaic.store import SupabaseStore

    settings = Settings.from_env()
    store = SupabaseStore(settings.supabase_url, settings.supabase_service_role_key)
    storage = SupabaseStorage(store.client)
    results: list[dict[str, Any]] = []
    for ds in store.select("data_sources", "*"):
        if ds["kind"] == "sandbox_synthetic":
            continue  # synthetic creatives have no media
        try:
            run = jobs.perceive(store, settings, ds, storage)
            results.append(
                {"data_source_id": ds["id"], "status": "done", "stats": run.get("stats")}
            )
        except Exception as exc:
            results.append({"data_source_id": ds["id"], "status": "failed", "error": str(exc)})
    print(f"perceive: {results}")
    return results


@app.function(image=image, secrets=secrets, timeout=600)
@modal.asgi_app()
def web() -> Any:
    from mosaic.api import app as fastapi_app

    return fastapi_app
