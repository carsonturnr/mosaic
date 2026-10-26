"""Strategist report agent (docs/ARCHITECTURE.md §10)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from mosaic.agents.grounding import validate
from mosaic.agents.loop import MODEL, AgentError, AgentRun, run_agent, submit_tool
from mosaic.agents.report import StrategistReport
from mosaic.agents.tools import SnapshotTools
from mosaic.analytics.compute import Snapshot
from mosaic.llm import Tracer

__all__ = ["MODEL", "SUBMIT_TOOL", "AgentError", "AgentRun", "run_strategist"]

SYSTEM = """You are a senior creative strategist for a direct-to-consumer brand's Meta ads account.

Write a short, specific report: what is working, what to double down on, what to cut, and which concepts are missing. Base every statement on the tools; never estimate or invent a number.

How to read the data:
- Estimates are shrunk toward the average, so small ads cannot look like winners by luck. Prefer "estimate" over "raw".
- A verdict of "winner" or "loser" means the 90% interval clears the comparison by at least 10%. "low_data" means do not draw conclusions.
- Fading ads, underfunded winners and outliers come from get_signals. Concept diversity is the spend-weighted number of distinct concepts.
- Look at the last 30 days for current state and "all" for longer patterns.

Each claim must:
- be one or two plain sentences a media buyer can act on;
- list the ads it is about in ad_ids, using the ad refs the tools return;
- cite every number it states in metrics, copying the value exactly as a tool returned it (rates as fractions such as 0.0178), with the entity ("ad:<ref>", "tag:<dimension>=<value>", "concepts" or "account") and window it came from.

Number formatting:
- In prose, write numbers the way a media buyer would: ROAS 1.64, CPA $36.05, CTR 2.4%, 28% of spend. In citations, copy the exact value the tool returned (rates as fractions such as 0.0178).

Keep each section to at most 4 claims; an empty section is fine. When you are done, call submit_report exactly once."""

SUBMIT_TOOL = submit_tool(
    "submit_report", "Submit the finished report. Call once, at the end.", StrategistReport
)


def run_strategist(
    create: Callable[..., Any],
    snapshots: dict[str, Snapshot],
    ad_refs: set[str],
    *,
    creative_of_ad: dict[str, str] | None = None,
    copy: dict[str, dict[str, str | None]] | None = None,
    tracer: Tracer | None = None,
    workspace_id: str | None = None,
    model: str = MODEL,
) -> AgentRun[StrategistReport]:
    return run_agent(
        create,
        name="strategist",
        system=SYSTEM,
        output=StrategistReport,
        submit=SUBMIT_TOOL,
        user_message="Write the strategist report for this account. Analyses exist for windows: "
        + ", ".join(sorted(snapshots))
        + ".",
        tools=SnapshotTools(snapshots, creative_of_ad, copy),
        validate=lambda r: validate(r, snapshots, ad_refs),
        tracer=tracer,
        workspace_id=workspace_id,
        model=model,
    )
