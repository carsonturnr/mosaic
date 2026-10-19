from datetime import date
from pathlib import Path

from mosaic.datasources import DataSource, SandboxSyntheticSource
from mosaic.models import CreativeType


def test_conforms_to_protocol() -> None:
    assert isinstance(SandboxSyntheticSource(), DataSource)


def test_structure_is_consistent() -> None:
    src = SandboxSyntheticSource(seed=1, n_ads=12)
    campaign_ids = {c.external_id for c in src.list_campaigns()}
    ad_set_ids = {a.external_id for a in src.list_ad_sets()}
    assert all(a.campaign_external_id in campaign_ids for a in src.list_ad_sets())
    ads = src.list_ads()
    assert len(ads) == 12
    assert all(a.ad_set_external_id in ad_set_ids for a in ads)
    for a in ads:
        creative = src.get_creative(a.creative_external_id)
        assert creative.external_id == a.creative_external_id


def test_deterministic_given_seed() -> None:
    a = SandboxSyntheticSource(seed=7)
    b = SandboxSyntheticSource(seed=7)
    assert a.list_ads() == b.list_ads()
    ids = [ad.external_id for ad in a.list_ads()]
    since, until = date(2026, 8, 1), date(2026, 8, 14)
    assert a.get_daily_metrics(ids, since, until) == b.get_daily_metrics(ids, since, until)


def test_different_seed_differs() -> None:
    assert SandboxSyntheticSource(seed=1).list_ads() != SandboxSyntheticSource(seed=2).list_ads()


def test_metrics_respect_window_and_ad_filter() -> None:
    src = SandboxSyntheticSource(seed=3)
    ids = [ad.external_id for ad in src.list_ads()][:3]
    since, until = date(2026, 9, 1), date(2026, 9, 7)
    rows = src.get_daily_metrics(ids, since, until)
    assert {r.ad_external_id for r in rows} <= set(ids)
    assert all(since <= r.date <= until for r in rows)
    assert len({(r.ad_external_id, r.date) for r in rows}) == len(rows)


def test_metric_funnel_is_monotone() -> None:
    src = SandboxSyntheticSource(seed=5)
    ids = [ad.external_id for ad in src.list_ads()]
    for r in src.get_daily_metrics(ids, date(2026, 8, 1), date(2026, 8, 31)):
        assert r.clicks is not None and r.link_clicks is not None and r.purchases is not None
        assert r.impressions >= r.clicks >= r.link_clicks >= r.purchases
        if r.video_3s_views is not None:
            assert r.impressions >= r.video_3s_views >= (r.video_thruplays or 0)
            assert (
                (r.video_p25 or 0)
                >= (r.video_p50 or 0)
                >= (r.video_p75 or 0)
                >= (r.video_p100 or 0)
            )


def test_subwindow_matches_full_window() -> None:
    """Rows for a day must not depend on the requested range."""
    src = SandboxSyntheticSource(seed=9)
    ids = [ad.external_id for ad in src.list_ads()]
    full = {
        (r.ad_external_id, r.date): r
        for r in src.get_daily_metrics(ids, date(2026, 8, 1), date(2026, 8, 31))
    }
    sub = src.get_daily_metrics(ids, date(2026, 8, 10), date(2026, 8, 12))
    assert sub
    for r in sub:
        assert full[(r.ad_external_id, r.date)] == r


def test_download_media_writes_file(tmp_path: Path) -> None:
    src = SandboxSyntheticSource(seed=1, n_ads=12, media_dir=tmp_path)
    creative = src.get_creative(src.list_ads()[0].creative_external_id)
    media = src.download_media(creative)
    assert media.path.exists()
    assert media.size_bytes == media.path.stat().st_size
    assert media.content_type == (
        "video/mp4" if creative.type is CreativeType.VIDEO else "image/png"
    )


def test_ground_truth_covers_every_creative() -> None:
    src = SandboxSyntheticSource(seed=1, n_ads=12)
    truth = src.ground_truth_tags()
    assert set(truth) == {a.creative_external_id for a in src.list_ads()}
    assert all("format" in tags for tags in truth.values())
