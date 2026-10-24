"""Scheduled and on-demand sync jobs (docs/ARCHITECTURE.md §6 schedule).

Every job resolves a data_sources row to a DataSource, runs the sync, and records a
sync_runs row. Modal and the FastAPI API call these; they contain no transport code.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from mosaic.analytics.run import analyze_workspace
from mosaic.config import Settings
from mosaic.datasources.base import DataSource
from mosaic.datasources.meta import MetaClient, MetaLiveSource
from mosaic.datasources.synthetic import SandboxSyntheticSource
from mosaic.store import Row, Store
from mosaic.sync import run_job, sync_metrics, sync_structure
from mosaic.vault import read_token

BACKFILL_DAYS = 90
RESTATEMENT_DAYS = 28


def build_source(ds: Row, settings: Settings, store: Store) -> DataSource:
    kind = ds["kind"]
    if kind == "sandbox_synthetic":
        return SandboxSyntheticSource()
    if kind == "meta_live":
        if not ds.get("token_secret_id"):
            raise RuntimeError(f"data source {ds['id']} has no token")
        token = read_token(store, ds["token_secret_id"])
        client = MetaClient(
            token, app_secret=settings.meta_app_secret, version=settings.meta_graph_version
        )
        return MetaLiveSource(client, ds["meta_ad_account_id"])
    if kind == "demo":
        return SandboxSyntheticSource(seed=7)  # placeholder until DemoSource exists
    raise ValueError(f"unknown data source kind {kind!r}")


def _today() -> date:
    return datetime.now(UTC).date()


def structure(store: Store, settings: Settings, ds: Row) -> Row:
    src = build_source(ds, settings, store)
    run = run_job(
        store, ds["id"], "structure", lambda: sync_structure(src, ds["workspace_id"], store)
    )
    try:
        embed(store, settings, ds)
    except Exception:
        pass  # the failure is recorded in sync_runs by run_job
    return run


def metrics(store: Store, settings: Settings, ds: Row, job: str, since: date, until: date) -> Row:
    src = build_source(ds, settings, store)
    return run_job(
        store, ds["id"], job, lambda: sync_metrics(src, ds["workspace_id"], store, since, until)
    )


def embed(store: Store, settings: Settings, ds: Row) -> Row | None:
    """Script embeddings for clustering; skipped when no Gemini key is configured."""
    if not settings.gemini_api_key:
        return None
    from mosaic.perception.embed import embed_scripts
    from mosaic.providers import GeminiEmbedder

    embedder = GeminiEmbedder(settings.gemini_api_key)
    return run_job(
        store, ds["id"], "embed", lambda: embed_scripts(store, embedder, ds["workspace_id"])
    )


def analysis(store: Store, ds: Row) -> Row:
    """Recompute every analysis window for the data source's workspace."""
    return run_job(store, ds["id"], "analyze", lambda: analyze_workspace(store, ds["workspace_id"]))


def today_kpis(store: Store, settings: Settings, ds: Row) -> Row:
    today = _today()
    run = metrics(store, settings, ds, "today_kpis", today - timedelta(days=1), today)
    analysis(store, ds)
    return run


def restatement(store: Store, settings: Settings, ds: Row) -> Row:
    today = _today()
    run = metrics(
        store, settings, ds, "restatement", today - timedelta(days=RESTATEMENT_DAYS), today
    )
    analysis(store, ds)
    return run


def backfill(store: Store, settings: Settings, ds: Row, days: int = BACKFILL_DAYS) -> list[Row]:
    today = _today()
    return [
        structure(store, settings, ds),
        metrics(store, settings, ds, "backfill", today - timedelta(days=days), today),
        analysis(store, ds),
    ]


def refresh(store: Store, settings: Settings, workspace_id: str) -> list[Row]:
    out: list[Row] = []
    sources = store.select("data_sources", "*", workspace_id=workspace_id)
    for ds in sources:
        out.append(structure(store, settings, ds))
        today = _today()
        out.append(metrics(store, settings, ds, "today_kpis", today - timedelta(days=1), today))
    if sources:
        out.append(analysis(store, sources[0]))  # one pass covers the whole workspace
    return out


def for_all_sources(store: Store, settings: Settings, job: str) -> list[dict[str, Any]]:
    """Run one job across every data source; one account's failure never stops the rest."""
    fn = {"structure": structure, "today_kpis": today_kpis, "restatement": restatement}[job]
    results: list[dict[str, Any]] = []
    for ds in store.select("data_sources", "*"):
        try:
            run = fn(store, settings, ds)
            results.append(
                {"data_source_id": ds["id"], "status": "done", "stats": run.get("stats")}
            )
        except Exception as exc:
            results.append({"data_source_id": ds["id"], "status": "failed", "error": str(exc)})
    return results


def build_llm(settings: Settings) -> Any:
    """The production LLM: Gemini provider, disk cache, Langfuse tracing when configured."""
    import os
    from pathlib import Path

    from mosaic.llm import LLM, DiskCache, LangfuseTracer, NullTracer
    from mosaic.providers import GeminiProvider

    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    tracer = LangfuseTracer() if os.environ.get("LANGFUSE_SECRET_KEY") else NullTracer()
    cache_dir = Path(os.environ.get("MOSAIC_CACHE_DIR", "/tmp/mosaic-llm-cache"))
    return LLM(GeminiProvider(settings.gemini_api_key), cache=DiskCache(cache_dir), tracer=tracer)


def perceive(store: Store, settings: Settings, ds: Row, storage: Any, limit: int = 50) -> Row:
    """Ingest media for new creatives, then tag every pending creative."""
    import tempfile
    from pathlib import Path

    from pydantic import BaseModel

    from mosaic.media import ingest_pending
    from mosaic.perception.pipeline import perceive_pending

    class PerceiveStats(BaseModel):
        ingested: int
        done: int
        failed: int

    src = build_source(ds, settings, store)
    llm = build_llm(settings)

    def run() -> PerceiveStats:
        with tempfile.TemporaryDirectory() as tmp:
            if hasattr(src, "media_dir"):
                src.media_dir = Path(tmp)  # type: ignore[attr-defined]
            ingested = ingest_pending(src, store, storage, ds["workspace_id"], Path(tmp))
        counts = perceive_pending(llm, store, storage, ds["workspace_id"], limit=limit)
        return PerceiveStats(ingested=len(ingested), **counts)

    return run_job(store, ds["id"], "perceive", run)
