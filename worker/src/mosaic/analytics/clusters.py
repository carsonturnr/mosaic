"""Concept clustering and diversity (docs/ARCHITECTURE.md §9).

Two creatives are the same concept when they share their key tags and their content
matches. Distance = half tag distance, half content distance, where content is the mean
of whichever of script and visual distance both creatives have (a static with no copy is
compared on its image alone). Average-linkage agglomerative clustering cut at a
threshold. Diversity is the spend-weighted effective number of concepts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
from pydantic import BaseModel
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform

from mosaic.analytics.stats import effective_number

KEY_TAGS = ("format", "hook_type", "angle", "offer", "proof_type")
THRESHOLD = 0.2
# Cosine distances between unrelated ad scripts sit around 0.3 for this embedding
# model; scale so that "unrelated" is ~1 and paraphrases are near 0.
TEXT_SCALE = 0.3
# Same idea for the mean keyframe image embeddings (gemini-embedding-2). On a real
# 40-ad account the pairwise distances had a median of 0.18 and near-duplicates sat
# under 0.04, about the same spread as the script embeddings.
VISUAL_SCALE = 0.3


@dataclass(frozen=True)
class CreativeInput:
    creative_id: str
    tags: dict[str, str]
    text: str
    spend: float
    embedding: list[float] | None = None
    visual: list[float] | None = None


class Concept(BaseModel):
    label: str
    creative_ids: list[str]
    spend: float
    spend_share: float


class Concepts(BaseModel):
    clusters: list[Concept]
    n_creatives: int
    diversity: float  # effective number of concepts, spend-weighted


def tag_distance(a: dict[str, str], b: dict[str, str]) -> float:
    keys = [k for k in KEY_TAGS if k in a or k in b]
    if not keys:
        return 1.0
    return sum(a.get(k) != b.get(k) for k in keys) / len(keys)


_WORD = re.compile(r"[a-z0-9']+")


def jaccard_distance(x: str, y: str) -> float:
    a, b = set(_WORD.findall(x.lower())), set(_WORD.findall(y.lower()))
    if not a and not b:
        return 1.0
    return 1 - len(a & b) / len(a | b)


def _scaled_cosine(x: list[float], y: list[float], scale: float) -> float:
    u, v = np.asarray(x), np.asarray(y)
    cos = float(u @ v / (np.linalg.norm(u) * np.linalg.norm(v) or 1))
    return min(1.0, max(0.0, (1 - cos) / scale))


def text_distance(a: CreativeInput, b: CreativeInput) -> float:
    if a.embedding is not None and b.embedding is not None:
        return _scaled_cosine(a.embedding, b.embedding, TEXT_SCALE)
    return jaccard_distance(a.text, b.text)  # fallback when embeddings are missing


def content_distance(a: CreativeInput, b: CreativeInput) -> float:
    """Mean of the script and visual distances both creatives have; 1 with neither."""
    parts = []
    has_text = (a.embedding is not None and b.embedding is not None) or (a.text and b.text)
    if has_text or a.visual is None or b.visual is None:
        parts.append(text_distance(a, b))
    if a.visual is not None and b.visual is not None:
        parts.append(_scaled_cosine(a.visual, b.visual, VISUAL_SCALE))
    return sum(parts) / len(parts)


def distance_matrix(items: list[CreativeInput]) -> np.ndarray:
    n = len(items)
    d = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            d[i, j] = d[j, i] = 0.5 * tag_distance(
                items[i].tags, items[j].tags
            ) + 0.5 * content_distance(items[i], items[j])
    return d


def cluster(items: list[CreativeInput], threshold: float = THRESHOLD) -> Concepts:
    if not items:
        return Concepts(clusters=[], n_creatives=0, diversity=0.0)
    if len(items) == 1:
        labels = np.array([1])
    else:
        z = linkage(squareform(distance_matrix(items), checks=False), method="average")
        labels = fcluster(z, t=threshold, criterion="distance")
    total = sum(i.spend for i in items) or 1.0
    groups: dict[int, list[CreativeInput]] = {}
    for item, lab in zip(items, labels, strict=True):
        groups.setdefault(int(lab), []).append(item)
    concepts = []
    for members in groups.values():
        spend = sum(m.spend for m in members)
        concepts.append(
            Concept(
                label=concept_label(members),
                creative_ids=sorted(m.creative_id for m in members),
                spend=round(spend, 2),
                spend_share=round(spend / total, 6),
            )
        )
    concepts.sort(key=lambda c: -c.spend)
    return Concepts(
        clusters=concepts,
        n_creatives=len(items),
        diversity=round(effective_number([c.spend for c in concepts]), 3),
    )


def concept_label(members: list[CreativeInput]) -> str:
    """Most common format · hook · angle among the members."""
    parts = []
    for k in ("format", "hook_type", "angle"):
        values = [m.tags[k] for m in members if k in m.tags]
        if values:
            parts.append(max(set(values), key=values.count))
    return " · ".join(parts) or "untagged"
