"""DemoSource: a fictional brand on top of the synthetic account (docs/ARCHITECTURE.md §6).

"Driftwell" is invented for the demo: an electrolyte drink mix. Copy is written from
each ad's ground-truth tags so the library reads like a real account, and creatives
get simple branded cards so the wall has visuals. The planted patterns are the same
as SandboxSyntheticSource, so the analysis has real answers to find.
"""

from __future__ import annotations

import hashlib
import io
import textwrap
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from mosaic.datasources.synthetic import SandboxSyntheticSource
from mosaic.models import Creative, CreativeType, MediaFile

BRAND = "Driftwell"

HOOK_LINES = {
    "problem/pain": "Still crashing at 3 p.m.?",
    "curiosity/question": "Why are you still tired after 8 hours of sleep?",
    "bold claim": "The last hydration mix you'll ever need.",
    "stat/number": "75% of adults are mildly dehydrated by noon.",
    "demo/visual": "Watch it dissolve in 4 seconds.",
    "testimonial": "“I stopped needing a second coffee.”",
    "us-vs-them": "Sports drinks have 34g of sugar. This has zero.",
    "pattern interrupt": "Stop. Put the energy drink down.",
    "offer-first": "Your first box is 30% off this week.",
}
ANGLE_LINES = {
    "performance/results": "Steady energy that lasts through your afternoon, without the jitters.",
    "convenience": "One stick, one bottle of water, done in seconds wherever you are.",
    "price/value": "Less than a dollar a serving, delivered every month.",
    "quality/ingredients": "Real electrolytes, no sugar, nothing artificial.",
    "social proof": "Join 40,000 people who switched their afternoon slump for something better.",
    "identity/lifestyle": "For people who'd rather feel good than just get through the day.",
    "problem-solution": "Most afternoon fatigue is dehydration. Fix the cause, not the symptom.",
    "comparison": "Half the sodium of the big brands, none of the sugar.",
}
OFFER_LINES = {
    "% discount": "30% off your first box.",
    "$ off": "$10 off your first order.",
    "free shipping": "Free shipping on every order.",
    "bundle": "Bundle 3 flavors and save.",
    "free gift": "Free bottle with your first box.",
    "trial": "Try it for 14 days.",
}
HEADLINES = {
    "UGC": "Real people, real afternoons",
    "talking head": "Why I switched",
    "product demo": "See it work",
    "montage/B-roll": "Hydration that keeps up",
    "founder story": "Why we made Driftwell",
    "static image": "Zero sugar. Real electrolytes.",
    "text-on-screen": "Your 3 p.m. fix",
}
# Card palette: shades of one brand color, plus the ink on top.
SHADES = ["#2c2552", "#4a3fa0", "#6f62d6", "#9085e9", "#3a3266"]


def write_copy(tags: dict[str, str]) -> tuple[str, str]:
    """(headline, primary text) for an ad's tags."""
    hook = HOOK_LINES.get(tags.get("hook_type", ""), "Hydration that keeps up with you.")
    body = ANGLE_LINES.get(tags.get("angle", ""), "")
    offer = OFFER_LINES.get(tags.get("offer", ""), "")
    headline = HEADLINES.get(tags.get("format", ""), f"Meet {BRAND}")
    return headline, " ".join(p for p in (hook, body, offer) if p)


def render_card(headline: str, line: str, shade: str, size: tuple[int, int]) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    w, h = size
    img = Image.new("RGB", size, shade)
    d = ImageDraw.Draw(img)
    big = ImageFont.load_default(size=int(w * 0.075))
    mid = ImageFont.load_default(size=int(w * 0.04))
    small = ImageFont.load_default(size=int(w * 0.035))
    d.rounded_rectangle(
        [w * 0.06, h * 0.06, w * 0.06 + w * 0.06, h * 0.06 + w * 0.06], radius=8, fill="#dcd7ff"
    )
    d.text((w * 0.15, h * 0.06), BRAND.upper(), font=small, fill="#dcd7ff")
    y = h * 0.42
    for row in textwrap.wrap(line, width=22)[:4]:
        d.text((w * 0.08, y), row, font=big, fill="#ffffff")
        y += w * 0.09
    d.text((w * 0.08, h * 0.88), headline, font=mid, fill="#b3a8ff")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# What each format looks like on screen, so a demo video's scenes read like a real edit.
FORMAT_SHOTS = {
    "UGC": (
        "Creator talks to a handheld phone in her kitchen",
        "Pours a stick into a water bottle and shakes it",
    ),
    "talking head": (
        "Presenter speaks straight to camera, plain backdrop",
        "Cut to a close-up as she makes the point",
    ),
    "product demo": (
        "Stick pack tears open over a glass of water",
        "Powder dissolves; the drink turns clear pink",
    ),
    "montage/B-roll": (
        "Quick cuts: desk at 3 p.m., a run, a commute",
        "Bottle in a gym bag, then on a desk",
    ),
    "founder story": (
        "Founder in the test kitchen, sleeves rolled up",
        "Early prototype jars on a shelf",
    ),
    "text-on-screen": (
        "Bold captions over a slow pan of the product",
        "Caption cards over the drink being poured",
    ),
}
BROLL = {"UGC": "lifestyle", "montage/B-roll": "lifestyle", "product demo": "product close-up"}
PROOF_LINES = {
    "reviews/stars": "4.8 stars from 12,000 reviews.",
    "testimonial": "“Two weeks in and my afternoons are different.”",
    "before/after": "Before: two coffees by 3 p.m. After: none.",
    "expert": "Formulated with a sports dietitian.",
    "data/stat": "3 electrolytes, 0 g sugar, 10 calories.",
    "press": "As featured in Runner's World.",
}


