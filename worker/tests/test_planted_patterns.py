"""Each planted pattern must be recoverable from the metrics (docs/ARCHITECTURE.md §12)."""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

import pytest

from mosaic.models import AdDailyMetric
from mosaic.synthetic.generator import SyntheticAccount


@pytest.fixture(scope="module")
def account() -> SyntheticAccount:
    return SyntheticAccount(seed=42, n_ads=24, days=90)


@pytest.fixture(scope="module")
def rows(account: SyntheticAccount) -> list[AdDailyMetric]:
    ids = [s.ad.external_id for s in account.ads]
    return account.daily_metrics(ids, account.start_date, account.end_date)


def _ctr(rows: list[AdDailyMetric]) -> float:
    imp = sum(r.impressions for r in rows)
    return sum(r.clicks or 0 for r in rows) / imp if imp else 0.0


def _by_ad(rows: list[AdDailyMetric]) -> dict[str, list[AdDailyMetric]]:
    out: dict[str, list[AdDailyMetric]] = defaultdict(list)
    for r in rows:
        out[r.ad_external_id].append(r)
    return out


def _pattern(account: SyntheticAccount, kind: str):  # noqa: ANN202
    return [p for p in account.patterns if p.kind == kind]


def test_answer_key_round_trips(account: SyntheticAccount) -> None:
    key = account.answer_key()
    assert set(key.ground_truth_tags) == {s.creative.external_id for s in account.ads}
    assert {p.kind for p in key.patterns} == {
        "winning_hook",
        "fatigue",
        "near_duplicate",
        "static_vs_video",
        "hidden_winner",
    }
    assert key == type(key).model_validate_json(key.model_dump_json())


def test_winning_hook_beats_others(account: SyntheticAccount, rows: list[AdDailyMetric]) -> None:
    (p,) = _pattern(account, "winning_hook")
    winners = set(p.ad_external_ids)
    assert winners
    video = {s.ad.external_id for s in account.ads if "hook_type" in s.tags}
    win_rows = [r for r in rows if r.ad_external_id in winners]
    other_rows = [r for r in rows if r.ad_external_id in video - winners]
    assert _ctr(win_rows) > _ctr(other_rows) * 1.25


def test_fatigue_ads_decay(account: SyntheticAccount, rows: list[AdDailyMetric]) -> None:
    (p,) = _pattern(account, "fatigue")
    by_ad = _by_ad(rows)
    for ad_id in p.ad_external_ids:
        r = sorted(by_ad[ad_id], key=lambda x: x.date)
        first, last = r[:14], r[-14:]
        assert _ctr(last) < _ctr(first) * 0.7
        hook_first = sum(x.video_3s_views or 0 for x in first) / sum(x.impressions for x in first)
        hook_last = sum(x.video_3s_views or 0 for x in last) / sum(x.impressions for x in last)
        assert hook_last < hook_first * 0.7


def test_hidden_winner_low_spend_high_ctr(
    account: SyntheticAccount, rows: list[AdDailyMetric]
) -> None:
    (p,) = _pattern(account, "hidden_winner")
    (ad_id,) = p.ad_external_ids
    by_ad = _by_ad(rows)
    spend = {k: sum(r.spend for r in v) for k, v in by_ad.items()}
    total = sum(spend.values())
    assert spend[ad_id] / total < 0.03
    rest = [r for r in rows if r.ad_external_id != ad_id]
    assert _ctr(by_ad[ad_id]) > _ctr(rest) * 1.3


def test_static_vs_video_gap(account: SyntheticAccount, rows: list[AdDailyMetric]) -> None:
    (p,) = _pattern(account, "static_vs_video")
    static = set(p.ad_external_ids)
    s_rows = [r for r in rows if r.ad_external_id in static]
    v_rows = [r for r in rows if r.ad_external_id not in static]
    assert _ctr(v_rows) > _ctr(s_rows)
    assert all(r.video_3s_views is None for r in s_rows)
    assert all(r.video_3s_views is not None for r in v_rows)
    cpm = lambda rs: sum(r.spend for r in rs) * 1000 / sum(r.impressions for r in rs)  # noqa: E731
    assert cpm(s_rows) < cpm(v_rows)


def test_near_duplicates_share_tags_and_perform_alike(
    account: SyntheticAccount, rows: list[AdDailyMetric]
) -> None:
    pairs = _pattern(account, "near_duplicate")
    assert len(pairs) == 2
    by_ad = _by_ad(rows)
    for p in pairs:
        a, b = (account.ad_by_external_id(i) for i in p.ad_external_ids)
        assert a.tags == b.tags
        assert a.creative.primary_text == b.creative.primary_text
        assert b.duplicate_of == a.ad.external_id
        ca, cb = _ctr(by_ad[a.ad.external_id]), _ctr(by_ad[b.ad.external_id])
        assert abs(ca - cb) / max(ca, cb) < 0.25


def test_spend_is_concentrated(rows: list[AdDailyMetric]) -> None:
    spend = sorted((sum(r.spend for r in v) for v in _by_ad(rows).values()), reverse=True)
    top3 = sum(spend[:3]) / sum(spend)
    assert top3 > 0.4


def test_metrics_independent_of_window(account: SyntheticAccount) -> None:
    ids = [s.ad.external_id for s in account.ads]
    mid = account.start_date + timedelta(days=40)
    full = {
        (r.ad_external_id, r.date): r
        for r in account.daily_metrics(ids, account.start_date, account.end_date)
    }
    for r in account.daily_metrics(ids, mid, mid + timedelta(days=3)):
        assert full[(r.ad_external_id, r.date)] == r


@pytest.mark.parametrize("seed", [1, 5, 7, 42, 99, 123, 2024])
def test_winning_hook_is_always_planted(seed: int) -> None:
    acc = SyntheticAccount(seed=seed)
    carriers = [s for s in acc.ads if s.tags.get("hook_type") == acc.winning_hook]
    assert len(carriers) >= 3
    assert all(acc.winning_hook in s.ad.name for s in carriers)
