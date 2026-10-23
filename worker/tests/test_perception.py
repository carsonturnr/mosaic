import json
import shutil
from pathlib import Path

import pytest

from mosaic.llm import LLM, LLMRequest, LLMResponse
from mosaic.media import MemoryStorage
from mosaic.perception.pipeline import perceive_creative, perceive_pending
from mosaic.perception.tagging import CreativeTagging, Dimension, TagValue, normalize
from mosaic.store import MemoryStore

TAXONOMY_ROWS = [
    {
        "workspace_id": None,
        "key": "hook_type",
        "label": "Hook",
        "applies_to": "hook",
        "allowed_values": ["problem/pain", "curiosity/question", "testimonial"],
    },
    {
        "workspace_id": None,
        "key": "angle",
        "label": "Angle",
        "applies_to": "ad",
        "allowed_values": ["convenience", "social proof"],
    },
    {
        "workspace_id": None,
        "key": "persona",
        "label": "Persona",
        "applies_to": "ad",
        "allowed_values": None,
    },
    {
        "workspace_id": None,
        "key": "format",
        "label": "Format",
        "applies_to": "ad",
        "allowed_values": ["UGC", "static image"],
    },
    {
        "workspace_id": None,
        "key": "offer",
        "label": "Offer",
        "applies_to": "ad",
        "allowed_values": ["none", "% discount"],
    },
    {
        "workspace_id": None,
        "key": "proof_type",
        "label": "Proof",
        "applies_to": "ad",
        "allowed_values": ["none", "testimonial"],
    },
    {
        "workspace_id": None,
        "key": "cta",
        "label": "CTA",
        "applies_to": "ad",
        "allowed_values": ["shop now", "other"],
    },
    {
        "workspace_id": None,
        "key": "length_bucket",
        "label": "Length",
        "applies_to": "ad",
        "allowed_values": ["<=15s", "16-30s", "static"],
    },
]


def _answer(scene_count: int) -> str:
    return json.dumps(
        {
            "hook": {
                "hook_type": {"value": "Problem/Pain", "confidence": 0.9},
                "opening_visual": "red frame",
                "first_line": "Tired of X?",
            },
            "angle": {"value": "convenience", "confidence": 0.8},
            "persona": {"value": "Busy Mom", "confidence": 0.6},
            "format": {"value": "ugc", "confidence": 0.7},
            "offer": {"value": "bogo", "confidence": 0.9},
            "proof_type": {"value": "none", "confidence": 0.9},
            "cta": {"value": "shop now", "confidence": 0.95},
            "scenes": [
                {
                    "idx": i,
                    "transcript": f"t{i}",
                    "on_screen_text": "",
                    "visual_description": f"v{i}",
                    "broll_type": "product",
                }
                for i in range(scene_count)
            ],
        }
    )


class Fake:
    def __init__(self, scenes: int) -> None:
        self.scenes = scenes
        self.prompts: list[str] = []

    def generate(self, req: LLMRequest) -> LLMResponse:
        self.prompts.append(req.prompt)
        return LLMResponse(text=_answer(self.scenes))


