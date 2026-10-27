"""Tagging accuracy: AI tags vs hand labels, per-field F1 (docs/ARCHITECTURE.md §12).

Hand labels live in the tag_labels table (owner-only, written from the blind Label page)
and never in git, since they reference real brands' ads. `score` compares two lists of
{"creative_ref": "...", "tags": {"hook_type": "problem/pain", "format": "UGC", ...}}.
Single-label fields, so per-field F1 is the macro F1 over the values seen in labels or
predictions.
"""

from __future__ import annotations

from collections import defaultdict

from pydantic import BaseModel

from mosaic.store import Store

FIELDS = ("hook_type", "angle", "format", "offer", "proof_type", "cta")


class Labeled(BaseModel):
    creative_ref: str
    tags: dict[str, str]


class FieldScore(BaseModel):
    field: str
    n: int
    accuracy: float
    macro_f1: float


def _norm(v: str | None) -> str | None:
    return v.strip().lower() if v else None


def score(labels: list[Labeled], predictions: list[Labeled]) -> list[FieldScore]:
    pred = {p.creative_ref: p.tags for p in predictions}
    out = []
    for f in FIELDS:
        pairs = [
            (_norm(lab.tags.get(f)), _norm(pred.get(lab.creative_ref, {}).get(f)))
            for lab in labels
            if lab.tags.get(f)
        ]
        if not pairs:
            continue
        tp: dict[str, int] = defaultdict(int)
        fp: dict[str, int] = defaultdict(int)
        fn: dict[str, int] = defaultdict(int)
        for truth, guess in pairs:
            if truth == guess:
                tp[truth] += 1  # type: ignore[index]
            else:
                fn[truth] += 1  # type: ignore[index]
                if guess is not None:
                    fp[guess] += 1
        classes = {t for t, _ in pairs} | {g for _, g in pairs if g}
        f1s = []
        for c in classes:
            p = tp[c] / (tp[c] + fp[c]) if tp[c] + fp[c] else 0.0
            r = tp[c] / (tp[c] + fn[c]) if tp[c] + fn[c] else 0.0
            f1s.append(2 * p * r / (p + r) if p + r else 0.0)
        out.append(
            FieldScore(
                field=f,
                n=len(pairs),
                accuracy=round(sum(tp.values()) / len(pairs), 4),
                macro_f1=round(sum(f1s) / len(f1s), 4),
            )
        )
    return out


class Disagreement(BaseModel):
    creative_ref: str
    field: str
    label: str
    predicted: str | None


class TaggingResult(BaseModel):
    ads: int
    scores: list[FieldScore]
    disagreements: list[Disagreement]

    @property
    def metrics(self) -> dict[str, float]:
        """Flat numbers for eval_runs: per-field accuracy and F1, plus the mean F1."""
        out: dict[str, float] = {"ads": float(self.ads)}
        for s in self.scores:
            out[f"{s.field}_accuracy"] = s.accuracy
            out[f"{s.field}_f1"] = s.macro_f1
        if self.scores:
            out["mean_f1"] = round(sum(s.macro_f1 for s in self.scores) / len(self.scores), 4)
        return out


def from_store(store: Store) -> TaggingResult | None:
    """Score AI tags against every hand label in tag_labels; None when nothing is labeled.

    The prediction for a field is the most confident AI tag from a real model (synthetic
    ground truth is not a prediction). Labels never feed the analysis, so this stays blind.
    """
    rows = store.select("tag_labels", "creative_id,dimension_key,value")
    if not rows:
        return None
    by_creative: dict[str, dict[str, str]] = defaultdict(dict)
    for r in rows:
        by_creative[r["creative_id"]][r["dimension_key"]] = r["value"]
    ids = list(by_creative)
    refs = {c["id"]: c["external_id"] for c in store.select("creatives", "id,external_id", id=ids)}
    best: dict[str, dict[str, tuple[float, str]]] = defaultdict(dict)
    for t in store.select(
        "creative_tags",
        "creative_id,dimension_key,value,confidence,model",
        creative_id=ids,
        source="ai",
    ):
        if t.get("model") == "synthetic":
            continue
        conf = float(t.get("confidence") or 0)
        prev = best[t["creative_id"]].get(t["dimension_key"])
        if prev is None or conf > prev[0]:
            best[t["creative_id"]][t["dimension_key"]] = (conf, t["value"])
    labels = [Labeled(creative_ref=refs.get(c, c), tags=tags) for c, tags in by_creative.items()]
    preds = [
        Labeled(creative_ref=refs.get(c, c), tags={k: v for k, (_, v) in best[c].items()})
        for c in ids
    ]
    pred_of = {p.creative_ref: p.tags for p in preds}
    disagreements = [
        Disagreement(
            creative_ref=lab.creative_ref,
            field=f,
            label=v,
            predicted=pred_of[lab.creative_ref].get(f),
        )
        for lab in sorted(labels, key=lambda x: x.creative_ref)
        for f, v in lab.tags.items()
        if f in FIELDS and _norm(v) != _norm(pred_of[lab.creative_ref].get(f))
    ]
    return TaggingResult(ads=len(labels), scores=score(labels, preds), disagreements=disagreements)
