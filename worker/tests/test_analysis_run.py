from mosaic.analytics.compute import Snapshot
from mosaic.analytics.run import analyze_workspace, latest_snapshot, pick_tags
from mosaic.seed import seed
from mosaic.store import MemoryStore


def test_pick_tags_prefers_user_then_confidence() -> None:
    rows = [
        {
            "creative_id": "c",
            "dimension_key": "angle",
            "value": "ai-low",
            "confidence": 0.4,
            "source": "ai",
        },
        {
            "creative_id": "c",
            "dimension_key": "angle",
            "value": "ai-high",
            "confidence": 0.9,
            "source": "ai",
        },
        {
            "creative_id": "c",
            "dimension_key": "format",
            "value": "UGC",
            "confidence": 0.9,
            "source": "ai",
        },
        {
            "creative_id": "c",
            "dimension_key": "format",
            "value": "mine",
            "confidence": None,
            "source": "user",
        },
    ]
    assert pick_tags(rows)["c"] == {"angle": "ai-high", "format": "mine"}


def test_seeded_workspace_analysis_round_trips() -> None:
    store = MemoryStore()
    result = seed(store, "owner", seed=42, n_ads=24, days=90)
    assert result["analysis"]["windows"]["all"] != "no data"
    snap = latest_snapshot(store, result["workspace_id"], "all")
    assert isinstance(snap, Snapshot)
    assert len(snap.ads) == 24
    assert snap.tags["hook_type"][0].value  # ranked
    # the planted fatigue ads are found through the store path too
    ext = {a.ad_id: a.external_id for a in snap.ads}
    assert {ext[f.ad_id] for f in snap.fatigue} == {"syn_ad_000", "syn_ad_001"}
    # re-running replaces the four snapshots instead of adding more
    analyze_workspace(store, result["workspace_id"])
    assert len(store.tables["analysis_snapshots"]) == 4


def test_empty_workspace() -> None:
    store = MemoryStore()
    assert analyze_workspace(store, "nobody").windows["30"] == "no data"
