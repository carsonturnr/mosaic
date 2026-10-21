from pathlib import Path

from mosaic.datasources.synthetic import SandboxSyntheticSource
from mosaic.media import MemoryStorage, ingest_creative, ingest_pending, probe
from mosaic.perception.scenes import detect_scenes, keyframes_for, split_with_hook
from mosaic.store import MemoryStore
from mosaic.sync import sync_structure


def test_split_with_hook_forces_3s_boundary_and_min_length() -> None:
    spans = split_with_hook([2.0, 5.0, 5.2, 8.9], 9.0)
    assert [(s.start_s, s.end_s) for s in spans] == [(0.0, 2.0), (2.0, 3.0), (3.0, 5.0), (5.0, 9.0)]
    assert [s.idx for s in spans] == [0, 1, 2, 3]


def test_split_with_hook_skips_boundary_near_existing_cut() -> None:
    spans = split_with_hook([3.2], 10.0)
    assert [(s.start_s, s.end_s) for s in spans] == [(0.0, 3.2), (3.2, 10.0)]
    assert split_with_hook([], 2.0) == [type(spans[0])(0, 0.0, 2.0)]
    assert split_with_hook([], 0) == []


def test_detect_scenes_on_generated_video(test_video: Path, tmp_path: Path) -> None:
    info = probe(test_video)
    assert info.duration_s and 8.9 <= info.duration_s <= 9.1 and info.width == 320
    scenes = detect_scenes(test_video, duration_s=info.duration_s)
    starts = [round(s.start_s, 1) for s in scenes]
    assert starts == [0.0, 2.0, 3.0, 5.0], scenes
    assert abs(scenes[-1].end_s - 9.0) < 0.1
    frames = keyframes_for(test_video, scenes, tmp_path / "kf")
    assert sorted(frames) == [0, 1, 2, 3]
    assert all(p.exists() and p.stat().st_size > 500 for p in frames.values())


def test_ingest_uploads_once_and_skips_unchanged(tmp_path: Path) -> None:
    src = SandboxSyntheticSource(seed=1, n_ads=12, media_dir=tmp_path / "dl")
    store, storage = MemoryStore(), MemoryStorage()
    sync_structure(src, "ws", store)
    results = ingest_pending(src, store, storage, "ws", tmp_path / "work")
    assert len(results) == 12 and all(r.changed for r in results)
    assert len(storage.files) == 12
    row = store.select("creatives", id=results[0].creative_id)[0]
    assert row["storage_path"].startswith("ws/") and row["content_hash"] == results[0].content_hash
    assert row["perception_status"] == "pending"
    # second pass: nothing new to ingest; direct re-ingest sees unchanged hash
    assert ingest_pending(src, store, storage, "ws", tmp_path / "work") == []
    store.update("creatives", {"perception_status": "done"}, id=row["id"])
    again = ingest_creative(
        src, store, storage, store.select("creatives", id=row["id"])[0], tmp_path
    )
    assert not again.changed
    assert store.select("creatives", id=row["id"])[0]["perception_status"] == "done"
