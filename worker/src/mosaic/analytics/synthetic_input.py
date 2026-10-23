"""Build analysis inputs straight from a SyntheticAccount (tests and the planted-pattern eval)."""

from __future__ import annotations

from mosaic.analytics.compute import AdInput, Day
from mosaic.synthetic.generator import SyntheticAccount


def inputs_from_synthetic(account: SyntheticAccount) -> list[AdInput]:
    ids = [s.ad.external_id for s in account.ads]
    rows = account.daily_metrics(ids, account.start_date, account.end_date)
    by_ad: dict[str, list[Day]] = {i: [] for i in ids}
    for r in rows:
        by_ad[r.ad_external_id].append(
            Day(
                date=r.date,
                spend=r.spend,
                impressions=r.impressions,
                clicks=r.clicks or 0,
                link_clicks=r.link_clicks or 0,
                purchases=r.purchases or 0.0,
                purchase_value=r.purchase_value or 0.0,
                video_3s_views=r.video_3s_views,
                video_thruplays=r.video_thruplays,
            )
        )
    return [
        AdInput(
            ad_id=s.ad.external_id,
            external_id=s.ad.external_id,
            name=s.ad.name,
            creative_type=s.creative.type.value,
            objective="OUTCOME_SALES",
            tags=dict(s.tags),
            days=by_ad[s.ad.external_id],
        )
        for s in account.ads
    ]
