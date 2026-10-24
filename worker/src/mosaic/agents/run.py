"""Run the strategist for a workspace and save the report."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from mosaic.agents.strategist import MODEL, AgentRun, run_strategist
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


def generate_report(
    store: Store, workspace_id: str, create: Callable[..., Any], tracer: Tracer | None = None
) -> tuple[Row, AgentRun]:
    snaps, computed = load_snapshots(store, workspace_id)
    if not snaps:
        raise RuntimeError("no analysis yet; run a sync or POST /workspaces/{id}/analyze first")
    ads = store.select("ads", "id,external_id,creative_id", workspace_id=workspace_id)
    run = run_strategist(
        create,
        snaps,
        {a["external_id"] for a in ads},
        creative_of_ad={a["id"]: a["creative_id"] for a in ads if a["creative_id"]},
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
