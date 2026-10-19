"""SandboxSyntheticSource.

Structure (campaigns, ad sets) will later be read from the Meta sandbox where possible;
ads, creatives and all metrics come from `SyntheticAccount` because sandbox accounts never
deliver. The generated account's answer key is the eval ground truth (docs/ARCHITECTURE.md §11).
"""

from __future__ import annotations

import hashlib
from datetime import date
from pathlib import Path

from mosaic.models import Ad, AdDailyMetric, AdSet, Campaign, Creative, CreativeType, MediaFile
from mosaic.synthetic.generator import AnswerKey, SyntheticAccount


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
        self.account = SyntheticAccount(seed=seed, n_ads=n_ads, start_date=start_date, days=days)
        self.media_dir = media_dir

    def list_campaigns(self) -> list[Campaign]:
        return list(self.account.campaigns)

    def list_ad_sets(self) -> list[AdSet]:
        return list(self.account.ad_sets)

    def list_ads(self) -> list[Ad]:
        return [s.ad for s in self.account.ads]

    def get_creative(self, creative_external_id: str) -> Creative:
        return self.account.creative(creative_external_id)

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

    def get_daily_metrics(self, ad_ids: list[str], since: date, until: date) -> list[AdDailyMetric]:
        return self.account.daily_metrics(ad_ids, since, until)

    def answer_key(self) -> AnswerKey:
        return self.account.answer_key()

    def ground_truth_tags(self) -> dict[str, dict[str, str]]:
        """creative_external_id -> {dimension_key: value}."""
        return self.account.answer_key().ground_truth_tags
