"""Sync: pull from any DataSource into Postgres (docs/ARCHITECTURE.md §5 stage 1).

Rows are upserted by (workspace_id, external_id), so re-running is idempotent and
columns owned by later stages (perception_status, storage_path, ...) are untouched.
"""

from __future__ import annotations

import traceback
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any

from pydantic import BaseModel

from mosaic.datasources.base import DataSource
from mosaic.models import AdDailyMetric
from mosaic.store import Row, Store


class StructureStats(BaseModel):
    campaigns: int = 0
    ad_sets: int = 0
    creatives: int = 0
    ads: int = 0
    new_creatives: int = 0


class MetricsStats(BaseModel):
    ads: int = 0
    rows: int = 0
    since: date
    until: date


def sync_structure(source: DataSource, workspace_id: str, store: Store) -> StructureStats:
    ws = {"workspace_id": workspace_id}

    campaigns = source.list_campaigns()
    camp_rows = store.upsert(
        "campaigns",
        [
            {
                **ws,
                "external_id": c.external_id,
                "name": c.name,
                "objective": c.objective,
                "status": c.status,
                "created_time": _iso(c.created_time),
                "raw": c.raw,
            }
            for c in campaigns
        ],
        on_conflict="workspace_id,external_id",
    )
    camp_ids = {r["external_id"]: r["id"] for r in camp_rows}

    ad_sets = source.list_ad_sets()
    adset_rows = store.upsert(
        "ad_sets",
        [
            {
                **ws,
                "external_id": s.external_id,
                "campaign_id": camp_ids.get(s.campaign_external_id),
                "name": s.name,
                "status": s.status,
                "optimization_goal": s.optimization_goal,
                "daily_budget_cents": s.daily_budget_cents,
                "raw": s.raw,
            }
            for s in ad_sets
        ],
        on_conflict="workspace_id,external_id",
    )
    adset_ids = {r["external_id"]: r["id"] for r in adset_rows}

    ads = source.list_ads()
    creative_ext_ids = sorted({a.creative_external_id for a in ads})
    existing = {
        r["external_id"]
        for r in store.select("creatives", "external_id", workspace_id=workspace_id)
    }
    creatives = [source.get_creative(ext) for ext in creative_ext_ids]
    creative_rows = store.upsert(
        "creatives",
        [
            {
                **ws,
                "external_id": c.external_id,
                "type": c.type.value,
                "primary_text": c.primary_text,
                "headline": c.headline,
                "cta_type": c.cta_type,
                "duration_s": c.duration_s,
                "width": c.width,
                "height": c.height,
                "raw": {**c.raw, "media_url": c.media_url, "thumbnail_url": c.thumbnail_url},
            }
            for c in creatives
        ],
        on_conflict="workspace_id,external_id",
    )
    creative_ids = {r["external_id"]: r["id"] for r in creative_rows}

    ad_rows = store.upsert(
        "ads",
        [
            {
                **ws,
                "external_id": a.external_id,
                "ad_set_id": adset_ids.get(a.ad_set_external_id),
                "creative_id": creative_ids.get(a.creative_external_id),
                "name": a.name,
                "status": a.status,
                "created_time": _iso(a.created_time),
                "raw": a.raw,
            }
            for a in ads
        ],
        on_conflict="workspace_id,external_id",
    )

    return StructureStats(
        campaigns=len(camp_rows),
        ad_sets=len(adset_rows),
        creatives=len(creative_rows),
        ads=len(ad_rows),
        new_creatives=len([c for c in creatives if c.external_id not in existing]),
    )


def sync_metrics(
    source: DataSource, workspace_id: str, store: Store, since: date, until: date
) -> MetricsStats:
    ads = store.select("ads", "id,external_id", workspace_id=workspace_id)
    ad_ids = {a["external_id"]: a["id"] for a in ads}
    if not ad_ids:
        return MetricsStats(ads=0, rows=0, since=since, until=until)

    metrics = source.get_daily_metrics(sorted(ad_ids), since, until)
    rows = [metric_row(m, ad_ids[m.ad_external_id]) for m in metrics if m.ad_external_id in ad_ids]
    written = store.upsert("ad_daily_metrics", rows, on_conflict="ad_id,date")
    return MetricsStats(ads=len(ad_ids), rows=len(written), since=since, until=until)


def metric_row(m: AdDailyMetric, ad_id: str) -> Row:
    return {
        "ad_id": ad_id,
        "date": m.date.isoformat(),
        "spend": m.spend,
        "impressions": m.impressions,
        "reach": m.reach,
        "clicks": m.clicks,
        "link_clicks": m.link_clicks,
        "purchases": m.purchases,
        "purchase_value": m.purchase_value,
        "video_3s_views": m.video_3s_views,
        "video_thruplays": m.video_thruplays,
        "video_p25": m.video_p25,
        "video_p50": m.video_p50,
        "video_p75": m.video_p75,
        "video_p100": m.video_p100,
        "synced_at": datetime.now(UTC).isoformat(),
    }


def run_job(store: Store, data_source_id: str, job: str, fn: Callable[[], BaseModel]) -> Row:
    """Wrap a sync function in a sync_runs row (running → done | failed)."""
    run = store.insert(
        "sync_runs", {"data_source_id": data_source_id, "job": job, "status": "running"}
    )
    try:
        stats = fn()
    except Exception as exc:
        store.update(
            "sync_runs",
            {
                "status": "failed",
                "finished_at": datetime.now(UTC).isoformat(),
                "error": f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-2000:]}",
            },
            id=run["id"],
        )
        raise
    finished = datetime.now(UTC).isoformat()
    store.update(
        "sync_runs",
        {"status": "done", "finished_at": finished, "stats": stats.model_dump(mode="json")},
        id=run["id"],
    )
    store.update("data_sources", {"last_synced_at": finished}, id=data_source_id)
    return {**run, "status": "done", "stats": stats.model_dump(mode="json")}


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def as_json(obj: Any) -> Any:
    return obj
