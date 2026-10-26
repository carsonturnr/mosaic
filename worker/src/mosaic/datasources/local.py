"""LocalSource: real ad files from a folder, with stored perception and synthetic performance.

For development on real creatives (e.g. public ads saved from the Meta Ad Library) before a
live account exists. The files and their tags are real; every metric is synthetic, built by
`TaggedAccount` from the ads' own tags so the planted patterns line up with real content.
Workspaces seeded from this source must stay private (docs/ARCHITECTURE.md §2).

The perception file maps an ad key to one tagging result, the shape written by
`python -m mosaic.perception` plus `file` (the tagged file's name in the folder) and
optionally `model`, `type` and `duration_s`. Entries with an `error` key are skipped.
Scene spans are not stored: detection is deterministic, so the seed re-runs it on the file
and gets the same cuts the model was prompted with.
"""

from __future__ import annotations

import dataclasses
import hashlib
import random
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from mosaic.models import Ad, AdDailyMetric, AdSet, Campaign, Creative, CreativeType, MediaFile
from mosaic.perception.tagging import TAGGING_MODEL, CreativeTagging
from mosaic.synthetic.generator import (
    MIN_WINNERS,
    PlantedPattern,
    SyntheticAccount,
    SyntheticAd,
)

MIME = {".mp4": "video/mp4", ".mov": "video/quicktime", ".png": "image/png", ".jpg": "image/jpeg"}
WHOLE_AD = ("angle", "persona", "format", "offer", "proof_type", "cta")


def tags_of(result: dict[str, Any]) -> dict[str, str]:
    """Flat {dimension: value} from one stored tagging result."""
    tags = {k: result[k]["value"] for k in WHOLE_AD}
    tags["length_bucket"] = result["length_bucket"]
    if result.get("hook"):
        tags["hook_type"] = result["hook"]["hook_type"]["value"]
    return tags


class TaggedAccount(SyntheticAccount):
    """Synthetic performance for given creatives: their tags are fixed, not drawn.

    Plants the same patterns as `SyntheticAccount` except near-duplicates (real ads have
    their own). The winning hook is a hook type that at least MIN_WINNERS videos carry.
    """

    def __init__(
        self,
        creatives: list[tuple[str, Creative, dict[str, str]]],
        *,
        seed: int,
        start_date: date,
        days: int,
    ) -> None:
        self._given = creatives  # (ad external id, creative, tags)
        super().__init__(seed=seed, n_ads=len(creatives), start_date=start_date, days=days)

    def _build_ads(self, rng: random.Random) -> tuple[list[SyntheticAd], list[PlantedPattern]]:
        given = self._given
        videos = [i for i, (_, c, _) in enumerate(given) if c.type is CreativeType.VIDEO]
        statics = {i for i in range(len(given)) if i not in videos}
        hooks = Counter(
            given[i][2].get("hook_type") for i in videos if given[i][2].get("hook_type")
        )
        candidates = sorted(h for h, n in hooks.items() if n >= MIN_WINNERS)
        if not candidates:
            raise ValueError(f"no hook type is on {MIN_WINNERS}+ videos; can't plant a winner")
        self.winning_hook = rng.choice(candidates)
        others = [i for i in videos if given[i][2].get("hook_type") != self.winning_hook]
        if len(others) < 3:
            raise ValueError(
                "need 3+ videos outside the winning hook for fatigue and hidden winner"
            )
        rng.shuffle(others)
        fatigue_idx, hidden_idx = set(others[:2]), others[2]

        ads: list[SyntheticAd] = []
        for i, (ad_ext, creative, tags) in enumerate(given):
            is_video = i not in statics
            start = self.start_date + timedelta(days=rng.randint(0, self.days // 2))
            end = None if rng.random() < 0.6 else start + timedelta(days=rng.randint(7, 45))
            draft = SyntheticAd(
                ad=Ad(
                    external_id=ad_ext,
                    ad_set_external_id=(
                        "syn_adset_rt_all"
                        if i % 5 == 0
                        else "syn_adset_broad_video"
                        if is_video
                        else "syn_adset_broad_static"
                    ),
                    creative_external_id=creative.external_id,
                    name=f"{tags['format']} · {tags.get('hook_type', 'static')} · {ad_ext[-4:]}",
                    status="ACTIVE",
                ),
                creative=creative,
                tags=dict(tags),
                start=start,
                end=end,
                spend_weight=rng.paretovariate(1.2),
            )
            if i in fatigue_idx:
                draft = dataclasses.replace(
                    draft, start=self.start_date, end=None, spend_weight=4.0, fatigue=True
                )
            if i == hidden_idx:
                draft = dataclasses.replace(
                    draft,
                    start=self.start_date + timedelta(days=self.days // 3),
                    end=None,
                    spend_weight=0.12,
                    ctr_mult=1.8,
                    cvr_mult=1.6,
                )
            ad = draft.ad.model_copy(
                update={
                    "status": "ACTIVE" if draft.end is None else "PAUSED",
                    "created_time": datetime.combine(draft.start, datetime.min.time()),
                }
            )
            ads.append(dataclasses.replace(draft, ad=ad))
        patterns = self._describe_patterns(ads, fatigue_idx, hidden_idx, [], statics)
        return ads, patterns


class LocalSource:
    def __init__(
        self,
        folder: Path,
        perception: dict[str, dict[str, Any]],
        *,
        seed: int = 7,
        start_date: date,
        days: int = 90,
    ) -> None:
        self.folder = folder
        self.results = {k: v for k, v in perception.items() if "error" not in v}
        given = []
        for key, r in sorted(self.results.items()):
            path = folder / r["file"]
            is_video = r.get("type", "video" if path.suffix == ".mp4" else "image") == "video"
            creative = Creative(
                external_id=f"cr_{key}",
                type=CreativeType.VIDEO if is_video else CreativeType.IMAGE,
                duration_s=r.get("duration_s"),
            )
            given.append((key, creative, tags_of(r)))
        self.account = TaggedAccount(given, seed=seed, start_date=start_date, days=days)

    def list_campaigns(self) -> list[Campaign]:
        return list(self.account.campaigns)

    def list_ad_sets(self) -> list[AdSet]:
        return list(self.account.ad_sets)

    def list_ads(self) -> list[Ad]:
        return [s.ad for s in self.account.ads]

    def get_creative(self, creative_external_id: str) -> Creative:
        return self.account.creative(creative_external_id)

    def download_media(self, creative: Creative) -> MediaFile:
        path = self.folder / self._result(creative.external_id)["file"]
        data = path.read_bytes()
        return MediaFile(
            creative_external_id=creative.external_id,
            path=path,
            content_type=MIME.get(path.suffix.lower(), "application/octet-stream"),
            content_hash=hashlib.sha256(data).hexdigest(),
            size_bytes=len(data),
        )

    def get_daily_metrics(self, ad_ids: list[str], since: date, until: date) -> list[AdDailyMetric]:
        return self.account.daily_metrics(ad_ids, since, until)

    def perception(self, creative_external_id: str) -> tuple[CreativeTagging, str]:
        """The stored tagging result and the model that produced it."""
        r = self._result(creative_external_id)
        return CreativeTagging.model_validate(r), r.get("model", TAGGING_MODEL)

    def _result(self, creative_external_id: str) -> dict[str, Any]:
        return self.results[creative_external_id.removeprefix("cr_")]
