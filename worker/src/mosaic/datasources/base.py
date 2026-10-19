"""The one interface every read goes through (docs/ARCHITECTURE.md §6).

Implementations:
- MetaLiveSource          Marketing API (Graph API v26.0)            [todo]
- SandboxSyntheticSource  sandbox structure + synthetic ads/metrics  [stub]
- DemoSource              fully local fixtures                        [todo]
"""

from __future__ import annotations

from datetime import date
from typing import Protocol, runtime_checkable

from mosaic.models import Ad, AdDailyMetric, AdSet, Campaign, Creative, MediaFile


@runtime_checkable
class DataSource(Protocol):
    def list_campaigns(self) -> list[Campaign]: ...

    def list_ad_sets(self) -> list[AdSet]: ...

    def list_ads(self) -> list[Ad]: ...

    def get_creative(self, creative_external_id: str) -> Creative: ...

    def download_media(self, creative: Creative) -> MediaFile: ...

    def get_daily_metrics(
        self, ad_ids: list[str], since: date, until: date
    ) -> list[AdDailyMetric]: ...
