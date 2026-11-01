"""Embeddings per creative for concept clustering and "looks like" search.

- script: headline + primary text + transcripts, as text.
- visual: the image itself for statics; for videos, the mean of up to MAX_FRAMES
  scene keyframes spread across the ad.

Each kind re-embeds only creatives whose input changed since the last run.
"""

from __future__ import annotations

import hashlib
import json
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Protocol

import numpy as np
from pydantic import BaseModel

from mosaic.media import Storage
from mosaic.store import Row, Store

KIND = "script"
VISUAL = "visual"
MAX_FRAMES = 8


class Embedder(Protocol):
    model: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class ImageEmbedder(Protocol):
    model: str

    def embed_images(self, files: list[Path]) -> list[list[float]]: ...


def script_text(creative: Row, transcripts: list[str]) -> str:
    parts = [creative.get("headline") or "", creative.get("primary_text") or "", *transcripts]
    return "\n".join(p.strip() for p in parts if p and p.strip())


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def load_scripts(store: Store, workspace_id: str) -> dict[str, str]:
    creatives = store.select("creatives", "id,headline,primary_text", workspace_id=workspace_id)
    ids = [c["id"] for c in creatives]
    scenes = store.select("scenes", "creative_id,idx,transcript", creative_id=ids) if ids else []
    by_creative: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for s in scenes:
        if s.get("transcript"):
            by_creative[s["creative_id"]].append((s["idx"], s["transcript"]))
    return {
        c["id"]: script_text(c, [t for _, t in sorted(by_creative[c["id"]])]) for c in creatives
    }


class EmbedStats(BaseModel):
    creatives: int
    embedded: int
    skipped_unchanged: int
    skipped_empty: int


def _replace(store: Store, cid: str, kind: str, model: str, vec: list[float], h: str) -> None:
    store.delete("creative_embeddings", creative_id=cid, kind=kind, model=model)
    store.insert(
        "creative_embeddings",
        {
            "creative_id": cid,
            "kind": kind,
            "model": model,
            "embedding": json.dumps(vec),
            "content_hash": h,
        },
    )


def _existing_hashes(store: Store, ids: list[str], kind: str, model: str) -> dict[str, str | None]:
    if not ids:
        return {}
    rows = store.select(
        "creative_embeddings", "creative_id,content_hash", creative_id=ids, kind=kind, model=model
    )
    return {r["creative_id"]: r.get("content_hash") for r in rows}


def embed_scripts(store: Store, embedder: Embedder, workspace_id: str) -> EmbedStats:
    scripts = load_scripts(store, workspace_id)
    existing = _existing_hashes(store, list(scripts), KIND, embedder.model)
    todo = [(cid, t) for cid, t in scripts.items() if t and existing.get(cid) != text_hash(t)]
    empty = sum(1 for t in scripts.values() if not t)
    if todo:
        vectors = embedder.embed([t for _, t in todo])
        for (cid, text), vec in zip(todo, vectors, strict=True):
            _replace(store, cid, KIND, embedder.model, vec, text_hash(text))
    return EmbedStats(
        creatives=len(scripts),
        embedded=len(todo),
        skipped_unchanged=len(scripts) - len(todo) - empty,
        skipped_empty=empty,
    )


def visual_frames(store: Store, workspace_id: str) -> dict[str, list[str]]:
    """Storage paths to embed per creative: the image for statics, spread keyframes for videos."""
    creatives = store.select(
        "creatives",
        "id,type,storage_path",
        workspace_id=workspace_id,
        perception_status="done",
    )
    videos = [c["id"] for c in creatives if c["type"] == "video"]
    scenes = (
        store.select("scenes", "creative_id,idx,keyframe_path", creative_id=videos)
        if videos
        else []
    )
    keyframes: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for sc in scenes:
        if sc.get("keyframe_path"):
            keyframes[sc["creative_id"]].append((sc["idx"], sc["keyframe_path"]))
    out: dict[str, list[str]] = {}
    for c in creatives:
        if c["type"] == "video":
            frames = [p for _, p in sorted(keyframes[c["id"]])]
            if len(frames) > MAX_FRAMES:
                step = len(frames) / MAX_FRAMES
                frames = [frames[int(i * step)] for i in range(MAX_FRAMES)]
        else:
            frames = [c["storage_path"]] if c.get("storage_path") else []
        if frames:
            out[c["id"]] = frames
    return out


def embed_visuals(
    store: Store, storage: Storage, embedder: ImageEmbedder, workspace_id: str
) -> EmbedStats:
    """Keyframe paths are stable per creative and rewritten when it is re-perceived, so the
    hash covers the paths plus the creative's content hash."""
    frames = visual_frames(store, workspace_id)
    hashes = {
        c["id"]: c.get("content_hash") or ""
        for c in store.select("creatives", "id,content_hash", workspace_id=workspace_id)
    }
    key = {cid: text_hash(hashes.get(cid, "") + "\n" + "\n".join(p)) for cid, p in frames.items()}
    existing = _existing_hashes(store, list(frames), VISUAL, embedder.model)
    todo = [cid for cid in frames if existing.get(cid) != key[cid]]
    for cid in todo:
        with tempfile.TemporaryDirectory() as tmp:
            files = [
                storage.download(p, Path(tmp) / f"{i}{Path(p).suffix or '.jpg'}")
                for i, p in enumerate(frames[cid])
            ]
            vectors = np.asarray(embedder.embed_images(files))
        mean = vectors.mean(axis=0)
        mean = mean / (np.linalg.norm(mean) or 1.0)
        _replace(store, cid, VISUAL, embedder.model, [float(x) for x in mean], key[cid])
    n = len(store.select("creatives", "id", workspace_id=workspace_id))
    return EmbedStats(
        creatives=n,
        embedded=len(todo),
        skipped_unchanged=len(frames) - len(todo),
        skipped_empty=n - len(frames),
    )


def load_embeddings(
    store: Store, creative_ids: list[str], kind: str = KIND
) -> dict[str, list[float]]:
    if not creative_ids:
        return {}
    rows = store.select(
        "creative_embeddings", "creative_id,embedding,model", creative_id=creative_ids, kind=kind
    )
    out = {}
    for r in rows:
        v = r["embedding"]
        out[r["creative_id"]] = json.loads(v) if isinstance(v, str) else list(v)
    return out
