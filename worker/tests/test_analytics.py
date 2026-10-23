"""The analysis must surface every planted pattern, on any seed (docs/ARCHITECTURE.md §12)."""

from datetime import date, timedelta

import pytest

from mosaic.analytics.compute import AdInput, Day, Est, analyze, verdict
from mosaic.analytics.synthetic_input import inputs_from_synthetic
from mosaic.synthetic.generator import SyntheticAccount

SEEDS = [1, 5, 7, 11, 42, 99, 123, 2024]


def snap_for(seed: int):  # noqa: ANN201
    acc = SyntheticAccount(seed=seed)
    return acc, analyze(inputs_from_synthetic(acc), acc.start_date, acc.end_date)


@pytest.mark.parametrize("seed", SEEDS)
def test_winning_hook_is_the_top_ctr_winner(seed: int) -> None:
    acc, snap = snap_for(seed)
    winners = sorted(
        (r for r in snap.tags["hook_type"] if r.verdict["ctr"] == "winner"),
        key=lambda r: -(r.kpis["ctr"].value or 0),
    )
    assert winners and winners[0].value == acc.winning_hook
    # other hooks can clear the bar on some seeds, but never by as much
    assert len(winners) <= 2


@pytest.mark.parametrize("seed", SEEDS)
def test_fatigue_and_hidden_winner_are_found(seed: int) -> None:
    acc, snap = snap_for(seed)
    key = {p.kind: p for p in acc.patterns}
    assert {f.ad_id for f in snap.fatigue} == set(key["fatigue"].ad_external_ids)
    assert set(key["hidden_winner"].ad_external_ids) <= {u.ad_id for u in snap.underfunded}


@pytest.mark.parametrize("seed", SEEDS)
def test_video_beats_static_on_ctr_with_separated_intervals(seed: int) -> None:
    _, snap = snap_for(seed)
    ct = {r.value: r.kpis["ctr"] for r in snap.tags["creative_type"]}
    assert ct["video"].low is not None and ct["static"].high is not None
    assert ct["video"].low > ct["static"].high


def test_totals_reconcile_and_window_is_respected() -> None:
    acc, snap = snap_for(42)
    assert round(sum(a.totals.spend for a in snap.ads), 2) == pytest.approx(
        snap.account.spend, abs=0.05
    )
    since = acc.end_date - timedelta(days=6)
    week = analyze(inputs_from_synthetic(acc), since, acc.end_date)
    assert week.account.spend < snap.account.spend
    for pts in week.trends["creative_type"].values():
        assert all(p.week >= since - timedelta(days=6) for p in pts)


def test_low_data_tags_rank_last_and_are_never_winners() -> None:
    d0 = date(2026, 10, 1)

    def ad(i: str, hook: str, imp: int, clicks: int, spend: float) -> AdInput:
        return AdInput(
            i,
            i,
            i,
            "video",
            None,
            {"hook_type": hook},
            [
                Day(
                    d0,
                    spend=spend,
                    impressions=imp,
                    clicks=clicks,
                    link_clicks=clicks,
                    purchases=clicks / 20,
                    purchase_value=clicks * 3,
                    video_3s_views=imp // 4,
                    video_thruplays=imp // 10,
                )
            ],
        )

    ads = [
        ad("a", "big", 200_000, 2_000, 2_000),
        ad("b", "big", 180_000, 1_900, 1_800),
        ad("c", "tiny", 300, 30, 20),
    ]  # 10% CTR on 300 impressions
    snap = analyze(ads, d0, d0)
    rows = snap.tags["hook_type"]
    assert rows[-1].value == "tiny" and rows[-1].verdict["ctr"] == "low_data"
    assert all(v != "winner" for v in rows[-1].verdict.values())


def test_verdict_needs_both_significance_and_lift() -> None:
    tight_small = Est(value=1.04, low=1.03, high=1.05, raw=1.04)
    assert verdict(tight_small, 1.0, "roas", False) == "neutral"  # significant, but only +4%
    clear = Est(value=1.4, low=1.2, high=1.6, raw=1.4)
    assert verdict(clear, 1.0, "roas", False) == "winner"
    assert (
        verdict(Est(value=40, low=35, high=45, raw=40), 60.0, "cpa", False) == "winner"
    )  # lower CPA wins
    assert verdict(clear, 1.0, "roas", True) == "low_data"
