from datetime import date, timedelta
from typing import Any

from mosaic import jobs
from mosaic.datasources import DataSource
from mosaic.datasources.sandbox import MetaSandboxSource
from mosaic.models import Ad, Creative, CreativeType
from mosaic.store import MemoryStore

from .test_jobs_and_api import SETTINGS

START = date(2026, 8, 5)
HOOKS = ["problem/pain"] * 4 + ["stat/number", "curiosity/question", "bold claim"]


class FakeLive:
    """MetaLiveSource stand-in: seven video ads and seven statics."""

    media_dir = None

    def __init__(self) -> None:
        self.ads = [
            Ad(
                external_id=f"ad{i}",
                ad_set_external_id="as1",
                creative_external_id=f"cr{i}",
                name=f"Mosaic {i}",
                status="PAUSED",
            )
            for i in range(14)
        ]

    def list_campaigns(self) -> list[Any]:
        return []

    def list_ad_sets(self) -> list[Any]:
        return []

    def list_ads(self) -> list[Ad]:
        return self.ads

    def get_creative(self, ext: str) -> Creative:
        video = int(ext[2:]) < len(HOOKS)
        return Creative(
            external_id=ext,
            type=CreativeType.VIDEO if video else CreativeType.IMAGE,
            duration_s=14.0 if video else None,
        )

    def download_media(self, creative: Creative) -> Any:
        raise NotImplementedError


def _tags(i: int) -> dict[str, str]:
    video = i < len(HOOKS)
    tags = {
        "angle": "problem-solution",
        "persona": "DTC founder",
        "format": "text-on-screen" if video else "static image",
        "offer": "none",
        "proof_type": "none",
        "cta": "learn more",
        "length_bucket": "<=15s" if video else "static",
    }
    if video:
        tags["hook_type"] = HOOKS[i]
    return tags


def _source(tags: dict[str, dict[str, str]]) -> MetaSandboxSource:
    live = FakeLive()
    creatives = {
        a.creative_external_id: live.get_creative(a.creative_external_id) for a in live.ads
    }
    return MetaSandboxSource(live, tags, creatives, start_date=START, days=90)  # type: ignore[arg-type]


def test_conforms_and_has_no_results_before_tagging() -> None:
    src = _source({})
    assert isinstance(src, DataSource)
    assert src.get_daily_metrics(["ad0"], START, START + timedelta(days=89)) == []


def test_results_are_planted_on_the_ai_tags() -> None:
    src = _source({f"cr{i}": _tags(i) for i in range(14)})
    account = src.account()
    assert account is not None and account.winning_hook == "problem/pain"
    rows = src.get_daily_metrics([f"ad{i}" for i in range(14)], START, START + timedelta(days=89))
    assert {r.ad_external_id for r in rows} <= {f"ad{i}" for i in range(14)}
    assert sum(r.spend for r in rows) > 0
    # deterministic: the same tags give the same numbers
    again = _source({f"cr{i}": _tags(i) for i in range(14)}).get_daily_metrics(
        ["ad0"], START, START + timedelta(days=89)
    )
    assert again == [r for r in rows if r.ad_external_id == "ad0"]


def test_untagged_ads_get_no_results_yet() -> None:
    tags = {f"cr{i}": _tags(i) for i in range(14)}
    tags.pop("cr13")
    rows = _source(tags).get_daily_metrics(["ad13"], START, START + timedelta(days=89))
    assert rows == []


def test_ai_tags_reads_the_workspace_tags() -> None:
    store = MemoryStore()
    cr = store.insert("creatives", {"workspace_id": "w1", "external_id": "cr1", "type": "video"})
    store.insert("creatives", {"workspace_id": "w2", "external_id": "cr2", "type": "video"})
    for k, v in (("angle", "convenience"), ("hook_type", "stat/number")):
        store.insert(
            "creative_tags",
            {"creative_id": cr["id"], "dimension_key": k, "value": v, "source": "ai"},
        )
    store.insert(
        "creative_tags",
        {"creative_id": cr["id"], "dimension_key": "angle", "value": "x", "source": "user"},
    )
    assert jobs.ai_tags(store, "w1") == {
        "cr1": {"angle": "convenience", "hook_type": "stat/number"}
    }


def test_meta_sandbox_sources_have_media_and_need_the_system_token() -> None:
    ds = {"id": "d1", "workspace_id": "w1", "kind": "meta_sandbox", "meta_ad_account_id": "act_1"}
    assert jobs.has_real_media(ds) and jobs.is_synced(ds)
    try:
        jobs.build_source(ds, SETTINGS, MemoryStore())
    except RuntimeError as exc:
        assert "META_ACCESS_TOKEN" in str(exc)
    else:
        raise AssertionError("expected a missing-token error")


def test_no_results_until_enough_ads_are_tagged() -> None:
    src = _source({f"cr{i}": _tags(i) for i in range(8)})
    assert src.account() is None
    assert src.get_daily_metrics(["ad0"], START, START + timedelta(days=89)) == []
