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
