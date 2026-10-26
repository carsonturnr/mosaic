"""Perception pipeline for one creative: scenes → keyframes → tags → rows.

Statuses: pending → processing → done | failed. Re-running replaces this model's
AI tags and the creative's scenes; user tags are never touched.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from mosaic.llm import LLM, LLMOutputError, MediaPart, QuotaExhausted, TransientError
from mosaic.media import Storage, probe
from mosaic.perception.scenes import SceneSpan, detect_scenes, keyframes_for
from mosaic.perception.tagging import (
    TAGGING_MODEL,
    CreativeTagging,
    length_bucket,
    load_taxonomy,
    tag_creative,
    tag_rows,
)
from mosaic.store import Row, Store

MIME = {
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "webm": "video/webm",
    "jpg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
}


def perceive_creative(
    llm: LLM, store: Store, storage: Storage, creative: Row, *, model: str = TAGGING_MODEL
) -> CreativeTagging | None:
    cid = creative["id"]
    store.update("creatives", {"perception_status": "processing"}, id=cid)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            ext = creative["storage_path"].rsplit(".", 1)[-1].lower()
            local = storage.download(creative["storage_path"], work / f"original.{ext}")
            is_video = creative["type"] == "video"
            duration = creative.get("duration_s") or (probe(local).duration_s if is_video else None)
            scenes = (
                detect_scenes(local, duration_s=float(duration) if duration else None)
                if is_video
                else []
            )
            taxonomy = load_taxonomy(store, creative["workspace_id"])
            media = MediaPart(local, MIME.get(ext, "application/octet-stream"))
            result = tag_creative(llm, taxonomy, creative, media, scenes, model=model)
            save_perception(
                store, storage, creative, local, scenes, result, model, duration, work / "kf"
            )
        return result
    except LLMOutputError:
        store.update("creatives", {"perception_status": "failed"}, id=cid)
        return None
    except QuotaExhausted:
        # A daily cap: leave this and everything after it for a later run.
        store.update("creatives", {"perception_status": "pending"}, id=cid)
        raise
    except TransientError:
        # The model was overloaded or rate-limited even after backoff; try again next run.
        store.update("creatives", {"perception_status": "pending"}, id=cid)
        return None
    except Exception:
        store.update("creatives", {"perception_status": "failed"}, id=cid)
        raise


def save_perception(
    store: Store,
    storage: Storage,
    creative: Row,
    local: Path,
    scenes: list[SceneSpan],
    result: CreativeTagging,
    model: str,
    duration: float | None,
    work: Path,
) -> None:
    """Write scenes (with keyframes), scene notes and AI tags, then mark the creative done.

    Replaces the creative's scenes and this model's AI tags; user tags are never touched.
    A video without a thumbnail gets its first keyframe as the poster.
    """
    cid = creative["id"]
    is_video = creative["type"] == "video"
    notes = {n.idx: n for n in result.scenes}
    scene_ids: dict[int, str] = {}
    store.delete("scenes", creative_id=cid)
    if scenes:
        frames = keyframes_for(local, scenes, work)
        prefix = creative["storage_path"].rsplit("/", 1)[0]
        for s in scenes:
            kf_path = f"{prefix}/scene_{s.idx:03d}.jpg"
            storage.upload(kf_path, frames[s.idx], "image/jpeg")
            note = notes.get(s.idx)
            row = store.insert(
                "scenes",
                {
                    "creative_id": cid,
                    "idx": s.idx,
                    "start_s": s.start_s,
                    "end_s": s.end_s,
                    "keyframe_path": kf_path,
                    "transcript": note.transcript if note else None,
                    "on_screen_text": note.on_screen_text if note else None,
                    "visual_description": note.visual_description if note else None,
                    "broll_type": note.broll_type if note else None,
                },
            )
            scene_ids[s.idx] = row["id"]
    store.delete("creative_tags", creative_id=cid, source="ai", model=model)
    for row in tag_rows(
        cid,
        result,
        scene_ids,
        model,
        length_bucket(float(duration) if duration else None, is_video),
    ):
        store.insert("creative_tags", row)
    values: Row = {"perception_status": "done"}
    if not creative.get("thumbnail_path"):
        if not is_video:
            values["thumbnail_path"] = creative["storage_path"]
        elif scenes:
            values["thumbnail_path"] = f"{creative['storage_path'].rsplit('/', 1)[0]}/scene_000.jpg"
    store.update("creatives", values, id=cid)


def perceive_pending(
    llm: LLM, store: Store, storage: Storage, workspace_id: str, *, limit: int = 50
) -> dict[str, int]:
    rows = store.select("creatives", "*", workspace_id=workspace_id, perception_status="pending")
    counts = {"done": 0, "failed": 0, "deferred": 0}
    for row in rows[:limit]:
        if not row.get("storage_path"):
            continue
        try:
            result = perceive_creative(llm, store, storage, row)
        except QuotaExhausted:
            counts["deferred"] += sum(1 for r in rows[:limit] if r.get("storage_path")) - sum(
                counts.values()
            )
            break
        if result is not None:
            counts["done"] += 1
        else:
            status = store.select("creatives", "perception_status", id=row["id"])[0][
                "perception_status"
            ]
            counts["deferred" if status == "pending" else "failed"] += 1
    return counts
