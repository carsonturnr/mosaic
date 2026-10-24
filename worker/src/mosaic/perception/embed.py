"""Script embeddings per creative (headline + primary text + transcripts).

Embeds only creatives whose script text changed since the last run.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from typing import Protocol

from pydantic import BaseModel

from mosaic.store import Row, Store

KIND = "script"


class Embedder(Protocol):
    model: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


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


def embed_scripts(store: Store, embedder: Embedder, workspace_id: str) -> EmbedStats:
    scripts = load_scripts(store, workspace_id)
    existing = {
        r["creative_id"]: r.get("content_hash")
        for r in (
            store.select(
                "creative_embeddings",
                "creative_id,content_hash",
                creative_id=list(scripts),
                kind=KIND,
                model=embedder.model,
            )
            if scripts
            else []
        )
    }
    todo = [(cid, t) for cid, t in scripts.items() if t and existing.get(cid) != text_hash(t)]
    empty = sum(1 for t in scripts.values() if not t)
    if todo:
        vectors = embedder.embed([t for _, t in todo])
        for (cid, text), vec in zip(todo, vectors, strict=True):
            store.delete("creative_embeddings", creative_id=cid, kind=KIND, model=embedder.model)
            store.insert(
                "creative_embeddings",
                {
                    "creative_id": cid,
                    "kind": KIND,
                    "model": embedder.model,
                    "embedding": json.dumps(vec),
                    "content_hash": text_hash(text),
                },
            )
    return EmbedStats(
        creatives=len(scripts),
        embedded=len(todo),
        skipped_unchanged=len(scripts) - len(todo) - empty,
        skipped_empty=empty,
    )


def load_embeddings(store: Store, creative_ids: list[str]) -> dict[str, list[float]]:
    if not creative_ids:
        return {}
    rows = store.select(
        "creative_embeddings", "creative_id,embedding,model", creative_id=creative_ids, kind=KIND
    )
    out = {}
    for r in rows:
        v = r["embedding"]
        out[r["creative_id"]] = json.loads(v) if isinstance(v, str) else list(v)
    return out
