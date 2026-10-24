"""Shared agent loop: typed read-only tools, a strict submit tool, grounding check.

Append-only conversation (thinking blocks stay valid); one grounding retry, then the
result is returned as-is with the failed grounding so the caller can flag it.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ValidationError

from mosaic.agents.grounding import GroundingResult
from mosaic.agents.tools import TOOL_DEFS, SnapshotTools, run_tool
from mosaic.llm import NullTracer, Tracer

MODEL = "claude-opus-5-5"
PRICE_PER_MTOK = (4.0, 20.0)  # input, output (USD)
MAX_TURNS = 16


class AgentError(RuntimeError):
    pass


@dataclass
class AgentRun[T: BaseModel]:
    report: T
    grounding: GroundingResult
    attempts: int = 0
    turns: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    tool_calls: list[str] = field(default_factory=list)


def attr(obj: Any, name: str, default: Any = None) -> Any:
    return obj.get(name, default) if isinstance(obj, dict) else getattr(obj, name, default)


def inline_refs(schema: dict[str, Any]) -> dict[str, Any]:
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


def submit_tool(name: str, description: str, schema: type[BaseModel]) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "strict": True,
        "input_schema": inline_refs(schema.model_json_schema()),
    }


def run_agent[T: BaseModel](
    create: Callable[..., Any],
    *,
    name: str,
    system: str,
    user_message: str,
    output: type[T],
    submit: dict[str, Any],
    tools: SnapshotTools,
    validate: Callable[[T], GroundingResult],
    tracer: Tracer | None = None,
    workspace_id: str | None = None,
    model: str = MODEL,
    effort: str = "high",
) -> AgentRun[T]:
    """`create` is `anthropic_client.beta.messages.create` (or a fake in tests)."""
    tracer = tracer or NullTracer()
    messages: list[dict[str, Any]] = [{"role": "user", "content": user_message}]
    run: AgentRun[T] = AgentRun(report=None, grounding=None)  # type: ignore[arg-type]

    for _ in range(MAX_TURNS):
        started = time.monotonic()
        resp = create(
            model=model,
            max_tokens=16000,
            system=system,
            tools=[*TOOL_DEFS, submit],
            tool_choice={"type": "auto"},
            output_config={"effort": effort},
            messages=messages,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        run.turns += 1
        usage = attr(resp, "usage")
        tin, tout = (
            int(attr(usage, "input_tokens", 0) or 0),
            int(attr(usage, "output_tokens", 0) or 0),
        )
        cost = tin / 1e6 * PRICE_PER_MTOK[0] + tout / 1e6 * PRICE_PER_MTOK[1]
        run.input_tokens, run.output_tokens, run.cost_usd = (
            run.input_tokens + tin,
            run.output_tokens + tout,
            run.cost_usd + cost,
        )
        stop = attr(resp, "stop_reason")
        tracer.record(
            {
                "name": f"{name}_turn",
                "model": model,
                "workspace_id": workspace_id,
                "input_tokens": tin,
                "output_tokens": tout,
                "cost_usd": round(cost, 6),
                "latency_s": round(time.monotonic() - started, 3),
                "stop_reason": stop,
            }
        )

        if stop == "refusal":
            raise AgentError("the model declined this request")
        content = list(attr(resp, "content", []))
        messages.append({"role": "assistant", "content": content})
        tool_uses = [b for b in content if attr(b, "type") == "tool_use"]
        if not tool_uses:
            if stop == "max_tokens":
                raise AgentError("ran out of output tokens before submitting")
            messages.append(
                {"role": "user", "content": f"Please finish by calling {submit['name']}."}
            )
            continue

        results: list[dict[str, Any]] = []
        submitted: tuple[Any, T] | None = None
        for block in tool_uses:
            tname, args, bid = attr(block, "name"), attr(block, "input") or {}, attr(block, "id")
            run.tool_calls.append(tname)
            if tname == submit["name"]:
                try:
                    submitted = (bid, output.model_validate(args))
                except ValidationError as exc:
                    results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": bid,
                            "is_error": True,
                            "content": f"The submission does not match the schema: {exc}"[:3000],
                        }
                    )
                continue
            try:
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": bid,
                        "content": json.dumps(run_tool(tools, tname, dict(args))),
                    }
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
            run.report, run.grounding = report, validate(report)
            if run.grounding.passed or run.attempts >= 2:
                return run
            issues = "\n".join(
                f"- [{p.section}] {p.claim!r}: {p.issue}" for p in run.grounding.problems[:20]
            )
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": bid,
                    "is_error": True,
                    "content": "Grounding check failed. Fix these citations using values exactly as the tools "
                    f"return them (call tools again if needed), then call {submit['name']} again:\n{issues}",
                }
            )
        messages.append({"role": "user", "content": results})

    if run.report is not None:
        return run
    raise AgentError(f"nothing submitted after {MAX_TURNS} turns")
