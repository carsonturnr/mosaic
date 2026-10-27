from mosaic.evals import planted
from mosaic.evals.__main__ import regressions
from mosaic.evals.tagging import Labeled, score


def test_planted_eval_finds_everything_on_two_seeds() -> None:
    res = planted.run(seeds=(42, 7))
    assert res.metrics["all_found"] == 1.0
    assert res.metrics["fatigue_precision"] == 1.0


def test_regression_check() -> None:
    assert regressions({"a": 1.0, "b": 0.9}, {"a": 1.0, "b": 0.8}) == []
    assert regressions({"a": 0.5}, {"a": 1.0}) == ["a: 1.0 -> 0.5"]
    assert regressions({}, {"a": 1.0}) == ["a: 1.0 -> None"]


def test_tagging_f1() -> None:
    labels = [
        Labeled(creative_ref=str(i), tags={"hook_type": h, "format": "UGC"})
        for i, h in enumerate(["pain", "pain", "curiosity", "claim"])
    ]
    preds = [
        Labeled(creative_ref="0", tags={"hook_type": "Pain", "format": "UGC"}),
        Labeled(creative_ref="1", tags={"hook_type": "curiosity", "format": "ugc"}),
        Labeled(creative_ref="2", tags={"hook_type": "curiosity", "format": "UGC"}),
    ]
    by = {s.field: s for s in score(labels, preds)}
    assert by["format"].accuracy == 0.75  # ref 3 has no prediction
    assert by["hook_type"].accuracy == 0.5 and 0 < by["hook_type"].macro_f1 < 1
    assert "angle" not in by


def test_tagging_from_store_uses_best_real_prediction_and_lists_misses() -> None:
    from mosaic.evals.tagging import from_store
    from mosaic.store import MemoryStore

    store = MemoryStore()
    assert from_store(store) is None
    store.insert("creatives", {"id": "c1", "external_id": "ad1"})
    store.insert("creatives", {"id": "c2", "external_id": "ad2"})
    for cid, dim, value, conf, model in [
        ("c1", "format", "UGC", 0.9, "gemini-3.5-flash"),
        ("c1", "format", "talking head", 0.6, "gemini-3.5-flash-lite"),
        ("c1", "angle", "convenience", 0.8, "gemini-3.5-flash"),
        ("c2", "format", "static image", 1.0, "synthetic"),  # ground truth, not a prediction
    ]:
        store.insert(
            "creative_tags",
            {
                "creative_id": cid,
                "dimension_key": dim,
                "value": value,
                "confidence": conf,
                "source": "ai",
                "model": model,
            },
        )
    store.insert(
        "creative_tags",
        {
            "creative_id": "c1",
            "dimension_key": "angle",
            "value": "price/value",
            "confidence": None,
            "source": "user",
        },
    )
    for cid, dim, value in [
        ("c1", "format", "UGC"),
        ("c1", "angle", "social proof"),
        ("c2", "format", "static image"),
    ]:
        store.insert("tag_labels", {"creative_id": cid, "dimension_key": dim, "value": value})

    t = from_store(store)
    assert t is not None and t.ads == 2
    by = {s.field: s for s in t.scores}
    assert by["format"].accuracy == 0.5  # ad2's only tag is synthetic, so it counts as a miss
    assert by["angle"].accuracy == 0.0
    assert {(d.creative_ref, d.field, d.predicted) for d in t.disagreements} == {
        ("ad1", "angle", "convenience"),
        ("ad2", "format", None),
    }
    assert t.metrics["ads"] == 2 and t.metrics["format_accuracy"] == 0.5
