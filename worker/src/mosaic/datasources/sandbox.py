"""MetaSandboxSource: real ads from the Meta sandbox account, synthetic results on their tags.

Structure, creatives and media come from the Marketing API exactly as for a live account.
Sandbox accounts never deliver, so the daily metrics are built by `TaggedAccount` from the
tags perception gave each ad; until 12 ads are tagged there are no results. Seeding the sandbox
with ads is `python -m mosaic.sandbox` (docs/ARCHITECTURE.md §2).
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from mosaic.datasources.local import TaggedAccount
from mosaic.datasources.meta import MetaLiveSource
from mosaic.models import Ad, AdDailyMetric, AdSet, Campaign, Creative, MediaFile
from mosaic.synthetic.generator import MIN_ADS

# What TaggedAccount reads from each ad; ads missing any of these get no results yet.
REQUIRED = ("angle", "persona", "format", "offer", "proof_type", "cta", "length_bucket")


class MetaSandboxSource:
    def __init__(
        self,
        live: MetaLiveSource,
        tags: dict[str, dict[str, str]],
        creatives: dict[str, Creative],
        *,
        seed: int = 11,
        start_date: date,
        days: int = 90,
    ) -> None:
        """`tags` and `creatives` are keyed by creative external id: the AI tags and the
        synced creative. Results are built from these, so a metrics sync costs Meta one call."""
        self.live = live
        self.tags = tags
        self.creatives = creatives
        self.seed = seed
        self.start_date = start_date
        self.days = days

    @property
    def media_dir(self) -> Path | None:
        return self.live.media_dir

    @media_dir.setter
    def media_dir(self, value: Path | None) -> None:
        self.live.media_dir = value

    def list_campaigns(self) -> list[Campaign]:
        return self.live.list_campaigns()

    def list_ad_sets(self) -> list[AdSet]:
        return self.live.list_ad_sets()

    def list_ads(self) -> list[Ad]:
        return self.live.list_ads()

    def get_creative(self, creative_external_id: str) -> Creative:
        return self.live.get_creative(creative_external_id)

    def download_media(self, creative: Creative) -> MediaFile:
        return self.live.download_media(creative)

    def get_daily_metrics(self, ad_ids: list[str], since: date, until: date) -> list[AdDailyMetric]:
        account = self.account()
        return account.daily_metrics(ad_ids, since, until) if account else []

    def account(self) -> TaggedAccount | None:
        """Synthetic results for every tagged ad, or None until MIN_ADS are tagged."""
        given = []
        for ad in sorted(self.list_ads(), key=lambda a: a.external_id):
            tags = self.tags.get(ad.creative_external_id, {})
            creative = self.creatives.get(ad.creative_external_id)
            if creative and all(k in tags for k in REQUIRED):
                given.append((ad.external_id, creative, tags))
        if len(given) < MIN_ADS:
            return None  # too few tagged ads to plant every pattern; wait for perception
        return TaggedAccount(given, seed=self.seed, start_date=self.start_date, days=self.days)
