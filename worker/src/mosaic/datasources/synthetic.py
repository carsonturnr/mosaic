"""SandboxSyntheticSource — stub.

Generates a small, deterministic ad account in memory. Structure (campaigns, ad sets)
will later be read from the Meta sandbox; ads, creatives and all metrics always come
from here because sandbox accounts never deliver.

This is v0: deterministic given the seed, binomial noise, a per-format base rate and a
simple hook-type multiplier. The full planted-pattern generator (docs/ARCHITECTURE.md §11:
fatigue decay, near-duplicate pairs, hidden low-spend winner, answer key) replaces the
internals of `get_daily_metrics` without changing this class's interface.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

from mosaic.models import Ad, AdDailyMetric, AdSet, Campaign, Creative, CreativeType, MediaFile

HOOK_TYPES = [
    "problem/pain",
    "curiosity/question",
    "bold claim",
    "stat/number",
    "demo/visual",
    "testimonial",
    "us-vs-them",
    "pattern interrupt",
    "offer-first",
]
FORMATS_VIDEO = ["UGC", "talking head", "product demo", "montage/B-roll", "founder story"]
FORMATS_STATIC = ["static image", "text-on-screen"]


@dataclass(frozen=True)
class _SyntheticAd:
    """An ad plus the ground-truth tags that drive its performance (the eval answer key)."""

    ad: Ad
    creative: Creative
    hook_type: str | None
    format: str
    start: date
    end: date | None
    spend_weight: float


class SandboxSyntheticSource:
    def __init__(
        self,
        *,
        seed: int = 42,
        n_ads: int = 24,
        start_date: date = date(2026, 7, 21),
        days: int = 90,
        media_dir: Path | None = None,
    ) -> None:
        self.seed = seed
        self.start_date = start_date
        self.days = days
        self.media_dir = media_dir
        rng = random.Random(seed)
        self._campaigns = self._build_campaigns()
        self._ad_sets = self._build_ad_sets()
        self._ads = self._build_ads(rng, n_ads)

    # -- structure ------------------------------------------------------------

    def list_campaigns(self) -> list[Campaign]:
        return list(self._campaigns)

    def list_ad_sets(self) -> list[AdSet]:
        return list(self._ad_sets)

    def list_ads(self) -> list[Ad]:
        return [s.ad for s in self._ads]

    def get_creative(self, creative_external_id: str) -> Creative:
        for s in self._ads:
            if s.creative.external_id == creative_external_id:
                return s.creative
        raise KeyError(creative_external_id)

    def download_media(self, creative: Creative) -> MediaFile:
        """Stub: writes a tiny placeholder file so downstream code has a real path."""
        if self.media_dir is None:
            raise RuntimeError(
                "SandboxSyntheticSource(media_dir=...) is required to download media"
            )
        ext = "mp4" if creative.type is CreativeType.VIDEO else "png"
        self.media_dir.mkdir(parents=True, exist_ok=True)
        path = self.media_dir / f"{creative.external_id}.{ext}"
        payload = f"synthetic:{creative.external_id}".encode()
        path.write_bytes(payload)
        return MediaFile(
            creative_external_id=creative.external_id,
            path=path,
            content_type="video/mp4" if ext == "mp4" else "image/png",
            content_hash=hashlib.sha256(payload).hexdigest(),
            size_bytes=len(payload),
        )

    # -- metrics --------------------------------------------------------------

    def get_daily_metrics(self, ad_ids: list[str], since: date, until: date) -> list[AdDailyMetric]:
        wanted = set(ad_ids)
        out: list[AdDailyMetric] = []
        for s in self._ads:
            if s.ad.external_id not in wanted:
                continue
            day = max(since, s.start)
            last = min(until, s.end) if s.end else until
            while day <= last:
                out.append(self._metric_for(s, day))
                day += timedelta(days=1)
        return out

    # -- ground truth (for evals / seeding tags) -------------------------------

    def ground_truth_tags(self) -> dict[str, dict[str, str]]:
        """creative_external_id -> {dimension_key: value}."""
        result: dict[str, dict[str, str]] = {}
        for s in self._ads:
            tags = {"format": s.format}
            if s.hook_type is not None:
                tags["hook_type"] = s.hook_type
            result[s.creative.external_id] = tags
        return result

    # -- internals ------------------------------------------------------------

    def _build_campaigns(self) -> list[Campaign]:
        created = datetime.combine(self.start_date, datetime.min.time())
        return [
            Campaign(
                external_id="syn_camp_prospecting",
                name="Prospecting — Broad",
                objective="OUTCOME_SALES",
                status="ACTIVE",
                created_time=created,
            ),
            Campaign(
                external_id="syn_camp_retargeting",
                name="Retargeting — Site Visitors",
                objective="OUTCOME_SALES",
                status="ACTIVE",
                created_time=created,
            ),
        ]

    def _build_ad_sets(self) -> list[AdSet]:
        return [
            AdSet(
                external_id="syn_adset_broad_video",
                campaign_external_id="syn_camp_prospecting",
                name="Broad — Video",
                status="ACTIVE",
                optimization_goal="OFFSITE_CONVERSIONS",
                daily_budget_cents=15_000,
            ),
            AdSet(
                external_id="syn_adset_broad_static",
                campaign_external_id="syn_camp_prospecting",
                name="Broad — Static",
                status="ACTIVE",
                optimization_goal="OFFSITE_CONVERSIONS",
                daily_budget_cents=5_000,
            ),
            AdSet(
                external_id="syn_adset_rt_all",
                campaign_external_id="syn_camp_retargeting",
                name="RT — All visitors 30d",
                status="ACTIVE",
                optimization_goal="OFFSITE_CONVERSIONS",
                daily_budget_cents=4_000,
            ),
        ]

    def _build_ads(self, rng: random.Random, n_ads: int) -> list[_SyntheticAd]:
        ads: list[_SyntheticAd] = []
        for i in range(n_ads):
            is_video = rng.random() < 0.7
            fmt = rng.choice(FORMATS_VIDEO if is_video else FORMATS_STATIC)
            hook = rng.choice(HOOK_TYPES) if is_video else None
            ad_set = (
                "syn_adset_broad_video"
                if is_video and i % 5 != 0
                else "syn_adset_rt_all"
                if i % 5 == 0
                else "syn_adset_broad_static"
            )
            start = self.start_date + timedelta(days=rng.randint(0, self.days // 2))
            end = None if rng.random() < 0.6 else start + timedelta(days=rng.randint(7, 45))
            creative = Creative(
                external_id=f"syn_cr_{i:03d}",
                type=CreativeType.VIDEO if is_video else CreativeType.IMAGE,
                primary_text=f"Synthetic primary text for ad {i}.",
                headline=f"Headline {i}",
                cta_type="SHOP_NOW",
                duration_s=round(rng.uniform(8, 75), 1) if is_video else None,
                width=1080,
                height=1920 if is_video else 1080,
            )
            ad = Ad(
                external_id=f"syn_ad_{i:03d}",
                ad_set_external_id=ad_set,
                creative_external_id=creative.external_id,
                name=f"{fmt} | {hook or 'static'} | {i:03d}",
                status="ACTIVE" if end is None else "PAUSED",
                created_time=datetime.combine(start, datetime.min.time()),
            )
            # Uneven spend: a handful of ads take most of the budget.
            spend_weight = rng.paretovariate(1.2)
            ads.append(_SyntheticAd(ad, creative, hook, fmt, start, end, spend_weight))
        return ads

    def _metric_for(self, s: _SyntheticAd, day: date) -> AdDailyMetric:
        # Per (seed, ad, day) RNG so any date range returns identical rows.
        key = f"{self.seed}:{s.ad.external_id}:{day.isoformat()}"
        rng = random.Random(int(hashlib.sha256(key.encode()).hexdigest()[:16], 16))

        is_video = s.creative.type is CreativeType.VIDEO
        dow_mult = 1.15 if day.weekday() >= 5 else 1.0
        spend = max(0.0, rng.gauss(12.0 * s.spend_weight, 3.0 * s.spend_weight)) * dow_mult
        cpm = rng.uniform(9.0, 16.0)
        impressions = int(spend / cpm * 1000)
        reach = int(impressions * rng.uniform(0.7, 0.9))

        base_ctr = 0.012 if is_video else 0.009
        base_ctr *= 1.5 if s.hook_type == "problem/pain" else 1.0  # planted winner
        clicks = _binomial(rng, impressions, base_ctr)
        link_clicks = _binomial(rng, clicks, 0.85)
        purchases = _binomial(rng, link_clicks, 0.03)
        aov = rng.uniform(45.0, 70.0)

        video: dict[str, int | None] = {
            k: None
            for k in (
                "video_3s_views",
                "video_thruplays",
                "video_p25",
                "video_p50",
                "video_p75",
                "video_p100",
            )
        }
        if is_video:
            v3 = _binomial(rng, impressions, 0.28)
            p25 = _binomial(rng, v3, 0.75)
            p50 = _binomial(rng, p25, 0.7)
            p75 = _binomial(rng, p50, 0.7)
            p100 = _binomial(rng, p75, 0.6)
            video = {
                "video_3s_views": v3,
                "video_thruplays": _binomial(rng, v3, 0.45),
                "video_p25": p25,
                "video_p50": p50,
                "video_p75": p75,
                "video_p100": p100,
            }

        return AdDailyMetric(
            ad_external_id=s.ad.external_id,
            date=day,
            spend=round(spend, 2),
            impressions=impressions,
            reach=reach,
            clicks=clicks,
            link_clicks=link_clicks,
            purchases=float(purchases),
            purchase_value=round(purchases * aov, 2),
            **video,
        )


def _binomial(rng: random.Random, n: int, p: float) -> int:
    if n <= 0 or p <= 0:
        return 0
    return sum(1 for _ in range(n) if rng.random() < p)
