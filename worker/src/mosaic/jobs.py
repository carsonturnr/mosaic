"""Scheduled and on-demand sync jobs (docs/ARCHITECTURE.md §6 schedule).

Every job resolves a data_sources row to a DataSource, runs the sync, and records a
sync_runs row. Modal and the FastAPI API call these; they contain no transport code.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

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
    return run_job(
        store, ds["id"], "structure", lambda: sync_structure(src, ds["workspace_id"], store)
    )


def metrics(store: Store, settings: Settings, ds: Row, job: str, since: date, until: date) -> Row:
    src = build_source(ds, settings, store)
    return run_job(
        store, ds["id"], job, lambda: sync_metrics(src, ds["workspace_id"], store, since, until)
    )


def today_kpis(store: Store, settings: Settings, ds: Row) -> Row:
    today = _today()
    return metrics(store, settings, ds, "today_kpis", today - timedelta(days=1), today)


def restatement(store: Store, settings: Settings, ds: Row) -> Row:
    today = _today()
    return metrics(
        store, settings, ds, "restatement", today - timedelta(days=RESTATEMENT_DAYS), today
    )


def backfill(store: Store, settings: Settings, ds: Row, days: int = BACKFILL_DAYS) -> list[Row]:
    today = _today()
    return [
        structure(store, settings, ds),
        metrics(store, settings, ds, "backfill", today - timedelta(days=days), today),
    ]


def refresh(store: Store, settings: Settings, workspace_id: str) -> list[Row]:
    out: list[Row] = []
    for ds in store.select("data_sources", "*", workspace_id=workspace_id):
        out.append(structure(store, settings, ds))
        out.append(today_kpis(store, settings, ds))
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
