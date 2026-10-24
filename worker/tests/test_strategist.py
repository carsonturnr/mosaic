import json
from types import SimpleNamespace as NS
from typing import Any

import pytest

from mosaic.agents.grounding import matches, validate
from mosaic.agents.report import StrategistReport
from mosaic.agents.run import generate_report
from mosaic.agents.strategist import SUBMIT_TOOL, _inline_refs, run_strategist
from mosaic.agents.tools import TOOL_DEFS, SnapshotTools, run_tool
from mosaic.analytics.run import latest_snapshot
from mosaic.seed import seed
from mosaic.store import MemoryStore


@pytest.fixture(scope="module")
def ws() -> tuple[MemoryStore, str]:
    store = MemoryStore()
    res = seed(store, "owner", seed=42)
    return store, res["workspace_id"]


def snaps(store: MemoryStore, ws_id: str) -> dict[str, Any]:
    return {k: latest_snapshot(store, ws_id, k) for k in ("30", "all")}


def test_tools_return_json_and_reject_bad_input(ws: tuple[MemoryStore, str]) -> None:
    store, ws_id = ws
    t = SnapshotTools(snaps(store, ws_id))
    perf = run_tool(
        t, "get_tag_performance", {"dimension": "hook_type", "metric": "ctr", "window": "all"}
    )
    assert perf["values"][0]["value"] and json.dumps(perf)
    assert run_tool(
        t,
        "search_ads",
        {"window": "all", "sort_by": "roas", "dimension": None, "value": None, "limit": 3},
    )["ads"]
    assert run_tool(t, "get_signals", {"window": "all"})["fatigue"]
    with pytest.raises(ValueError):
        run_tool(t, "get_tag_performance", {"dimension": "nope", "metric": "ctr", "window": "all"})
    with pytest.raises(ValueError):
        run_tool(t, "__init__", {})
    assert {d["name"] for d in TOOL_DEFS} >= {
        "get_tag_performance",
        "get_signals",
        "get_concepts",
        "get_ad_detail",
        "search_ads",
    }


def test_submit_schema_is_strict_compatible() -> None:
    s = json.dumps(_inline_refs(SUBMIT_TOOL["input_schema"]))
    assert "$ref" not in s and "$defs" not in s and '"additionalProperties": false' in s


def test_matches_rounding() -> None:
    assert matches(2.24, [2.2387]) and matches(0.0178, [0.017812]) and matches(35605, [35605.39])
    assert not matches(2.5, [2.2387])


def _claim_for_top_hook(
    store: MemoryStore, ws_id: str, value_override: float | None = None
) -> dict[str, Any]:
    t = SnapshotTools(snaps(store, ws_id))
    top = run_tool(
        t, "get_tag_performance", {"dimension": "hook_type", "metric": "ctr", "window": "all"}
    )["values"]
    best = max((v for v in top if v["verdict"] != "low_data"), key=lambda v: v["estimate"])
    return {
        "claim": f"{best['value']} hooks lead on CTR.",
        "ad_ids": best["ads"],
        "metrics": [
            {
                "entity": f"tag:hook_type={best['value']}",
                "metric": "ctr",
                "value": value_override if value_override is not None else best["estimate"],
                "window": "all",
            }
        ],
    }


def report_with(claim: dict[str, Any]) -> dict[str, Any]:
    return {
        "summary": "Sample.",
        "working": [claim],
        "double_down": [],
        "cut": [],
        "missing_concepts": [],
    }


def test_validator_catches_wrong_numbers_and_unknown_ads(ws: tuple[MemoryStore, str]) -> None:
    store, ws_id = ws
    refs = {a["external_id"] for a in store.select("ads", "external_id", workspace_id=ws_id)}
    good = StrategistReport.model_validate(report_with(_claim_for_top_hook(store, ws_id)))
    assert validate(good, snaps(store, ws_id), refs).passed
    bad_claim = _claim_for_top_hook(store, ws_id, value_override=0.5)
    bad_claim["ad_ids"].append("ad_that_does_not_exist")
    res = validate(
        StrategistReport.model_validate(report_with(bad_claim)), snaps(store, ws_id), refs
    )
    assert not res.passed and len(res.problems) == 2


