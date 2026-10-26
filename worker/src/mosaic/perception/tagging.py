"""Vision tagging: one model call per creative returning schema-validated tags.

The output schema is fixed in shape (hook, whole-ad tags, per-scene notes) and the
allowed values come from the workspace taxonomy, enforced after parsing so an
edited taxonomy never needs a code change.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field

from mosaic.llm import LLM, LLMRequest, MediaPart
from mosaic.perception.scenes import SceneSpan
from mosaic.store import Row, Store

# gemini-2.5-flash is closed to new API accounts (Oct 2026); 3.5 Flash is the current stable Flash.
TAGGING_MODEL = "gemini-3.5-flash"


class TagValue(BaseModel):
    value: str
    confidence: float = Field(ge=0, le=1)


class HookTags(BaseModel):
    hook_type: TagValue
    opening_visual: str
    first_line: str


class SceneNotes(BaseModel):
    idx: int
    transcript: str
    on_screen_text: str
    visual_description: str
    broll_type: str


class CreativeTagging(BaseModel):
    hook: HookTags | None = None
    angle: TagValue
    persona: TagValue
    format: TagValue
    offer: TagValue
    proof_type: TagValue
    cta: TagValue
    scenes: list[SceneNotes] = Field(default_factory=list)


@dataclass(frozen=True)
class Dimension:
    key: str
    label: str
    description: str | None
    allowed: list[str] | None
    applies_to: str


def load_taxonomy(store: Store, workspace_id: str) -> list[Dimension]:
    """System defaults overlaid with the workspace's own dimensions."""
    rows = [r for r in store.select("taxonomy_dimensions", "*") if r.get("workspace_id") is None]
    rows += store.select("taxonomy_dimensions", "*", workspace_id=workspace_id)
    by_key: dict[str, Row] = {}
    for r in rows:
        by_key[r["key"]] = r  # workspace rows come last and win
    return [
        Dimension(
            r["key"], r["label"], r.get("description"), r.get("allowed_values"), r["applies_to"]
        )
        for r in by_key.values()
    ]


SYSTEM = (
    "You are a performance-marketing creative analyst. You tag Meta ads precisely and "
    "conservatively. Use only the allowed values given for each field. If unsure, pick the "
    "closest value and lower the confidence. Never invent text that is not in the ad."
)


def build_prompt(
    taxonomy: list[Dimension], creative: Row, scenes: list[SceneSpan], is_video: bool
) -> str:
    lines = ["Tag this ad.", ""]
    if creative.get("primary_text"):
        lines.append(f"Primary text: {creative['primary_text']}")
    if creative.get("headline"):
        lines.append(f"Headline: {creative['headline']}")
    if creative.get("cta_type"):
        lines.append(f"CTA button: {creative['cta_type']}")
    lines += ["", "Fields and allowed values:"]
    for d in taxonomy:
        if d.key == "length_bucket":
            continue  # computed from duration, not asked
        if d.key == "hook_type" and not is_video:
            continue
        allowed = ", ".join(d.allowed) if d.allowed else "free text, short phrase"
        lines.append(f"- {d.key} ({d.description or d.label}): {allowed}")
    if is_video:
        lines += [
            "",
            "The hook is the first 3 seconds. Fill `hook` with hook_type, the opening visual and "
            "the first spoken or on-screen line.",
            "Scenes (fill one `scenes` entry per scene, same idx):",
            *[f"- idx {s.idx}: {s.start_s:.2f}s to {s.end_s:.2f}s" for s in scenes],
        ]
    else:
        lines += ["", "This is a static image ad: leave `hook` null and `scenes` empty."]
    return "\n".join(lines)


def length_bucket(duration_s: float | None, is_video: bool) -> str:
    if not is_video or duration_s is None:
        return "static"
    if duration_s <= 15:
        return "<=15s"
    if duration_s <= 30:
        return "16-30s"
    if duration_s <= 60:
        return "31-60s"
    return ">60s"


def normalize(result: CreativeTagging, taxonomy: list[Dimension]) -> CreativeTagging:
    """Snap values to the taxonomy (case-insensitive); unknown values become 'other'-ish
    fallbacks with confidence capped at 0.3 so analytics can down-weight them."""
    allowed = {d.key: d.allowed for d in taxonomy}

    def snap(key: str, tv: TagValue) -> TagValue:
        options = allowed.get(key)
        if not options:
            return TagValue(value=tv.value.strip().lower(), confidence=tv.confidence)
        lookup = {o.lower(): o for o in options}
        hit = lookup.get(tv.value.strip().lower())
        if hit:
            return TagValue(value=hit, confidence=tv.confidence)
        fallback = lookup.get("other") or lookup.get("none") or options[0]
        return TagValue(value=fallback, confidence=min(tv.confidence, 0.3))

    data: dict[str, Any] = {
        k: snap(k, getattr(result, k))
        for k in ("angle", "persona", "format", "offer", "proof_type", "cta")
    }
    hook = None
    if result.hook:
        hook = result.hook.model_copy(
            update={"hook_type": snap("hook_type", result.hook.hook_type)}
        )
    return CreativeTagging(hook=hook, scenes=result.scenes, **data)


def tag_creative(
    llm: LLM,
    taxonomy: list[Dimension],
    creative: Row,
    media: MediaPart,
    scenes: list[SceneSpan],
    *,
    model: str = TAGGING_MODEL,
) -> CreativeTagging:
    is_video = creative["type"] == "video"
    req = LLMRequest(
        model=model,
        system=SYSTEM,
        prompt=build_prompt(taxonomy, creative, scenes, is_video),
        media=(media,),
    )
    raw = llm.structured(
        "tag_creative", req, CreativeTagging, workspace_id=creative["workspace_id"]
    )
    return normalize(raw, taxonomy)


def tag_rows(
    creative_id: str, result: CreativeTagging, scene_ids: dict[int, str], model: str, length: str
) -> list[Row]:
    """creative_tags rows: whole-ad, hook (scene 0..hook), plus length bucket."""
    rows: list[Row] = []

    def add(key: str, tv: TagValue, scene_id: str | None = None) -> None:
        rows.append(
            {
                "creative_id": creative_id,
                "scene_id": scene_id,
                "dimension_key": key,
                "value": tv.value,
                "confidence": round(tv.confidence, 3),
                "source": "ai",
                "model": model,
            }
        )

    for key in ("angle", "persona", "format", "offer", "proof_type", "cta"):
        add(key, getattr(result, key))
    add("length_bucket", TagValue(value=length, confidence=1.0))
    if result.hook:
        add("hook_type", result.hook.hook_type, scene_ids.get(0))
    return rows
