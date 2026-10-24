from types import SimpleNamespace as NS
from typing import Any

from mosaic.agents.briefs import SUBMIT_TOOL, BriefSet
from mosaic.agents.run import generate_briefs
from mosaic.agents.tools import SnapshotTools, run_tool
from mosaic.analytics.run import latest_snapshot
from mosaic.seed import seed
from mosaic.store import MemoryStore


def brief_set(store: MemoryStore, ws: str, value_override: float | None = None) -> dict[str, Any]:
    t = SnapshotTools({"all": latest_snapshot(store, ws, "all")})
    top = max(
        (
            v
            for v in run_tool(
                t,
                "get_tag_performance",
                {"dimension": "hook_type", "metric": "ctr", "window": "all"},
            )["values"]
            if v["verdict"] != "low_data"
        ),
        key=lambda v: v["estimate"],
    )
    brief = {
        "title": f"More {top['value']}",
        "based_on_ads": top["ads"][:2],
        "why": f"{top['value']} hooks lead on CTR.",
        "evidence": [
            {
                "entity": f"tag:hook_type={top['value']}",
                "metric": "ctr",
                "value": top["estimate"] if value_override is None else value_override,
                "window": "all",
            }
        ],
        "hook_type": top["value"],
        "angle": "problem-solution",
        "format": "UGC",
        "persona": "busy parent",
        "length_seconds": 25,
        "hook_line": "Still tired at 3 p.m.?",
        "script": [
            {
                "seconds": "0-3",
                "visual": "Selfie, yawning",
                "voiceover": "Still tired at 3 p.m.?",
                "on_screen_text": "3 p.m. crash?",
            }
        ],
        "cta": "Shop now",
    }
    return {
        "briefs": [brief],
        "hook_list": ["a", "b"],
        "static_directions": [{"title": "s", "headline": "h", "visual": "v", "primary_text": "p"}],
        "test_plan": [
            {
                "brief_title": brief["title"],
                "hypothesis": "h",
                "primary_metric": "ctr",
                "daily_budget_usd": 50,
                "days": 7,
                "success_criterion": "CTR above account average",
            }
        ],
    }


class Fake:
    def __init__(self, outputs: list[dict[str, Any]]) -> None:
        self.outputs, self.requests = outputs, []

    def __call__(self, **kw: Any) -> Any:
        self.requests.append({**kw, "messages": list(kw["messages"])})
        return NS(
            content=[
                NS(
                    type="tool_use",
                    id=f"b{len(self.requests)}",
                    name="submit_briefs",
                    input=self.outputs.pop(0),
                )
            ],
            stop_reason="tool_use",
            usage=NS(input_tokens=10, output_tokens=10),
        )


def test_briefs_are_grounded_saved_and_use_brand_memory() -> None:
    store = MemoryStore()
    ws = seed(store, "owner", seed=42)["workspace_id"]
    store.insert(
        "brand_memory", {"workspace_id": ws, "guidelines": "Never say 'miracle'.", "learnings": ""}
    )
    store.insert(
        "reports",
        {
            "workspace_id": ws,
            "kind": "strategist",
            "created_at": "2026-10-24T00:00:00",
            "content": {"summary": "Curiosity hooks win."},
            "grounding_passed": True,
        },
    )
    fake = Fake([brief_set(store, ws)])
    row, run = generate_briefs(store, ws, fake, request="Focus on UGC.")
    assert run.grounding.passed and row["kind"] == "brief" and row["grounding_passed"] is True
    prompt = fake.requests[0]["messages"][0]["content"]
    assert (
        "Focus on UGC." in prompt
        and "Never say 'miracle'." in prompt
        and "Curiosity hooks win." in prompt
    )
    assert BriefSet.model_validate(row["content"]).test_plan[0].days == 7


def test_wrong_evidence_triggers_one_retry() -> None:
    store = MemoryStore()
    ws = seed(store, "owner", seed=42)["workspace_id"]
    fake = Fake([brief_set(store, ws, value_override=0.9), brief_set(store, ws)])
    _, run = generate_briefs(store, ws, fake)
    assert run.attempts == 2 and run.grounding.passed


def test_submit_schema_is_strict() -> None:
    import json

    s = json.dumps(SUBMIT_TOOL["input_schema"])
    assert "$ref" not in s and SUBMIT_TOOL["strict"] is True
