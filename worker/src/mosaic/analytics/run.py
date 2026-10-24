"""Load a workspace from the store, analyze every window, save snapshots."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from pydantic import BaseModel

from mosaic.analytics.compute import AdInput, Day, Snapshot, analyze
from mosaic.store import Row, Store

WINDOWS: dict[str, int | None] = {"7": 7, "30": 30, "90": 90, "all": None}
# A user's tag beats the AI's; among AI tags the most confident wins.
SOURCE_RANK = {"user": 2, "ai": 1}


def _date(v: Any) -> date:
    return v if isinstance(v, date) else datetime.fromisoformat(str(v)).date()


def pick_tags(rows: list[Row]) -> dict[str, dict[str, str]]:
    """creative_id -> {dimension: value}, whole-ad and hook tags only."""
    best: dict[tuple[str, str], tuple[tuple[int, float], str]] = {}
    for r in rows:
        key = (r["creative_id"], r["dimension_key"])
        score = (SOURCE_RANK.get(r.get("source") or "ai", 0), float(r.get("confidence") or 0))
        if key not in best or score > best[key][0]:
            best[key] = (score, r["value"])
    out: dict[str, dict[str, str]] = defaultdict(dict)
    for (cid, dim), (_, value) in best.items():
        out[cid][dim] = value
    return out


def load_inputs(store: Store, workspace_id: str) -> list[AdInput]:
    ads = store.select(
        "ads", "id,external_id,name,creative_id,ad_set_id", workspace_id=workspace_id
    )
    if not ads:
        return []
    creatives = {
        c["id"]: c for c in store.select("creatives", "id,type", workspace_id=workspace_id)
    }
    ad_sets = {
        s["id"]: s for s in store.select("ad_sets", "id,campaign_id", workspace_id=workspace_id)
    }
    campaigns = {
        c["id"]: c for c in store.select("campaigns", "id,objective", workspace_id=workspace_id)
    }
    creative_ids = [c for c in creatives]
    tags = pick_tags(
        store.select(
            "creative_tags",
            "creative_id,dimension_key,value,confidence,source",
            creative_id=creative_ids,
        )
        if creative_ids
        else []
    )
    metric_rows = store.select(
        "ad_daily_metrics",
        "ad_id,date,spend,impressions,clicks,link_clicks,purchases,purchase_value,video_3s_views,video_thruplays",
        ad_id=[a["id"] for a in ads],
    )
    days: dict[str, list[Day]] = defaultdict(list)
    for m in metric_rows:
        days[m["ad_id"]].append(
            Day(
                date=_date(m["date"]),
                spend=float(m["spend"] or 0),
                impressions=int(m["impressions"] or 0),
                clicks=int(m["clicks"] or 0),
                link_clicks=int(m["link_clicks"] or 0),
                purchases=float(m["purchases"] or 0),
                purchase_value=float(m["purchase_value"] or 0),
                video_3s_views=None if m["video_3s_views"] is None else int(m["video_3s_views"]),
                video_thruplays=None if m["video_thruplays"] is None else int(m["video_thruplays"]),
            )
        )
    out = []
    for a in ads:
        c = creatives.get(a["creative_id"] or "")
        objective = campaigns.get(
            ad_sets.get(a["ad_set_id"] or "", {}).get("campaign_id") or "", {}
        ).get("objective")
        out.append(
            AdInput(
                ad_id=a["id"],
                external_id=a["external_id"],
                name=a["name"] or a["external_id"],
                creative_type=(c or {}).get("type") or "image",
                objective=objective,
                tags=tags.get(a["creative_id"] or "", {}),
                days=days.get(a["id"], []),
            )
        )
    return out


class AnalyzeStats(BaseModel):
    ads: int
    windows: dict[str, str]  # window -> "since..until" or "no data"


def analyze_workspace(store: Store, workspace_id: str) -> AnalyzeStats:
    inputs = load_inputs(store, workspace_id)
    all_days = [d.date for a in inputs for d in a.days]
    if not all_days:
        return AnalyzeStats(ads=len(inputs), windows={k: "no data" for k in WINDOWS})
    # Windows end at the latest day with data, not today, so a stale account still analyzes.
    until, first = max(all_days), min(all_days)
    done: dict[str, str] = {}
    for key, n in WINDOWS.items():
        since = first if n is None else max(first, until - timedelta(days=n - 1))
        snap = analyze(inputs, since, until)
        store.upsert(
            "analysis_snapshots",
            [
                {
                    "workspace_id": workspace_id,
                    "window_key": key,
                    "since": since.isoformat(),
                    "until": until.isoformat(),
                    "computed_at": datetime.now().astimezone().isoformat(),
                    "payload": snap.model_dump(mode="json"),
                }
            ],
            on_conflict="workspace_id,window_key",
        )
        done[key] = f"{since}..{until}"
    return AnalyzeStats(ads=len(inputs), windows=done)


def latest_snapshot(store: Store, workspace_id: str, window_key: str = "30") -> Snapshot | None:
    rows = store.select(
        "analysis_snapshots", "payload", workspace_id=workspace_id, window_key=window_key
    )
    return Snapshot.model_validate(rows[0]["payload"]) if rows else None
