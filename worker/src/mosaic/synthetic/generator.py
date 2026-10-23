"""Synthetic ad account generator (docs/ARCHITECTURE.md §11).

Builds a deterministic account — campaigns, ad sets, ads, creatives, ground-truth tags —
and daily KPIs with planted patterns. The planted patterns are the eval answer key.

Planted patterns:
- winning_hook        one hook type clearly beats the rest on CTR and hook rate
- fatigue             two high-spend video ads whose hook rate and CTR decay over time
- near_duplicate      two pairs of near-identical creatives with correlated performance
- static_vs_video     video beats static on CTR; static is cheaper per impression
- hidden_winner       one low-spend video ad with a genuinely high CTR and CVR

Everything is a pure function of the seed. Metrics for a given (ad, day) do not depend on
the requested date range, so backfills and incremental syncs agree.
"""

from __future__ import annotations

import dataclasses
import hashlib
import math
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field

from mosaic.models import Ad, AdDailyMetric, AdSet, Campaign, Creative, CreativeType

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
ANGLES = [
    "performance/results",
    "convenience",
    "price/value",
    "quality/ingredients",
    "social proof",
    "identity/lifestyle",
    "problem-solution",
    "comparison",
]
PERSONAS = [
    "busy mom",
    "fitness beginner",
    "skeptical buyer",
    "gift shopper",
    "health-conscious professional",
]
FORMATS_VIDEO = ["UGC", "talking head", "product demo", "montage/B-roll", "founder story"]
FORMATS_STATIC = ["static image", "text-on-screen"]
OFFERS = ["none", "none", "% discount", "$ off", "free shipping", "bundle", "free gift", "trial"]
PROOF_TYPES = [
    "none",
    "reviews/stars",
    "testimonial",
    "before/after",
    "expert",
    "data/stat",
    "press",
]
CTAS = ["shop now", "shop now", "learn more", "get offer", "sign up"]

MIN_WINNERS = 3

PatternKind = Literal[
    "winning_hook", "fatigue", "near_duplicate", "static_vs_video", "hidden_winner"
]


class PlantedPattern(BaseModel):
    kind: PatternKind
    description: str
    ad_external_ids: list[str] = Field(default_factory=list)
    creative_external_ids: list[str] = Field(default_factory=list)
    details: dict[str, object] = Field(default_factory=dict)


class AnswerKey(BaseModel):
    seed: int
    start_date: date
    days: int
    n_ads: int
    patterns: list[PlantedPattern]
    ground_truth_tags: dict[str, dict[str, str]]  # creative_external_id -> {dimension: value}


@dataclass(frozen=True)
class SyntheticAd:
    ad: Ad
    creative: Creative
    tags: dict[str, str]
    start: date
    end: date | None
    spend_weight: float
    # performance levers (ground truth)
    ctr_mult: float = 1.0
    cvr_mult: float = 1.0
    hook_mult: float = 1.0
    fatigue: bool = False
    duplicate_of: str | None = None  # ad_external_id of the original in a near-duplicate pair


