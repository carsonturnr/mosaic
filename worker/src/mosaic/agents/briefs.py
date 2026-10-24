"""Brief generator (docs/ARCHITECTURE.md §10): turn what works into what to shoot next.

Text only, no images: briefs with scripts, a hook list, static directions and a test
plan. Uses the same tools and grounding check as the strategist, plus brand memory.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from mosaic.agents.grounding import validate
from mosaic.agents.loop import MODEL, AgentRun, run_agent, submit_tool
from mosaic.agents.report import MetricCite
from mosaic.agents.tools import SnapshotTools
from mosaic.analytics.compute import Snapshot
from mosaic.llm import Tracer


class Beat(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seconds: str = Field(description='Time range, e.g. "0-3"')
    visual: str
    voiceover: str
    on_screen_text: str


class Brief(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    based_on_ads: list[str] = Field(description="Ad refs this brief builds on")
    why: str = Field(description="One sentence: the evidence for this brief")
    evidence: list[MetricCite] = Field(description="Every number used in `why`, cited exactly")
    hook_type: str
    angle: str
    format: str
    persona: str
    length_seconds: int
    hook_line: str = Field(description="The first spoken or on-screen line")
    script: list[Beat]
    cta: str


class StaticDirection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    headline: str
    visual: str = Field(description="Written art direction; no image is generated")
    primary_text: str


class TestRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    brief_title: str
    hypothesis: str
    primary_metric: str = Field(description="roas, cpa, ctr or hook_rate")
    daily_budget_usd: float
    days: int
    success_criterion: str


class BriefSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    briefs: list[Brief]
    hook_list: list[str] = Field(
        description="10 alternative opening lines in the winning hook styles"
    )
    static_directions: list[StaticDirection]
    test_plan: list[TestRow]

    def citable(self) -> list[tuple[str, str, list[str], list[MetricCite]]]:
        return [("briefs", b.why, b.based_on_ads, b.evidence) for b in self.briefs]


SYSTEM = """You are a senior creative strategist writing briefs for a direct-to-consumer brand's next round of Meta ads.

Start from evidence: use the tools to find the hooks, angles, formats and individual ads that are winning, the underfunded winners, and the concepts the account is missing. Then write briefs an editor or UGC creator could shoot tomorrow.

Rules:
- Write 3 video briefs unless the request asks for something else: at least one iteration on a proven winner and at least one new angle the account has not tried.
- Each brief's `why` is one sentence of evidence; cite every number in it in `evidence`, copying values exactly as the tools return them (rates as fractions), with entity ("ad:<ref>", "tag:<dimension>=<value>", "concepts" or "account") and window.
- Scripts are beat by beat, with the hook in 0-3 seconds. Write in plain, spoken language. No claims the brand could not substantiate.
- Add 2 static directions (written art direction only; no image generation), a list of 10 hook lines, and one test-plan row per brief with a modest daily budget.
- Respect the brand guidelines below when given.

When you are done, call submit_briefs exactly once."""

SUBMIT_TOOL = submit_tool(
    "submit_briefs", "Submit the finished briefs. Call once, at the end.", BriefSet
)


def brand_context(guidelines: str | None, learnings: str | None) -> str:
    parts = []
    if guidelines and guidelines.strip():
        parts.append(f"Brand guidelines:\n{guidelines.strip()}")
    if learnings and learnings.strip():
        parts.append(f"Past learnings:\n{learnings.strip()}")
    return "\n\n".join(parts) or "No brand guidelines have been provided."


def run_briefs(
    create: Callable[..., Any],
    snapshots: dict[str, Snapshot],
    ad_refs: set[str],
    *,
    request: str | None = None,
    guidelines: str | None = None,
    learnings: str | None = None,
    creative_of_ad: dict[str, str] | None = None,
    tracer: Tracer | None = None,
    workspace_id: str | None = None,
    model: str = MODEL,
) -> AgentRun[BriefSet]:
    message = (
        f"{request.strip() if request and request.strip() else 'Write the next round of briefs for this account.'}\n\n"
        f"Analyses exist for windows: {', '.join(sorted(snapshots))}.\n\n{brand_context(guidelines, learnings)}"
    )
    return run_agent(
        create,
        name="briefs",
        system=SYSTEM,
        output=BriefSet,
        submit=SUBMIT_TOOL,
        user_message=message,
        tools=SnapshotTools(snapshots, creative_of_ad),
        validate=lambda r: validate(r, snapshots, ad_refs),
        tracer=tracer,
        workspace_id=workspace_id,
        model=model,
    )
