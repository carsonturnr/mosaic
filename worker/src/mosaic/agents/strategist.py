"""Strategist report agent (docs/ARCHITECTURE.md §10).

Claude reads the analysis through typed tools and finishes by calling submit_report.
The report is validated against the data; on failure the agent gets one chance to
fix it in the same conversation (append-only), then it is saved with
grounding_passed = false.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from mosaic.agents.grounding import GroundingResult, validate
from mosaic.agents.report import StrategistReport
from mosaic.agents.tools import TOOL_DEFS, SnapshotTools, run_tool
from mosaic.analytics.compute import Snapshot
from mosaic.llm import NullTracer, Tracer

MODEL = "claude-opus-5-5"
PRICE_PER_MTOK = (4.0, 20.0)  # input, output (USD)
MAX_TURNS = 16

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

Keep each section to at most 4 claims; an empty section is fine. When you are done, call submit_report exactly once."""

SUBMIT_TOOL: dict[str, Any] = {
    "name": "submit_report",
    "description": "Submit the finished report. Call once, at the end.",
    "strict": True,
    "input_schema": StrategistReport.model_json_schema(),
}


class AgentError(RuntimeError):
    pass


@dataclass
class AgentRun:
    report: StrategistReport
    grounding: GroundingResult
    attempts: int
    turns: int
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    tool_calls: list[str] = field(default_factory=list)


def _attr(obj: Any, name: str, default: Any = None) -> Any:
    return obj.get(name, default) if isinstance(obj, dict) else getattr(obj, name, default)


def _inline_refs(schema: dict[str, Any]) -> dict[str, Any]:
    """Strict tool schemas can't use $ref; inline pydantic's $defs."""
    defs = schema.get("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                return walk(defs[node["$ref"].split("/")[-1]])
            return {k: walk(v) for k, v in node.items() if k not in ("$defs", "title")}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    return walk(schema)


def run_strategist(
    create: Callable[..., Any],
    snapshots: dict[str, Snapshot],
    ad_refs: set[str],
    *,
    creative_of_ad: dict[str, str] | None = None,
    tracer: Tracer | None = None,
    workspace_id: str | None = None,
    model: str = MODEL,
) -> AgentRun:
    """`create` is `anthropic_client.beta.messages.create` (or a fake in tests)."""
    tracer = tracer or NullTracer()
    tools = SnapshotTools(snapshots, creative_of_ad)
    submit = {**SUBMIT_TOOL, "input_schema": _inline_refs(SUBMIT_TOOL["input_schema"])}
    messages: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": "Write the strategist report for this account. Analyses exist for windows: "
            + ", ".join(sorted(snapshots))
            + ".",
        }
    ]
    run = AgentRun(report=None, grounding=None, attempts=0, turns=0)  # type: ignore[arg-type]

    for _ in range(MAX_TURNS):
        started = time.monotonic()
        resp = create(
            model=model,
            max_tokens=16000,
            system=SYSTEM,
            tools=[*TOOL_DEFS, submit],
            tool_choice={"type": "auto"},
            output_config={"effort": "high"},
            messages=messages,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        run.turns += 1
        usage = _attr(resp, "usage")
        tin, tout = (
            int(_attr(usage, "input_tokens", 0) or 0),
            int(_attr(usage, "output_tokens", 0) or 0),
        )
        run.input_tokens += tin
        run.output_tokens += tout
        cost = tin / 1e6 * PRICE_PER_MTOK[0] + tout / 1e6 * PRICE_PER_MTOK[1]
        run.cost_usd += cost
        tracer.record(
            {
                "name": "strategist_turn",
                "model": model,
                "workspace_id": workspace_id,
                "input_tokens": tin,
                "output_tokens": tout,
                "cost_usd": round(cost, 6),
                "latency_s": round(time.monotonic() - started, 3),
                "stop_reason": _attr(resp, "stop_reason"),
            }
        )

        stop = _attr(resp, "stop_reason")
        if stop == "refusal":
            raise AgentError("the model declined to write this report")
        content = list(_attr(resp, "content", []))
        messages.append({"role": "assistant", "content": content})
        tool_uses = [b for b in content if _attr(b, "type") == "tool_use"]
        if not tool_uses:
            if stop == "max_tokens":
                raise AgentError("ran out of output tokens before submitting the report")
            messages.append({"role": "user", "content": "Please finish by calling submit_report."})
            continue

        results: list[dict[str, Any]] = []
        submitted: tuple[Any, StrategistReport] | None = None
        for block in tool_uses:
            name, args, bid = _attr(block, "name"), _attr(block, "input") or {}, _attr(block, "id")
            run.tool_calls.append(name)
            if name == "submit_report":
                try:
                    submitted = (bid, StrategistReport.model_validate(args))
                except ValidationError as exc:
                    results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": bid,
                            "is_error": True,
                            "content": f"The report does not match the schema: {exc}"[:3000],
                        }
                    )
                continue
            try:
                out = run_tool(tools, name, dict(args))
                results.append(
                    {"type": "tool_result", "tool_use_id": bid, "content": json.dumps(out)}
                )
            except (ValueError, TypeError) as exc:
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": bid,
                        "is_error": True,
                        "content": str(exc),
                    }
                )

        if submitted:
            bid, report = submitted
            run.attempts += 1
            grounding = validate(report, snapshots, ad_refs)
            run.report, run.grounding = report, grounding
            if grounding.passed or run.attempts >= 2:
                return run
            issues = "\n".join(
                f"- [{p.section}] {p.claim!r}: {p.issue}" for p in grounding.problems[:20]
            )
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": bid,
                    "is_error": True,
                    "content": "Grounding check failed. Fix these citations using values exactly as the tools "
                    f"return them (call tools again if needed), then call submit_report again:\n{issues}",
                }
            )
        messages.append({"role": "user", "content": results})

    if run.report is not None:
        return run
    raise AgentError(f"no report after {MAX_TURNS} turns")
