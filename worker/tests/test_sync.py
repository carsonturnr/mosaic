from datetime import date

from mosaic.datasources.synthetic import SandboxSyntheticSource
from mosaic.seed import seed
from mosaic.store import MemoryStore
from mosaic.sync import run_job, sync_metrics, sync_structure


def test_sync_structure_links_foreign_keys() -> None:
    src = SandboxSyntheticSource(seed=1, n_ads=12)
    store = MemoryStore()
    stats = sync_structure(src, "ws", store)
    assert stats.campaigns == 2 and stats.ad_sets == 3 and stats.ads == 12
    assert stats.creatives == 12 and stats.new_creatives == 12
    camp_ids = {c["id"] for c in store.tables["campaigns"]}
    adset_ids = {s["id"] for s in store.tables["ad_sets"]}
    cr_ids = {c["id"] for c in store.tables["creatives"]}
    assert all(s["campaign_id"] in camp_ids for s in store.tables["ad_sets"])
    assert all(
        a["ad_set_id"] in adset_ids and a["creative_id"] in cr_ids for a in store.tables["ads"]
    )


def test_sync_structure_is_idempotent_and_preserves_later_stage_columns() -> None:
    src = SandboxSyntheticSource(seed=1, n_ads=12)
    store = MemoryStore()
    sync_structure(src, "ws", store)
    store.tables["creatives"][0]["perception_status"] = "done"
    first_ids = sorted(a["id"] for a in store.tables["ads"])
    stats = sync_structure(src, "ws", store)
    assert stats.new_creatives == 0
    assert sorted(a["id"] for a in store.tables["ads"]) == first_ids
    assert store.tables["creatives"][0]["perception_status"] == "done"


def test_sync_metrics_writes_rows_for_window() -> None:
    src = SandboxSyntheticSource(seed=1, n_ads=12)
    store = MemoryStore()
    sync_structure(src, "ws", store)
    stats = sync_metrics(src, "ws", store, date(2026, 8, 1), date(2026, 8, 7))
    rows = store.tables["ad_daily_metrics"]
    assert stats.rows == len(rows) > 0
    assert all("2026-08-01" <= r["date"] <= "2026-08-07" for r in rows)
    ad_ids = {a["id"] for a in store.tables["ads"]}
    assert all(r["ad_id"] in ad_ids for r in rows)
    # re-sync overwrites rather than duplicates
    sync_metrics(src, "ws", store, date(2026, 8, 1), date(2026, 8, 7))
    assert len(store.tables["ad_daily_metrics"]) == len(rows)


def test_run_job_records_success_and_failure() -> None:
    store = MemoryStore()
    store.insert("data_sources", {"id": "ds", "kind": "demo"})
    src = SandboxSyntheticSource(seed=1, n_ads=12)
    run_job(store, "ds", "structure", lambda: sync_structure(src, "ws", store))
    (ok,) = store.tables["sync_runs"]
    assert ok["status"] == "done" and ok["stats"]["ads"] == 12
    assert store.select("data_sources", id="ds")[0]["last_synced_at"]

    def boom() -> None:
        raise RuntimeError("nope")

    try:
        run_job(store, "ds", "structure", boom)  # type: ignore[arg-type]
    except RuntimeError:
        pass
    failed = store.tables["sync_runs"][1]
    assert failed["status"] == "failed" and "nope" in failed["error"]


def test_seed_end_to_end_in_memory() -> None:
    store = MemoryStore()
    result = seed(store, "owner", seed=42, n_ads=12, days=30)
    assert result["structure"]["ads"] == 12
    assert result["metrics"]["rows"] > 0
    tags = store.tables["creative_tags"]
    assert result["tags"] == len(tags) > 0
    assert {t["dimension_key"] for t in tags} >= {"format", "angle", "hook_type"}
    assert all(c["perception_status"] == "done" for c in store.tables["creatives"])
    # running again does not duplicate workspace, data source or tags
    again = seed(store, "owner", seed=42, n_ads=12, days=30)
    assert again["workspace_id"] == result["workspace_id"]
    assert len(store.tables["workspaces"]) == 1 and len(store.tables["data_sources"]) == 1
    assert len(store.tables["creative_tags"]) == len(tags)


def test_seed_demo_is_public_dated_and_has_cards() -> None:
    from datetime import UTC, date, datetime, timedelta

    from mosaic.analytics.run import latest_snapshot
    from mosaic.media import MemoryStorage
    from mosaic.seed import DEMO_DAYS, seed_demo

    store, storage = MemoryStore(), MemoryStorage()
    res = seed_demo(store, storage, "owner")
    ws = store.select("workspaces", id=res["workspace_id"])[0]
    assert ws["is_demo"] is True and ws["name"].startswith("Driftwell")
    assert res["cards"] == 24 and len(storage.files) == 24
    statics = [c for c in store.tables["creatives"] if c["type"] != "video"]
    assert statics and all(c["storage_path"] and c["thumbnail_path"] for c in statics)
    assert all(
        c["headline"] and "Synthetic" not in (c["primary_text"] or "")
        for c in store.tables["creatives"]
    )
    assert date.fromisoformat(res["start"]) == datetime.now(UTC).date() - timedelta(
        days=DEMO_DAYS - 1
    )
    snap = latest_snapshot(store, res["workspace_id"], "all")
    assert snap and snap.fatigue and snap.underfunded  # planted patterns survive the rebrand
    again = seed_demo(store, storage, "owner")
    assert again["workspace_id"] == res["workspace_id"] and len(store.tables["workspaces"]) == 1
