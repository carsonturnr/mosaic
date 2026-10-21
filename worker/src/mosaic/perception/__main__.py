"""Tag local creatives without touching the database. Useful for spot checks.

    uv run python -m mosaic.perception path/to/ad.mp4 [more files...] [--out results.json]

Needs GEMINI_API_KEY. Results are cached by file content, so re-runs are free.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from mosaic.config import Settings
from mosaic.jobs import build_llm
from mosaic.llm import MediaPart
from mosaic.media import probe
from mosaic.perception.pipeline import MIME
from mosaic.perception.scenes import detect_scenes
from mosaic.perception.tagging import Dimension, length_bucket, tag_creative

DEFAULT_TAXONOMY = [
    Dimension(
        "hook_type",
        "Hook type",
        "How the first 3 seconds grab attention",
        [
            "problem/pain",
            "curiosity/question",
            "bold claim",
            "stat/number",
            "demo/visual",
            "testimonial",
            "us-vs-them",
            "pattern interrupt",
            "offer-first",
        ],
        "hook",
    ),
    Dimension(
        "angle",
        "Angle",
        "The core persuasive argument",
        [
            "performance/results",
            "convenience",
            "price/value",
            "quality/ingredients",
            "social proof",
            "identity/lifestyle",
            "problem-solution",
            "comparison",
        ],
        "ad",
    ),
    Dimension("persona", "Persona", "Who the ad speaks to", None, "ad"),
    Dimension(
        "format",
        "Format",
        "Production format",
        [
            "UGC",
            "talking head",
            "product demo",
            "montage/B-roll",
            "static image",
            "carousel",
            "text-on-screen",
            "founder story",
        ],
        "ad",
    ),
    Dimension(
        "offer",
        "Offer",
        "Promotion shown",
        ["none", "% discount", "$ off", "free shipping", "bundle", "free gift", "trial"],
        "ad",
    ),
    Dimension(
        "proof_type",
        "Proof type",
        "Evidence used",
        ["none", "reviews/stars", "testimonial", "before/after", "expert", "data/stat", "press"],
        "ad",
    ),
    Dimension(
        "cta",
        "CTA",
        "Call to action",
        ["shop now", "learn more", "sign up", "get offer", "other"],
        "ad",
    ),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    llm = build_llm(Settings.from_env())
    results = {}
    for f in args.files:
        ext = f.suffix.lstrip(".").lower()
        is_video = MIME.get(ext, "").startswith("video/")
        duration = probe(f).duration_s if is_video else None
        scenes = detect_scenes(f, duration_s=duration) if is_video else []
        creative = {"workspace_id": "local", "type": "video" if is_video else "image"}
        tags = tag_creative(llm, DEFAULT_TAXONOMY, creative, MediaPart(f, MIME[ext]), scenes)
        results[f.name] = {
            "length_bucket": length_bucket(duration, is_video),
            "scenes": [[s.start_s, s.end_s] for s in scenes],
            **tags.model_dump(),
        }
        print(
            f"{f.name}: hook={tags.hook.hook_type.value if tags.hook else '-'} "
            f"angle={tags.angle.value} format={tags.format.value}"
        )
    if args.out:
        args.out.write_text(json.dumps(results, indent=2))
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