class FakeClaude:
    """Scripted model: calls tools, then submits; on a grounding error, resubmits."""

    def __init__(self, script: list[list[dict[str, Any]]]) -> None:
        self.script = script
        self.requests: list[dict[str, Any]] = []

    def __call__(self, **kw: Any) -> Any:
        self.requests.append(
            {**kw, "messages": list(kw["messages"])}
        )  # snapshot; the agent appends later
        blocks = self.script.pop(0)
        content = [
            NS(type="tool_use", id=f"t{i}-{len(self.requests)}", name=b["name"], input=b["input"])
            for i, b in enumerate(blocks)
        ]
        return NS(
            content=content, stop_reason="tool_use", usage=NS(input_tokens=1000, output_tokens=200)
        )


def test_agent_loop_tools_then_grounded_submit(ws: tuple[MemoryStore, str]) -> None:
    store, ws_id = ws
    claim = _claim_for_top_hook(store, ws_id)
    fake = FakeClaude(
        [
            [
                {"name": "get_account_overview", "input": {"window": "30"}},
                {
                    "name": "get_tag_performance",
                    "input": {"dimension": "hook_type", "metric": "ctr", "window": "all"},
                },
            ],
            [{"name": "submit_report", "input": report_with(claim)}],
        ]
    )
    row, run = generate_report(store, ws_id, fake)
    assert run.grounding.passed and run.attempts == 1 and run.turns == 2
    assert row["grounding_passed"] is True and row["kind"] == "strategist"
    assert row["citations"][0]["section"] == "working"
    # tool results go back in one user message after the assistant turn
    second = fake.requests[1]["messages"]
    assert second[-1]["role"] == "user" and len(second[-1]["content"]) == 2
    assert fake.requests[0]["fallbacks"] == "default" and fake.requests[0]["tool_choice"] == {
        "type": "auto"
    }


def test_agent_retries_once_then_saves_ungrounded(ws: tuple[MemoryStore, str]) -> None:
    store, ws_id = ws
    wrong = report_with(_claim_for_top_hook(store, ws_id, value_override=0.9))
    right = report_with(_claim_for_top_hook(store, ws_id))
    fixed = FakeClaude(
        [[{"name": "submit_report", "input": wrong}], [{"name": "submit_report", "input": right}]]
    )
    run = run_strategist(
        fixed,
        snaps(store, ws_id),
        {a["external_id"] for a in store.select("ads", "external_id", workspace_id=ws_id)},
    )
    assert run.grounding.passed and run.attempts == 2
    feedback = fixed.requests[1]["messages"][-1]["content"][0]
    assert feedback["is_error"] and "Grounding check failed" in feedback["content"]

    stubborn = FakeClaude(
        [[{"name": "submit_report", "input": wrong}], [{"name": "submit_report", "input": wrong}]]
    )
    row, run2 = generate_report(store, ws_id, stubborn)
    assert not run2.grounding.passed and row["grounding_passed"] is False and run2.attempts == 2


def test_schema_error_is_returned_to_the_model(ws: tuple[MemoryStore, str]) -> None:
    store, ws_id = ws
    good = report_with(_claim_for_top_hook(store, ws_id))
    fake = FakeClaude(
        [
            [{"name": "submit_report", "input": {"summary": "x"}}],
            [{"name": "submit_report", "input": good}],
        ]
    )
    run = run_strategist(
        fake,
        snaps(store, ws_id),
        {a["external_id"] for a in store.select("ads", "external_id", workspace_id=ws_id)},
    )
    assert run.grounding.passed
    assert "does not match the schema" in fake.requests[1]["messages"][-1]["content"][0]["content"]
