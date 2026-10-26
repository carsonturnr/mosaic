"""Run the strategist for a workspace and save the report."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from mosaic.agents.briefs import BriefSet, run_briefs
from mosaic.agents.loop import AgentRun
from mosaic.agents.strategist import MODEL, run_strategist
from mosaic.analytics.compute import Snapshot
from mosaic.llm import Tracer
from mosaic.store import Row, Store

REPORT_WINDOWS = ("30", "all")


def load_snapshots(store: Store, workspace_id: str) -> tuple[dict[str, Snapshot], dict[str, str]]:
    rows = store.select(
        "analysis_snapshots", "window_key,computed_at,payload", workspace_id=workspace_id
    )
    snaps = {
        r["window_key"]: Snapshot.model_validate(r["payload"])
        for r in rows
        if r["window_key"] in REPORT_WINDOWS
    }
    computed = {
        r["window_key"]: str(r["computed_at"]) for r in rows if r["window_key"] in REPORT_WINDOWS
    }
    return snaps, computed


def ad_copy(store: Store, workspace_id: str, ads: list[Row]) -> dict[str, dict[str, str | None]]:
    """ad ref -> headline and primary text, for the agents' get_ad_detail tool."""
    creatives = {
        c["id"]: c
        for c in store.select("creatives", "id,headline,primary_text", workspace_id=workspace_id)
    }
    return {
        a["external_id"]: {
            "headline": creatives[a["creative_id"]].get("headline"),
            "primary_text": creatives[a["creative_id"]].get("primary_text"),
        }
        for a in ads
        if a.get("creative_id") in creatives
    }


def generate_report(
    store: Store, workspace_id: str, create: Callable[..., Any], tracer: Tracer | None = None
) -> tuple[Row, AgentRun[Any]]:
    snaps, computed = load_snapshots(store, workspace_id)
    if not snaps:
        raise RuntimeError("no analysis yet; run a sync or POST /workspaces/{id}/analyze first")
    ads = store.select("ads", "id,external_id,creative_id", workspace_id=workspace_id)
    run = run_strategist(
        create,
        snaps,
        {a["external_id"] for a in ads},
        creative_of_ad={a["id"]: a["creative_id"] for a in ads if a["creative_id"]},
        copy=ad_copy(store, workspace_id, ads),
        tracer=tracer,
        workspace_id=workspace_id,
    )
    citations = [
        {"section": section, "ad_ids": c.ad_ids, "metrics": [m.model_dump() for m in c.metrics]}
        for section, c in run.report.claims()
    ]
    row = store.insert(
        "reports",
        {
            "workspace_id": workspace_id,
            "kind": "strategist",
            "input_snapshot": {
                "windows": computed,
                "turns": run.turns,
                "tool_calls": run.tool_calls,
                "cost_usd": round(run.cost_usd, 4),
                "attempts": run.attempts,
                "grounding": run.grounding.model_dump(),
            },
            "content": run.report.model_dump(),
            "citations": citations,
            "grounding_passed": run.grounding.passed,
            "model": MODEL,
        },
    )
    return row, run


def anthropic_create(api_key: str) -> Callable[..., Any]:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key, max_retries=3)
    return client.beta.messages.create


def brand_memory(store: Store, workspace_id: str) -> tuple[str, str]:
    """(guidelines, learnings); learnings include the latest strategist summary."""
    rows = store.select("brand_memory", "guidelines,learnings", workspace_id=workspace_id)
    guidelines = rows[0]["guidelines"] if rows else ""
    learnings = rows[0]["learnings"] if rows else ""
    reports = store.select(
        "reports",
        "created_at,content,grounding_passed",
        workspace_id=workspace_id,
        kind="strategist",
    )
    if reports:
        latest = max(reports, key=lambda r: str(r["created_at"]))
        summary = (latest.get("content") or {}).get("summary")
        if summary:
            learnings = f"{learnings}\nLatest strategist summary: {summary}".strip()
    return guidelines, learnings


def generate_briefs(
    store: Store,
    workspace_id: str,
    create: Callable[..., Any],
    request: str | None = None,
    tracer: Tracer | None = None,
) -> tuple[Row, AgentRun[BriefSet]]:
    snaps, computed = load_snapshots(store, workspace_id)
    if not snaps:
        raise RuntimeError("no analysis yet; run a sync or POST /workspaces/{id}/analyze first")
    ads = store.select("ads", "id,external_id,creative_id", workspace_id=workspace_id)
    guidelines, learnings = brand_memory(store, workspace_id)
    run = run_briefs(
        create,
        snaps,
        {a["external_id"] for a in ads},
        request=request,
        guidelines=guidelines,
        learnings=learnings,
        creative_of_ad={a["id"]: a["creative_id"] for a in ads if a["creative_id"]},
        copy=ad_copy(store, workspace_id, ads),
        tracer=tracer,
        workspace_id=workspace_id,
    )
    row = store.insert(
        "reports",
        {
            "workspace_id": workspace_id,
            "kind": "brief",
            "input_snapshot": {
                "windows": computed,
                "request": request,
                "turns": run.turns,
                "tool_calls": run.tool_calls,
                "cost_usd": round(run.cost_usd, 4),
                "attempts": run.attempts,
                "grounding": run.grounding.model_dump(),
            },
            "content": run.report.model_dump(),
            "citations": [
                {
                    "brief": b.title,
                    "ad_ids": b.based_on_ads,
                    "metrics": [m.model_dump() for m in b.evidence],
                }
                for b in run.report.briefs
            ],
            "grounding_passed": run.grounding.passed,
            "model": MODEL,
        },
    )
    return row, run