class SyntheticAccount:
    def __init__(
        self,
        *,
        seed: int = 42,
        n_ads: int = 24,
        start_date: date = date(2026, 7, 21),
        days: int = 90,
    ) -> None:
        if n_ads < 12:
            raise ValueError("n_ads must be >= 12 so every planted pattern fits")
        self.seed = seed
        self.n_ads = n_ads
        self.start_date = start_date
        self.days = days
        self.end_date = start_date + timedelta(days=days - 1)
        rng = random.Random(seed)
        self.winning_hook = rng.choice(HOOK_TYPES)
        self.campaigns = self._build_campaigns()
        self.ad_sets = self._build_ad_sets()
        self.ads, self.patterns = self._build_ads(rng)

    # -- public -----------------------------------------------------------------

    def ad_by_external_id(self, ad_external_id: str) -> SyntheticAd:
        for s in self.ads:
            if s.ad.external_id == ad_external_id:
                return s
        raise KeyError(ad_external_id)

    def creative(self, creative_external_id: str) -> Creative:
        for s in self.ads:
            if s.creative.external_id == creative_external_id:
                return s.creative
        raise KeyError(creative_external_id)

    def answer_key(self) -> AnswerKey:
        return AnswerKey(
            seed=self.seed,
            start_date=self.start_date,
            days=self.days,
            n_ads=self.n_ads,
            patterns=self.patterns,
            ground_truth_tags={s.creative.external_id: dict(s.tags) for s in self.ads},
        )

    def daily_metrics(self, ad_ids: list[str], since: date, until: date) -> list[AdDailyMetric]:
        wanted = set(ad_ids)
        out: list[AdDailyMetric] = []
        for s in self.ads:
            if s.ad.external_id not in wanted:
                continue
            day = max(since, s.start)
            last = min(until, s.end) if s.end else until
            while day <= last:
                out.append(self.metric_for(s, day))
                day += timedelta(days=1)
        return out

    # -- structure --------------------------------------------------------------

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
        def adset(ext: str, camp: str, name: str, budget: int) -> AdSet:
            return AdSet(
                external_id=ext,
                campaign_external_id=camp,
                name=name,
                status="ACTIVE",
                optimization_goal="OFFSITE_CONVERSIONS",
                daily_budget_cents=budget,
            )

        return [
            adset("syn_adset_broad_video", "syn_camp_prospecting", "Broad — Video", 15_000),
            adset("syn_adset_broad_static", "syn_camp_prospecting", "Broad — Static", 5_000),
            adset("syn_adset_rt_all", "syn_camp_retargeting", "RT — All visitors 30d", 4_000),
        ]

    def _build_ads(self, rng: random.Random) -> tuple[list[SyntheticAd], list[PlantedPattern]]:
        n = self.n_ads
        # Roles are assigned to fixed indices so the answer key is stable per seed.
        n_static = max(3, n // 4)
        static_idx = set(range(n - n_static, n))
        video_idx = [i for i in range(n) if i not in static_idx]
        fatigue_idx = set(video_idx[:2])
        hidden_idx = video_idx[2]
        dup_pairs = [(video_idx[3], video_idx[4]), (video_idx[5], video_idx[6])]
        dup_of = {b: a for a, b in dup_pairs}

        drafts: dict[int, SyntheticAd] = {}
        for i in range(n):
            is_video = i not in static_idx
            if i in dup_of:
                orig = drafts[dup_of[i]]
                drafts[i] = self._duplicate(rng, i, orig)
                continue

            fmt = rng.choice(FORMATS_VIDEO if is_video else FORMATS_STATIC)
            duration = round(rng.uniform(8, 75), 1) if is_video else None
            tags = {
                "format": fmt,
                "angle": rng.choice(ANGLES),
                "persona": rng.choice(PERSONAS),
                "offer": rng.choice(OFFERS),
                "proof_type": rng.choice(PROOF_TYPES),
                "cta": rng.choice(CTAS),
                "length_bucket": _length_bucket(duration),
            }
            if is_video:
                tags["hook_type"] = rng.choice(HOOK_TYPES)

            start = self.start_date + timedelta(days=rng.randint(0, self.days // 2))
            end = None if rng.random() < 0.6 else start + timedelta(days=rng.randint(7, 45))
            spend_weight = rng.paretovariate(1.2)
            ctr_mult = cvr_mult = hook_mult = 1.0
            fatigue = False

            if i in fatigue_idx:
                start, end, spend_weight, fatigue = self.start_date, None, 4.0, True
            if i == hidden_idx:
                start, end = self.start_date + timedelta(days=self.days // 3), None
                spend_weight, ctr_mult, cvr_mult = 0.12, 1.8, 1.6

            drafts[i] = SyntheticAd(
                ad=self._ad(i, is_video, fmt, tags.get("hook_type"), start, end),
                creative=self._creative(i, is_video, duration),
                tags=tags,
                start=start,
                end=end,
                spend_weight=spend_weight,
                ctr_mult=ctr_mult,
                cvr_mult=cvr_mult,
                hook_mult=hook_mult,
                fatigue=fatigue,
            )

        # The winning hook must actually be planted: make sure at least MIN_WINNERS
        # ordinary video ads carry it (seeds that already have enough are unchanged).
        special = fatigue_idx | {hidden_idx} | {i for pair in dup_pairs for i in pair}
        carriers = [i for i in video_idx if drafts[i].tags.get("hook_type") == self.winning_hook]
        for i in [i for i in video_idx if i not in special and i not in carriers]:
            if len(carriers) >= MIN_WINNERS:
                break
            d = drafts[i]
            tags = {**d.tags, "hook_type": self.winning_hook}
            ad = d.ad.model_copy(
                update={"name": f"{tags['format']} | {self.winning_hook} | {i:03d}"}
            )
            drafts[i] = dataclasses.replace(d, tags=tags, ad=ad)
            carriers.append(i)

        ads = [drafts[i] for i in range(n)]
        patterns = self._describe_patterns(ads, fatigue_idx, hidden_idx, dup_pairs, static_idx)
        return ads, patterns

    def _duplicate(self, rng: random.Random, i: int, orig: SyntheticAd) -> SyntheticAd:
        """Same tags and script, slightly different cut; performance correlated with orig."""
        is_video = orig.creative.type is CreativeType.VIDEO
        duration = (
            round((orig.creative.duration_s or 20) + rng.uniform(-2, 2), 1) if is_video else None
        )
        creative = orig.creative.model_copy(
            update={
                "external_id": f"syn_cr_{i:03d}",
                "headline": f"{orig.creative.headline} (v2)",
                "duration_s": duration,
            }
        )
        start = orig.start + timedelta(days=rng.randint(3, 10))
        ad = self._ad(i, is_video, orig.tags["format"], orig.tags.get("hook_type"), start, orig.end)
        return SyntheticAd(
            ad=ad,
            creative=creative,
            tags=dict(orig.tags),
            start=start,
            end=orig.end,
            spend_weight=orig.spend_weight * rng.uniform(0.6, 1.0),
            ctr_mult=orig.ctr_mult,
            cvr_mult=orig.cvr_mult,
            hook_mult=orig.hook_mult,
            duplicate_of=orig.ad.external_id,
        )

    def _ad(
        self,
        i: int,
        is_video: bool,
        fmt: str,
        hook: str | None,
        start: date,
        end: date | None,
    ) -> Ad:
        if i % 5 == 0:
            ad_set = "syn_adset_rt_all"
        elif is_video:
            ad_set = "syn_adset_broad_video"
        else:
            ad_set = "syn_adset_broad_static"
        return Ad(
            external_id=f"syn_ad_{i:03d}",
            ad_set_external_id=ad_set,
            creative_external_id=f"syn_cr_{i:03d}",
            name=f"{fmt} | {hook or 'static'} | {i:03d}",
            status="ACTIVE" if end is None else "PAUSED",
            created_time=datetime.combine(start, datetime.min.time()),
        )

    def _creative(self, i: int, is_video: bool, duration: float | None) -> Creative:
        return Creative(
            external_id=f"syn_cr_{i:03d}",
            type=CreativeType.VIDEO if is_video else CreativeType.IMAGE,
            primary_text=f"Synthetic primary text for ad {i}.",
            headline=f"Headline {i}",
            cta_type="SHOP_NOW",
            duration_s=duration,
            width=1080,
            height=1920 if is_video else 1080,
        )

    def _describe_patterns(
        self,
        ads: list[SyntheticAd],
        fatigue_idx: set[int],
        hidden_idx: int,
        dup_pairs: list[tuple[int, int]],
        static_idx: set[int],
    ) -> list[PlantedPattern]:
        winners = [s for s in ads if s.tags.get("hook_type") == self.winning_hook]
        patterns = [
            PlantedPattern(
                kind="winning_hook",
                description=f"Hook type '{self.winning_hook}' has ~1.5x CTR and ~1.4x hook rate.",
                ad_external_ids=[s.ad.external_id for s in winners],
                creative_external_ids=[s.creative.external_id for s in winners],
                details={"hook_type": self.winning_hook, "ctr_mult": 1.5, "hook_rate_mult": 1.4},
            ),
            PlantedPattern(
                kind="fatigue",
                description="Hook rate and CTR decay ~1.2%/day after day 14, floored at 45%.",
                ad_external_ids=[ads[i].ad.external_id for i in sorted(fatigue_idx)],
                creative_external_ids=[ads[i].creative.external_id for i in sorted(fatigue_idx)],
                details={"onset_day": 14, "decay_per_day": 0.012, "floor": 0.45},
            ),
            PlantedPattern(
                kind="hidden_winner",
                description="Low spend (~12% of a typical ad) but 1.8x CTR and 1.6x CVR.",
                ad_external_ids=[ads[hidden_idx].ad.external_id],
                creative_external_ids=[ads[hidden_idx].creative.external_id],
                details={"spend_weight": 0.12, "ctr_mult": 1.8, "cvr_mult": 1.6},
            ),
            PlantedPattern(
                kind="static_vs_video",
                description="Video base CTR 1.2% vs static 0.8%; static CPM ~30% lower.",
                ad_external_ids=[ads[i].ad.external_id for i in sorted(static_idx)],
                creative_external_ids=[ads[i].creative.external_id for i in sorted(static_idx)],
                details={"video_ctr": 0.012, "static_ctr": 0.008, "static_cpm_mult": 0.7},
            ),
        ]
        for a, b in dup_pairs:
            patterns.append(
                PlantedPattern(
                    kind="near_duplicate",
                    description="Same tags and script, re-cut; shared performance levers.",
                    ad_external_ids=[ads[a].ad.external_id, ads[b].ad.external_id],
                    creative_external_ids=[
                        ads[a].creative.external_id,
                        ads[b].creative.external_id,
                    ],
                )
            )
        return patterns

    # -- metrics ----------------------------------------------------------------

    def metric_for(self, s: SyntheticAd, day: date) -> AdDailyMetric:
        key = f"{self.seed}:{s.ad.external_id}:{day.isoformat()}"
        rng = random.Random(int(hashlib.sha256(key.encode()).hexdigest()[:16], 16))
        is_video = s.creative.type is CreativeType.VIDEO
        age = (day - s.start).days

        dow_mult = 1.15 if day.weekday() >= 5 else 1.0
        spend = max(0.0, rng.gauss(12.0 * s.spend_weight, 3.0 * s.spend_weight)) * dow_mult
        cpm = rng.uniform(9.0, 16.0) * (1.0 if is_video else 0.7)
        impressions = int(spend / cpm * 1000)
        reach = int(impressions * rng.uniform(0.7, 0.9))

        fatigue_mult = 1.0
        if s.fatigue and age > 14:
            fatigue_mult = max(0.45, 1.0 - 0.012 * (age - 14))

        ctr = (0.012 if is_video else 0.008) * s.ctr_mult * fatigue_mult
        if s.tags.get("hook_type") == self.winning_hook:
            ctr *= 1.5
        ctr *= _angle_mult(s.tags["angle"])
        clicks = _binomial(rng, impressions, min(ctr, 0.5))
        link_clicks = _binomial(rng, clicks, 0.85)
        purchases = _binomial(rng, link_clicks, min(0.03 * s.cvr_mult, 0.5))
        aov = rng.uniform(45.0, 70.0)

        video: dict[str, int | None] = dict.fromkeys(
            (
                "video_3s_views",
                "video_thruplays",
                "video_p25",
                "video_p50",
                "video_p75",
                "video_p100",
            )
        )
        if is_video:
            hook_rate = 0.28 * s.hook_mult * fatigue_mult
            if s.tags.get("hook_type") == self.winning_hook:
                hook_rate *= 1.4
            v3 = _binomial(rng, impressions, min(hook_rate, 0.9))
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


def _length_bucket(duration_s: float | None) -> str:
    if duration_s is None:
        return "static"
    if duration_s <= 15:
        return "<=15s"
    if duration_s <= 30:
        return "16-30s"
    if duration_s <= 60:
        return "31-60s"
    return ">60s"


def _angle_mult(angle: str) -> float:
    # Mild, so the hook-type signal stays the dominant planted pattern.
    return {"social proof": 1.1, "price/value": 1.05, "comparison": 0.95}.get(angle, 1.0)


def _binomial(rng: random.Random, n: int, p: float) -> int:
    """Binomial sample; exact for small n*p, normal approximation otherwise."""
    if n <= 0 or p <= 0:
        return 0
    if p >= 1:
        return n
    mean = n * p
    if mean < 30 or n * (1 - p) < 30:
        return sum(1 for _ in range(n) if rng.random() < p)
    x = round(rng.gauss(mean, math.sqrt(mean * (1 - p))))
    return min(max(x, 0), n)
