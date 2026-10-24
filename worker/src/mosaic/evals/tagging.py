"""Tagging accuracy: AI tags vs hand labels, per-field F1 (docs/ARCHITECTURE.md §12).

Labels live in evals/labels/*.json (kept out of git while they reference real brands):
    {"creative_ref": "...", "tags": {"hook_type": "problem/pain", "format": "UGC", ...}}
Predictions use the same shape. Single-label fields, so per-field F1 is the macro F1
over the values seen in labels or predictions.
"""

from __future__ import annotations

from collections import defaultdict

from pydantic import BaseModel

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
