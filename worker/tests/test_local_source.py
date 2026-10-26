import shutil
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from mosaic import jobs
from mosaic.datasources import DataSource
from mosaic.datasources.local import LocalSource
from mosaic.media import MemoryStorage
from mosaic.seed import seed_local
from mosaic.store import MemoryStore
from mosaic.synthetic.generator import HOOK_TYPES

START = date(2026, 7, 29)


def _tag(value: str) -> dict[str, Any]:
    return {"value": value, "confidence": 0.9}


def _result(file: str, hook: str | None) -> dict[str, Any]:
    video = hook is not None
    return {
        "file": file,
        "type": "video" if video else "image",
        "duration_s": 9.0 if video else None,
        "length_bucket": "<=15s" if video else "static",
        "scenes": [
            {
                "idx": i,
                "transcript": f"line {i}",
                "on_screen_text": "",
                "visual_description": "a mug",
                "broll_type": "none",
            }
            for i in range(4 if video else 0)
        ],
        "model": "gemini-3.5-flash-lite",
        "hook": (
            {"hook_type": _tag(hook), "opening_visual": "a mug", "first_line": "Still tired?"}
            if video
            else None
        ),
        "angle": _tag("convenience"),
        "persona": _tag("busy parent"),
        "format": _tag("UGC" if video else "static image"),
        "offer": _tag("none"),
        "proof_type": _tag("testimonial"),
        "cta": _tag("other"),
    }


def _perception(video: str, image: str) -> dict[str, dict[str, Any]]:
    hooks = ["testimonial"] * 4 + ["problem/pain", "curiosity/question", "bold claim"]
    out = {f"10{i:02d}": _result(video, h) for i, h in enumerate(hooks)}
    out |= {f"20{i:02d}": _result(image, None) for i in range(5)}
    out["3000"] = {"file": video, "error": "all models capped"}
    return out


@pytest.fixture
def folder(tmp_path: Path, test_video: Path) -> Path:
    shutil.copy(test_video, tmp_path / "ad.mp4")
    (tmp_path / "ad.png").write_bytes(b"\x89PNG fake")
    return tmp_path


def test_conforms_and_keeps_real_tags(folder: Path) -> None:
    src = LocalSource(folder, _perception("ad.mp4", "ad.png"), start_date=START)
    assert isinstance(src, DataSource)
    ads = src.list_ads()
    assert len(ads) == 12  # the errored entry is skipped
    assert {a.external_id for a in ads} >= {"1000", "2004"}
    s = src.account.ad_by_external_id("1000")
    assert s.tags["hook_type"] == "testimonial" and s.tags["format"] == "UGC"
    assert src.get_creative("cr_2004").type.value == "image"
    assert src.download_media(src.get_creative("cr_1000")).path == folder / "ad.mp4"


def test_plants_patterns_on_the_real_tags(folder: Path) -> None:
    src = LocalSource(folder, _perception("ad.mp4", "ad.png"), start_date=START)
    acc = src.account
    assert acc.winning_hook == "testimonial"  # the only hook on 3+ videos
    key = {p.kind: p for p in acc.answer_key().patterns}
    assert set(key) == {"winning_hook", "fatigue", "hidden_winner", "static_vs_video"}
    special = key["fatigue"].ad_external_ids + key["hidden_winner"].ad_external_ids
    assert all(acc.ad_by_external_id(a).tags["hook_type"] != "testimonial" for a in special)
    ids = [a.external_id for a in src.list_ads()]
    rows = src.get_daily_metrics(ids, START, date(2026, 8, 10))
    again = LocalSource(folder, _perception("ad.mp4", "ad.png"), start_date=START)
    assert rows == again.get_daily_metrics(ids, START, date(2026, 8, 10))


def test_needs_a_hook_on_enough_videos(folder: Path) -> None:
    p = _perception("ad.mp4", "ad.png")
    for i, h in enumerate(HOOK_TYPES[:7]):
        p[f"10{i:02d}"]["hook"]["hook_type"] = _tag(h)
    with pytest.raises(ValueError, match="winner"):
        LocalSource(folder, p, start_date=START)


def test_seed_local_builds_a_private_workspace(folder: Path) -> None:
    store, storage = MemoryStore(), MemoryStorage()
    out = seed_local(
        store,
        storage,
        "u1",
        folder,
        _perception("ad.mp4", "ad.png"),
        name="Dev brand",
        guidelines="Real ads, synthetic numbers.",
    )
    ws = store.select("workspaces", id=out["workspace_id"])[0]
    assert not ws.get("is_demo")
    assert out["uploaded"] == 12 and out["perception_imported"] == 12
    creatives = store.tables["creatives"]
    assert all(c["perception_status"] == "done" and c["thumbnail_path"] for c in creatives)
    video = next(c for c in creatives if c["external_id"] == "cr_1000")
    assert video["thumbnail_path"].endswith("scene_000.jpg")
    assert video["thumbnail_path"] in storage.files
    scenes = [s for s in store.tables["scenes"] if s["creative_id"] == video["id"]]
    assert [s["start_s"] for s in sorted(scenes, key=lambda s: s["idx"])] == [0.0, 2.0, 3.0, 5.0]
    assert all(s["keyframe_path"] in storage.files for s in scenes)
    assert {s["transcript"] for s in scenes} == {"line 0", "line 1", "line 2", "line 3"}
    tags = {
        (t["dimension_key"], t["value"], t["model"])
        for t in store.tables["creative_tags"]
        if t["creative_id"] == video["id"]
    }
    assert ("hook_type", "testimonial", "gemini-3.5-flash-lite") in tags
    assert {r["window_key"] for r in store.tables["analysis_snapshots"]} == {"7", "30", "90", "all"}

    # re-seeding is idempotent
    seed_local(store, storage, "u1", folder, _perception("ad.mp4", "ad.png"), name="Dev brand")
    assert len(store.tables["creatives"]) == 12 and len(store.tables["scenes"]) == 7 * 4
    assert len(store.tables["creative_tags"]) == len(tags) * 7 + 7 * 5

    # scheduled jobs and refresh leave it alone
    assert jobs.for_all_sources(store, jobs_settings(), "structure") == []
    runs = jobs.refresh(store, jobs_settings(), out["workspace_id"])
    assert [r["job"] for r in runs] == ["analyze"]


def jobs_settings() -> Any:
    from mosaic.config import Settings

    return Settings(
        supabase_url="http://x",
        supabase_service_role_key="k",
        meta_app_id=None,
        meta_app_secret=None,
        meta_access_token=None,
        meta_graph_version="v26.0",
        meta_sandbox_ad_account_id=None,
    )
