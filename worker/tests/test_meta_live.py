"""Live checks against the Meta sandbox. Skipped unless MOSAIC_LIVE_META=1.

MOSAIC_LIVE_META=1 uv run pytest tests/test_meta_live.py -q
"""

import os
from datetime import date

import pytest

from mosaic.datasources.meta import (
    CREATIVE_FIELDS,
    INSIGHT_FIELDS,
    MetaClient,
    MetaLiveSource,
)

pytestmark = pytest.mark.skipif(
    os.environ.get("MOSAIC_LIVE_META") != "1", reason="set MOSAIC_LIVE_META=1 to hit the real API"
)

FIXTURE_CAMPAIGN = "120330001596475419"
FIXTURE_ADSET = "120330001596476119"


@pytest.fixture(scope="module")
def live() -> tuple[MetaClient, MetaLiveSource]:
    from mosaic.config import Settings

    s = Settings.from_env()
    assert s.meta_access_token and s.meta_sandbox_ad_account_id
    client = MetaClient(s.meta_access_token, app_secret=s.meta_app_secret)
    return client, MetaLiveSource(client, s.meta_sandbox_ad_account_id)


def test_structure_reads_sandbox_fixtures(live: tuple[MetaClient, MetaLiveSource]) -> None:
    _, src = live
    assert FIXTURE_CAMPAIGN in {c.external_id for c in src.list_campaigns()}
    adsets = {a.external_id: a for a in src.list_ad_sets()}
    assert adsets[FIXTURE_ADSET].campaign_external_id == FIXTURE_CAMPAIGN
    src.list_ads()  # sandbox has none while the app is in dev mode; must not error


@pytest.mark.parametrize("field", INSIGHT_FIELDS.split(","))
def test_every_insight_field_is_accepted(
    live: tuple[MetaClient, MetaLiveSource], field: str
) -> None:
    client, src = live
    client.get(
        f"{src.account}/insights",
        {"level": "ad", "time_increment": 1, "date_preset": "last_7d", "fields": field},
    )


def test_creative_fields_and_daily_metrics(live: tuple[MetaClient, MetaLiveSource]) -> None:
    client, src = live
    client.get(f"{src.account}/adcreatives", {"fields": CREATIVE_FIELDS, "limit": 1})
    assert src.get_daily_metrics([FIXTURE_ADSET], date(2026, 10, 1), date(2026, 10, 20)) == []