def test_normalize_snaps_to_taxonomy() -> None:
    tax = [
        Dimension(r["key"], r["label"], None, r["allowed_values"], r["applies_to"])
        for r in TAXONOMY_ROWS
    ]
    raw = CreativeTagging.model_validate_json(_answer(0))
    out = normalize(raw, tax)
    assert out.hook and out.hook.hook_type.value == "problem/pain"
    assert out.format.value == "UGC" and out.persona.value == "busy mom"
    assert out.offer == TagValue(value="none", confidence=0.3)  # unknown → fallback, low confidence


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_perceive_video_end_to_end(test_video: Path) -> None:
    store, storage = MemoryStore(), MemoryStorage()
    for r in TAXONOMY_ROWS:
        store.insert("taxonomy_dimensions", r)
    path = "ws/c1/original.mp4"
    storage.upload(path, test_video, "video/mp4")
    store.insert(
        "creatives",
        {
            "id": "c1",
            "workspace_id": "ws",
            "type": "video",
            "storage_path": path,
            "duration_s": 9.0,
            "perception_status": "pending",
            "primary_text": "Try it",
            "headline": "H",
        },
    )
    store.insert(
        "creative_tags",
        {
            "creative_id": "c1",
            "dimension_key": "angle",
            "value": "mine",
            "source": "user",
            "model": None,
        },
    )
    fake = Fake(scenes=4)
    counts = perceive_pending(LLM(fake), store, storage, "ws")
    assert counts == {"done": 1, "failed": 0}

    scenes = sorted(store.tables["scenes"], key=lambda s: s["idx"])
    assert [round(s["start_s"], 1) for s in scenes] == [0.0, 2.0, 3.0, 5.0]
    assert all(s["keyframe_path"] in storage.files for s in scenes)
    assert scenes[1]["transcript"] == "t1"
    assert "idx 1: 2.00s to 3.00s" in fake.prompts[0] and "Primary text: Try it" in fake.prompts[0]

    tags = {
        (t["dimension_key"], t["value"])
        for t in store.tables["creative_tags"]
        if t["source"] == "ai"
    }
    assert ("hook_type", "problem/pain") in tags and ("length_bucket", "<=15s") in tags
    hook = next(t for t in store.tables["creative_tags"] if t["dimension_key"] == "hook_type")
    assert hook["scene_id"] == scenes[0]["id"]
    assert any(t["source"] == "user" for t in store.tables["creative_tags"])
    assert store.select("creatives", id="c1")[0]["perception_status"] == "done"

    # re-run replaces AI tags and scenes instead of duplicating
    perceive_creative(LLM(fake), store, storage, store.select("creatives", id="c1")[0])
    assert len(store.tables["scenes"]) == 4
    assert sum(t["source"] == "ai" for t in store.tables["creative_tags"]) == len(tags)


def test_perceive_static_and_failure(tmp_path: Path) -> None:
    store, storage = MemoryStore(), MemoryStorage()
    for r in TAXONOMY_ROWS:
        store.insert("taxonomy_dimensions", r)
    img = tmp_path / "a.png"
    img.write_bytes(b"\x89PNG fake")
    storage.upload("ws/c2/original.png", img, "image/png")
    store.insert(
        "creatives",
        {
            "id": "c2",
            "workspace_id": "ws",
            "type": "image",
            "storage_path": "ws/c2/original.png",
            "perception_status": "pending",
        },
    )
    fake = Fake(scenes=0)
    perceive_creative(LLM(fake), store, storage, store.select("creatives", id="c2")[0])
    assert "static image ad" in fake.prompts[0] and "hook_type" not in fake.prompts[0]
    assert ("length_bucket", "static") in {
        (t["dimension_key"], t["value"]) for t in store.tables["creative_tags"]
    }

    class Bad:
        def generate(self, req: LLMRequest) -> LLMResponse:
            return LLMResponse(text="not json")

    store.update("creatives", {"perception_status": "pending"}, id="c2")
    assert (
        perceive_creative(LLM(Bad()), store, storage, store.select("creatives", id="c2")[0]) is None
    )
    assert store.select("creatives", id="c2")[0]["perception_status"] == "failed"


def test_workspace_taxonomy_overrides_defaults_and_adds_custom() -> None:
    from mosaic.perception.tagging import build_prompt, load_taxonomy

    store = MemoryStore()
    for r in TAXONOMY_ROWS:
        store.insert("taxonomy_dimensions", r)
    store.insert(
        "taxonomy_dimensions",
        {
            "workspace_id": "ws",
            "key": "offer",
            "label": "Offer",
            "applies_to": "ad",
            "allowed_values": ["none", "BOGO"],
        },
    )
    store.insert(
        "taxonomy_dimensions",
        {
            "workspace_id": "ws",
            "key": "creator",
            "label": "Creator",
            "description": "Who appears on camera",
            "applies_to": "ad",
            "allowed_values": None,
        },
    )
    store.insert(
        "taxonomy_dimensions",
        {
            "workspace_id": "other",
            "key": "offer",
            "label": "Offer",
            "applies_to": "ad",
            "allowed_values": ["leak"],
        },
    )
    tax = {d.key: d for d in load_taxonomy(store, "ws")}
    assert tax["offer"].allowed == ["none", "BOGO"]
    assert tax["creator"].allowed is None
    assert tax["angle"].allowed == ["convenience", "social proof"]
    prompt = build_prompt(list(tax.values()), {"primary_text": "x"}, [], is_video=False)
    assert "- offer (Offer): none, BOGO" in prompt and "leak" not in prompt
    assert "- creator (Who appears on camera): free text, short phrase" in prompt
