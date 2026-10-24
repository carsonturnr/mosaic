"""Planted-problem eval: does the analysis surface every pattern planted in synthetic data?"""

from __future__ import annotations

from pydantic import BaseModel

from mosaic.analytics.clusters import CreativeInput, cluster
from mosaic.analytics.compute import analyze
from mosaic.analytics.synthetic_input import inputs_from_synthetic
from mosaic.synthetic.generator import SyntheticAccount

SEEDS = (1, 5, 7, 11, 42, 99, 123, 2024)


class SeedResult(BaseModel):
    seed: int
    winning_hook: bool
    fatigue_recall: float
    fatigue_precision: float
    hidden_winner: bool
    static_vs_video: bool
    near_duplicates: float  # share of planted pairs placed in one concept


class PlantedEval(BaseModel):
    seeds: list[SeedResult]
    metrics: dict[str, float]


def run_seed(seed: int) -> SeedResult:
    acc = SyntheticAccount(seed=seed)
    snap = analyze(inputs_from_synthetic(acc), acc.start_date, acc.end_date)
    key = {p.kind: p for p in acc.patterns}

    winners = sorted(
        (r for r in snap.tags["hook_type"] if r.verdict["ctr"] == "winner"),
        key=lambda r: -(r.kpis["ctr"].value or 0),
    )
    found_fatigue = {f.ad_id for f in snap.fatigue}
    planted_fatigue = set(key["fatigue"].ad_external_ids)
    ct = {r.value: r.kpis["ctr"] for r in snap.tags["creative_type"]}
    svv = (ct["video"].low or 0) > (ct["static"].high or 1)

    spend = {a.external_id: a.totals.spend for a in snap.ads}
    items = [
        CreativeInput(
            s.creative.external_id,
            s.tags,
            f"{s.creative.headline} {s.creative.primary_text}",
            spend.get(s.ad.external_id, 0.0),
        )
        for s in acc.ads
    ]
    where = {cid: i for i, c in enumerate(cluster(items).clusters) for cid in c.creative_ids}
    pairs = [p.creative_external_ids for p in acc.patterns if p.kind == "near_duplicate"]
    together = sum(where[a] == where[b] for a, b in pairs) / len(pairs) if pairs else 1.0

    return SeedResult(
        seed=seed,
        winning_hook=bool(winners) and winners[0].value == acc.winning_hook,
        fatigue_recall=len(found_fatigue & planted_fatigue) / len(planted_fatigue),
        fatigue_precision=len(found_fatigue & planted_fatigue) / len(found_fatigue)
        if found_fatigue
        else 0.0,
        hidden_winner=set(key["hidden_winner"].ad_external_ids)
        <= {u.ad_id for u in snap.underfunded},
        static_vs_video=svv,
        near_duplicates=together,
    )


def run(seeds: tuple[int, ...] = SEEDS) -> PlantedEval:
    results = [run_seed(s) for s in seeds]
    n = len(results)
    metrics = {
        "winning_hook": sum(r.winning_hook for r in results) / n,
        "fatigue_recall": sum(r.fatigue_recall for r in results) / n,
        "fatigue_precision": sum(r.fatigue_precision for r in results) / n,
        "hidden_winner": sum(r.hidden_winner for r in results) / n,
        "static_vs_video": sum(r.static_vs_video for r in results) / n,
        "near_duplicates": sum(r.near_duplicates for r in results) / n,
    }
    metrics["all_found"] = (
        sum(
            r.winning_hook
            and r.fatigue_recall == 1
            and r.hidden_winner
            and r.static_vs_video
            and r.near_duplicates == 1
            for r in results
        )
        / n
    )
    return PlantedEval(seeds=results, metrics={k: round(v, 4) for k, v in metrics.items()})