@dataclass(frozen=True)
class DemoScene:
    start_s: float
    end_s: float
    transcript: str
    on_screen_text: str
    visual_description: str
    broll_type: str | None


def script_scenes(tags: dict[str, str], duration_s: float) -> list[DemoScene]:
    """A scene-by-scene breakdown for a demo video, written from its tags.

    The hook is always 0-3 s, like the real pipeline's forced boundary; the rest of
    the runtime is split between the body, proof, offer and call to action.
    """
    fmt = tags.get("format", "")
    first, second = FORMAT_SHOTS.get(fmt, FORMAT_SHOTS["text-on-screen"])
    broll = BROLL.get(fmt)
    hook = HOOK_LINES.get(tags.get("hook_type", ""), "Hydration that keeps up with you.")
    body = ANGLE_LINES.get(tags.get("angle", ""), "")
    beats = [(body, body.split(",")[0].split(".")[0], second)]
    if proof := PROOF_LINES.get(tags.get("proof_type", "")):
        beats.append((proof, proof, "Review cards stack up on screen"))
    if offer := OFFER_LINES.get(tags.get("offer", "")):
        beats.append((offer, offer.rstrip("."), "Product shot with the offer in a banner"))
    beats.append(
        (f"Try {BRAND} today.", f"{BRAND} · link below", "End card: logo and the stick pack")
    )
    scenes = [DemoScene(0.0, 3.0, hook, hook, first, None)]
    step = max(duration_s - 3.0, 1.0) / len(beats)
    for i, (said, shown, visual) in enumerate(beats):
        start = 3.0 + i * step
        end = duration_s if i == len(beats) - 1 else start + step
        scenes.append(DemoScene(round(start, 1), round(end, 1), said, shown, visual, broll))
    return scenes


class DemoSource(SandboxSyntheticSource):
    def __init__(
        self,
        *,
        seed: int = 2024,
        n_ads: int = 24,
        start_date: date | None = None,
        days: int = 90,
        media_dir: Path | None = None,
    ) -> None:
        super().__init__(
            seed=seed,
            n_ads=n_ads,
            start_date=start_date or date(2026, 7, 21),
            days=days,
            media_dir=media_dir,
        )
        self._tags = {s.creative.external_id: s.tags for s in self.account.ads}
        self._names = {s.ad.external_id: s for s in self.account.ads}

    def list_ads(self):  # type: ignore[no-untyped-def]  # noqa: ANN201
        out = []
        for ad in super().list_ads():
            tags = self._names[ad.external_id].tags
            fmt, hook = tags.get("format", "ad"), tags.get("hook_type", "static")
            name = f"{fmt} · {hook} · {ad.external_id[-3:]}"
            out.append(
                ad.model_copy(
                    update={
                        "external_id": ad.external_id.replace("syn_", "dw_"),
                        "name": name,
                        "creative_external_id": ad.creative_external_id.replace("syn_", "dw_"),
                    }
                )
            )
        return out

    def get_creative(self, creative_external_id: str) -> Creative:
        base = super().get_creative(creative_external_id.replace("dw_", "syn_"))
        headline, text = write_copy(self._tags[base.external_id])
        return base.model_copy(
            update={"external_id": creative_external_id, "headline": headline, "primary_text": text}
        )

    def get_daily_metrics(self, ad_ids, since, until):  # type: ignore[no-untyped-def]  # noqa: ANN001, ANN201
        rows = super().get_daily_metrics([i.replace("dw_", "syn_") for i in ad_ids], since, until)
        return [
            r.model_copy(update={"ad_external_id": r.ad_external_id.replace("syn_", "dw_")})
            for r in rows
        ]

    def ground_truth_tags(self) -> dict[str, dict[str, str]]:
        return {k.replace("syn_", "dw_"): v for k, v in super().ground_truth_tags().items()}

    def scenes(self, creative: Creative) -> list[DemoScene]:
        tags = self._tags[creative.external_id.replace("dw_", "syn_")]
        return script_scenes(tags, float(creative.duration_s or 30.0))

    def card(self, creative: Creative) -> MediaFile:
        """A branded card standing in for the creative: the static itself, or a video poster."""
        if self.media_dir is None:
            raise RuntimeError("DemoSource(media_dir=...) is required to render cards")
        tags = self._tags[creative.external_id.replace("dw_", "syn_")]
        hook = HOOK_LINES.get(
            tags.get("hook_type", ""), (creative.primary_text or "").split(".")[0]
        )
        shade = SHADES[
            int(hashlib.sha256(creative.external_id.encode()).hexdigest(), 16) % len(SHADES)
        ]
        size = (1080, 1350) if creative.type is not CreativeType.VIDEO else (1080, 1920)
        data = render_card(creative.headline or BRAND, hook, shade, size)
        self.media_dir.mkdir(parents=True, exist_ok=True)
        path = self.media_dir / f"{creative.external_id}.png"
        path.write_bytes(data)
        return MediaFile(
            creative_external_id=creative.external_id,
            path=path,
            content_type="image/png",
            content_hash=hashlib.sha256(data).hexdigest(),
            size_bytes=len(data),
        )
