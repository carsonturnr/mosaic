"""Grounding validator (docs/ARCHITECTURE.md §10).

Before a report is saved, every cited ad must exist in the workspace and every cited
number must match the analysis within rounding.
"""

from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel

from mosaic.agents.report import MetricCite
from mosaic.analytics.compute import Snapshot

REL_TOL = 0.01  # 1% relative, or the rounding the model applied, whichever is looser


class Problem(BaseModel):
    section: str
    claim: str
    issue: str


class GroundingResult(BaseModel):
    passed: bool
    checked_numbers: int
    checked_ads: int
    problems: list[Problem]


def _decimals(x: float) -> int:
    s = f"{x:.10f}".rstrip("0")
    return len(s.split(".")[1]) if "." in s else 0


def matches(cited: float, truths: list[float]) -> bool:
    """Equal within 1% or equal after rounding the truth to the cited precision."""
    for t in truths:
        if t is None:
            continue
        if abs(cited - t) <= REL_TOL * max(abs(t), 1e-12):
            return True
        if round(t, _decimals(cited)) == round(cited, _decimals(cited)):
            return True
    return False


def truths_for(cite: MetricCite, snaps: dict[str, Snapshot]) -> list[float] | str:
    """Acceptable true values for a citation, or an error string."""
    snap = snaps.get(cite.window)
    if snap is None:
        return f"window {cite.window} has no analysis"
    m = cite.metric
    if cite.entity == "account":
        if m in ("spend", "impressions", "purchases"):
            return [float(getattr(snap.account, m))]
        if m == "diversity":
            return [snap.concepts.diversity] if snap.concepts else "no concepts"
        v = snap.account_kpis.get(m)
        return [v] if v is not None else f"account has no {m}"
    if cite.entity == "concepts":
        return (
            [snap.concepts.diversity]
            if snap.concepts and m == "diversity"
            else "only diversity can be cited for concepts"
        )
    if cite.entity.startswith("ad:"):
        ref = cite.entity[3:]
        st = next((a for a in snap.ads if a.external_id == ref or a.ad_id == ref), None)
        if st is None:
            return f"ad {ref} has no delivery in window {cite.window}"
        if m in ("spend", "impressions", "purchases"):
            return [float(getattr(st.totals, m))]
        if m == "spend_share":
            return [st.spend_share]
        e = st.kpis.get(m)
        return [x for x in (e.value, e.raw) if x is not None] if e else f"ads have no {m}"
    if cite.entity.startswith("tag:") and "=" in cite.entity:
        dim, value = cite.entity[4:].split("=", 1)
        row = next((r for r in snap.tags.get(dim, []) if r.value == value), None)
        if row is None:
            return f"no tag {dim}={value} in window {cite.window}"
        if m in ("spend", "impressions", "purchases"):
            return [float(getattr(row.totals, m))]
        if m == "spend_share":
            return [row.spend_share]
        e = row.kpis.get(m)
        return [x for x in (e.value, e.raw) if x is not None] if e else f"tags have no {m}"
    return f'entity must be "ad:<ref>", "tag:<dimension>=<value>", "concepts" or "account", got {cite.entity!r}'


class Citable(Protocol):
    def citable(self) -> list[tuple[str, str, list[str], list[MetricCite]]]: ...


def validate(
    report: Citable, snaps: dict[str, Snapshot], workspace_ad_refs: set[str]
) -> GroundingResult:
    """report.citable() yields (section, text, ad_ids, metrics) for everything it asserts."""
    problems: list[Problem] = []
    n_numbers = n_ads = 0
    for section, text, ad_ids, metrics in report.citable():
        problems.extend(_check(section, text, ad_ids, metrics, snaps, workspace_ad_refs))
        n_numbers += len(metrics)
        n_ads += len(ad_ids)
    return GroundingResult(
        passed=not problems, checked_numbers=n_numbers, checked_ads=n_ads, problems=problems
    )


def _check(
    section: str,
    text: str,
    ad_ids: list[str],
    metrics: list[MetricCite],
    snaps: dict[str, Snapshot],
    refs: set[str],
) -> list[Problem]:
    out = []
    short = text[:80]
    for ad in ad_ids:
        if ad not in refs:
            out.append(
                Problem(
                    section=section, claim=short, issue=f"ad {ad} does not exist in this workspace"
                )
            )
    for cite in metrics:
        truths = truths_for(cite, snaps)
        if isinstance(truths, str):
            out.append(Problem(section=section, claim=short, issue=truths))
        elif not matches(cite.value, truths):
            shown = ", ".join(f"{t:.6g}" for t in truths)
            out.append(
                Problem(
                    section=section,
                    claim=short,
                    issue=f"{cite.entity} {cite.metric} ({cite.window}) cited {cite.value:g}, data says {shown}",
                )
            )
    return out
