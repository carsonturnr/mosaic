"""Turn per-ad daily rows into the analysis snapshot the app and agents read.

Everything here is pure: `analyze(ads, since, until)` in, `Snapshot` out.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field
from scipy import stats as sps

from mosaic.analytics.stats import (
    Estimate,
    fit_beta_prior,
    fit_gamma_prior,
    robust_z,
    shrink_cpa,
    shrink_rate,
    shrink_roas,
)

Metric = Literal["roas", "cpa", "ctr", "hook_rate", "hold_rate", "cvr"]
METRICS: tuple[Metric, ...] = ("roas", "cpa", "ctr", "hook_rate", "hold_rate", "cvr")
LOWER_IS_BETTER: frozenset[str] = frozenset({"cpa"})

# Below these an ad or tag value is "low data": shown, never called a winner.
MIN_IMPRESSIONS = 5_000
MIN_SPEND = 100.0
# Statistical significance is not enough on big accounts: a winner must also be
# meaningfully better than the reference.
MIN_LIFT = 0.10
UNDERFUNDED_LIFT = 0.30
UNDERFUNDED_MAX_SHARE = 0.03
TAG_DIMENSIONS = (
    "hook_type",
    "angle",
    "format",
    "offer",
    "proof_type",
    "persona",
    "cta",
    "length_bucket",
)


# --------------------------------------------------------------------------- input


@dataclass(frozen=True)
class Day:
    date: date
    spend: float = 0.0
    impressions: int = 0
    clicks: int = 0
    link_clicks: int = 0
    purchases: float = 0.0
    purchase_value: float = 0.0
    video_3s_views: int | None = None
    video_thruplays: int | None = None


@dataclass(frozen=True)
class AdInput:
    ad_id: str
    external_id: str
    name: str
    creative_type: str  # video | image | carousel
    objective: str | None
    tags: dict[str, str]
    days: list[Day] = field(default_factory=list)


# -------------------------------------------------------------------------- output


class Est(BaseModel):
    value: float | None
    low: float | None
    high: float | None
    raw: float | None

    @classmethod
    def of(cls, e: Estimate) -> Est:
        r = lambda v: None if v is None or not np.isfinite(v) else round(float(v), 6)  # noqa: E731
        return cls(value=r(e.value), low=r(e.low), high=r(e.high), raw=r(e.raw))


class Totals(BaseModel):
    spend: float = 0.0
    impressions: int = 0
    clicks: int = 0
    link_clicks: int = 0
    purchases: float = 0.0
    purchase_value: float = 0.0
    video_3s_views: int = 0
    video_thruplays: int = 0
    video_impressions: int = 0  # impressions on ads that report video views


class AdStats(BaseModel):
    ad_id: str
    external_id: str
    name: str
    creative_type: str
    format: str | None
    hook_type: str | None
    totals: Totals
    kpis: dict[str, Est]
    spend_share: float
    low_data: bool
    flags: list[str] = Field(
        default_factory=list
    )  # winner | loser | underfunded | fatigue | outlier_high | outlier_low


class TagValueStats(BaseModel):
    value: str  # compared against the totals of all ads that carry this dimension
    n_ads: int
    ad_ids: list[str]
    totals: Totals
    spend_share: float
    kpis: dict[str, Est]
    verdict: dict[str, Literal["winner", "loser", "neutral", "low_data"]]


class WeekPoint(BaseModel):
    week: date  # Monday
    spend: float
    impressions: int
    roas: float | None
    ctr: float | None
    hook_rate: float | None


class Outlier(BaseModel):
    ad_id: str
    metric: Metric
    z: float
    direction: Literal["high", "low"]
    peer_group: str
    value: float


class Fatigue(BaseModel):
    ad_id: str
    metric: Literal["ctr", "hook_rate"]
    early: float
    late: float
    change: float  # relative, negative = decline
    p_value: float


class Underfunded(BaseModel):
    ad_id: str
    metric: Metric
    low: float
    account: float
    spend_share: float


class Snapshot(BaseModel):
    since: date
    until: date
    account: Totals
    account_kpis: dict[str, float | None]
    ads: list[AdStats]
    tags: dict[str, list[TagValueStats]]
    trends: dict[str, dict[str, list[WeekPoint]]]
    outliers: list[Outlier]
    fatigue: list[Fatigue]
    underfunded: list[Underfunded]


# ------------------------------------------------------------------------- helpers


def totals_of(days: Iterable[Day]) -> Totals:
    t = Totals()
    for d in days:
        t.spend += d.spend
        t.impressions += d.impressions
        t.clicks += d.clicks
        t.link_clicks += d.link_clicks
        t.purchases += d.purchases
        t.purchase_value += d.purchase_value
        if d.video_3s_views is not None:
            t.video_3s_views += d.video_3s_views
            t.video_thruplays += d.video_thruplays or 0
            t.video_impressions += d.impressions
    t.spend = round(t.spend, 2)
    t.purchase_value = round(t.purchase_value, 2)
    return t


def merge(ts: Iterable[Totals]) -> Totals:
    out = Totals()
    for t in ts:
        for k in Totals.model_fields:
            setattr(out, k, getattr(out, k) + getattr(t, k))
    out.spend = round(out.spend, 2)
    out.purchase_value = round(out.purchase_value, 2)
    return out


# (successes, trials) for each rate metric
RATE_PARTS: dict[str, Callable[[Totals], tuple[float, float]]] = {
    "ctr": lambda t: (t.clicks, t.impressions),
    "hook_rate": lambda t: (t.video_3s_views, t.video_impressions),
    "hold_rate": lambda t: (t.video_thruplays, t.video_3s_views),
    "cvr": lambda t: (t.purchases, t.link_clicks),
}


@dataclass(frozen=True)
class Priors:
    rate: dict[str, object]
    conv: object
    aov: float | None


def fit_priors(ad_totals: list[Totals]) -> Priors:
    rate = {}
    for m, parts in RATE_PARTS.items():
        pairs = [parts(t) for t in ad_totals]
        rate[m] = fit_beta_prior([p[0] for p in pairs], [p[1] for p in pairs])
    conv = fit_gamma_prior([t.purchases for t in ad_totals], [t.spend for t in ad_totals])
    total_p = sum(t.purchases for t in ad_totals)
    aov = sum(t.purchase_value for t in ad_totals) / total_p if total_p > 0 else None
    return Priors(rate=rate, conv=conv, aov=aov)


def estimates(t: Totals, priors: Priors) -> dict[str, Est]:
    out: dict[str, Est] = {}
    for m, parts in RATE_PARTS.items():
        s, n = parts(t)
        out[m] = Est.of(shrink_rate(s, n, priors.rate[m]))  # type: ignore[arg-type]
    out["cpa"] = Est.of(shrink_cpa(t.purchases, t.spend, priors.conv))  # type: ignore[arg-type]
    out["roas"] = Est.of(
        shrink_roas(t.purchases, t.spend, t.purchase_value, priors.conv, priors.aov)
    )  # type: ignore[arg-type]
    return out


def account_kpis(t: Totals) -> dict[str, float | None]:
    div = lambda a, b: round(a / b, 6) if b else None  # noqa: E731
    return {
        "roas": div(t.purchase_value, t.spend),
        "cpa": div(t.spend, t.purchases),
        "ctr": div(t.clicks, t.impressions),
        "hook_rate": div(t.video_3s_views, t.video_impressions),
        "hold_rate": div(t.video_thruplays, t.video_3s_views),
        "cvr": div(t.purchases, t.link_clicks),
    }


def verdict(
    est: Est, account: float | None, metric: str, low_data: bool
) -> Literal["winner", "loser", "neutral", "low_data"]:
    """Winner only when the whole interval is on the good side of the account value
    and the estimate is at least MIN_LIFT better."""
    if low_data:
        return "low_data"
    if account is None or account == 0 or est.low is None or est.high is None or est.value is None:
        return "neutral"
    lift = (est.value - account) / account
    if metric in LOWER_IS_BETTER:
        lift = -lift
        better, worse = est.high < account, est.low > account
    else:
        better, worse = est.low > account, est.high < account
    if better and lift >= MIN_LIFT:
        return "winner"
    if worse and lift <= -MIN_LIFT:
        return "loser"
    return "neutral"


def is_low(t: Totals) -> bool:
    return t.impressions < MIN_IMPRESSIONS or t.spend < MIN_SPEND


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


# ------------------------------------------------------------------------ analysis


def analyze(ads: list[AdInput], since: date, until: date) -> Snapshot:
    windowed = [
        AdInput(
            a.ad_id,
            a.external_id,
            a.name,
            a.creative_type,
            a.objective,
            a.tags,
            [d for d in a.days if since <= d.date <= until],
        )
        for a in ads
    ]
    ad_totals = {a.ad_id: totals_of(a.days) for a in windowed}
    account = merge(ad_totals.values())
    acct = account_kpis(account)
    priors = fit_priors(list(ad_totals.values()))

    # ---- per ad
    ad_stats: dict[str, AdStats] = {}
    for a in windowed:
        t = ad_totals[a.ad_id]
        if t.impressions == 0 and t.spend == 0:
            continue
        kpis = estimates(t, priors)
        low = is_low(t)
        flags = []
        v = verdict(kpis["roas"], acct["roas"], "roas", low)
        if v in ("winner", "loser"):
            flags.append(v)
        ad_stats[a.ad_id] = AdStats(
            ad_id=a.ad_id,
            external_id=a.external_id,
            name=a.name,
            creative_type=a.creative_type,
            format=a.tags.get("format"),
            hook_type=a.tags.get("hook_type"),
            totals=t,
            kpis=kpis,
            spend_share=round(t.spend / account.spend, 6) if account.spend else 0.0,
            low_data=low,
            flags=flags,
        )

    # ---- tags (+ creative type for static vs video)
    by_dim: dict[str, dict[str, list[AdInput]]] = defaultdict(lambda: defaultdict(list))
    for a in windowed:
        if a.ad_id not in ad_stats:
            continue
        by_dim["creative_type"]["static" if a.creative_type != "video" else "video"].append(a)
        for dim in TAG_DIMENSIONS:
            if dim in a.tags:
                by_dim[dim][a.tags[dim]].append(a)

    tags: dict[str, list[TagValueStats]] = {}
    for dim, groups in by_dim.items():
        # Compare each value with the ads that carry this dimension (hooks exist only on
        # video, so comparing them with an account that includes statics would flatter them).
        dim_ref = account_kpis(
            merge(ad_totals[m.ad_id] for members in groups.values() for m in members)
        )
        rows = []
        for value, members in groups.items():
            t = merge(ad_totals[m.ad_id] for m in members)
            kpis = estimates(t, priors)
            low = is_low(t)
            rows.append(
                TagValueStats(
                    value=value,
                    n_ads=len(members),
                    ad_ids=sorted(m.ad_id for m in members),
                    totals=t,
                    spend_share=round(t.spend / account.spend, 6) if account.spend else 0.0,
                    kpis=kpis,
                    verdict={m: verdict(kpis[m], dim_ref[m], m, low) for m in METRICS},
                )
            )
        # low-data values go last so a single lucky ad never tops a ranking
        rows.sort(key=lambda r: (r.verdict["roas"] == "low_data", -(r.kpis["roas"].value or 0)))
        tags[dim] = rows

    # ---- weekly trends per tag value
    trends: dict[str, dict[str, list[WeekPoint]]] = {}
    for dim, groups in by_dim.items():
        trends[dim] = {}
        for value, members in groups.items():
            weeks: dict[date, list[Day]] = defaultdict(list)
            for m in members:
                for d in m.days:
                    weeks[monday(d.date)].append(d)
            pts = []
            for wk in sorted(weeks):
                t = totals_of(weeks[wk])
                k = account_kpis(t)
                pts.append(
                    WeekPoint(
                        week=wk,
                        spend=t.spend,
                        impressions=t.impressions,
                        roas=k["roas"],
                        ctr=k["ctr"],
                        hook_rate=k["hook_rate"],
                    )
                )
            trends[dim][value] = pts

    # ---- outliers: robust z of shrunk KPI within peer group (format + objective);
    # ads whose peer group has fewer than 5 members are compared to the whole account.
    outliers: list[Outlier] = []
    eligible = [s for s in ad_stats.values() if not s.low_data]
    objective = {a.ad_id: a.objective or "any" for a in windowed}
    for metric in ("roas", "ctr", "hook_rate"):
        scored = [s for s in eligible if s.kpis[metric].value is not None]
        groups: dict[str, list[AdStats]] = defaultdict(list)
        for st in scored:
            groups[f"{st.format or st.creative_type} · {objective[st.ad_id]}"].append(st)
        for label, members in groups.items():
            pool, group = (members, label) if len(members) >= 5 else (scored, "account")
            zs = dict(
                zip(
                    (m.ad_id for m in pool),
                    robust_z([m.kpis[metric].value or 0.0 for m in pool]),
                    strict=True,
                )
            )
            for m in members:
                z = zs[m.ad_id]
                if z is not None and abs(z) >= 2:
                    outliers.append(
                        Outlier(
                            ad_id=m.ad_id,
                            metric=metric,
                            z=round(z, 2),
                            direction="high" if z > 0 else "low",
                            peer_group=group,
                            value=m.kpis[metric].value or 0.0,
                        )
                    )
    for o in outliers:
        flag = f"outlier_{o.direction}"
        if flag not in ad_stats[o.ad_id].flags:
            ad_stats[o.ad_id].flags.append(flag)

    # ---- fatigue: early vs late within the ad's own run
    fatigue: list[Fatigue] = []
    for a in windowed:
        if a.ad_id not in ad_stats or len(a.days) < 28:
            continue
        days = sorted(a.days, key=lambda d: d.date)
        early, late = totals_of(days[:14]), totals_of(days[-14:])
        for metric in ("ctr", "hook_rate"):
            (s1, n1), (s2, n2) = RATE_PARTS[metric](early), RATE_PARTS[metric](late)
            if min(n1, n2) < 10_000 or s1 == 0:
                continue
            p1, p2 = s1 / n1, s2 / n2
            pooled = (s1 + s2) / (n1 + n2)
            se = (pooled * (1 - pooled) * (1 / n1 + 1 / n2)) ** 0.5
            if se == 0:
                continue
            p = float(sps.norm.sf((p1 - p2) / se))  # one-sided: did it drop?
            change = (p2 - p1) / p1
            if change <= -0.25 and p < 0.01:
                fatigue.append(
                    Fatigue(
                        ad_id=a.ad_id,
                        metric=metric,
                        early=round(p1, 6),
                        late=round(p2, 6),
                        change=round(change, 4),
                        p_value=p,
                    )
                )
                if "fatigue" not in ad_stats[a.ad_id].flags:
                    ad_stats[a.ad_id].flags.append("fatigue")

    # ---- underfunded winners: clearly better than ads of the same type, on little spend
    underfunded: list[Underfunded] = []
    by_type: dict[str, dict[str, float | None]] = {}
    for kind in ("video", "static"):
        members = [
            ad_totals[a.ad_id]
            for a in windowed
            if a.ad_id in ad_stats and ("video" if a.creative_type == "video" else "static") == kind
        ]
        by_type[kind] = account_kpis(merge(members))
    for st in ad_stats.values():
        if st.spend_share >= UNDERFUNDED_MAX_SHARE or st.totals.impressions < 2_000:
            continue
        ref_kpis = by_type["video" if st.creative_type == "video" else "static"]
        for metric in ("ctr", "roas"):
            e, ref = st.kpis[metric], ref_kpis[metric]
            if e.low is None or e.value is None or not ref:
                continue
            if e.low > ref and (e.value - ref) / ref >= UNDERFUNDED_LIFT:
                underfunded.append(
                    Underfunded(
                        ad_id=st.ad_id,
                        metric=metric,
                        low=e.low,
                        account=ref,
                        spend_share=st.spend_share,
                    )
                )
                if "underfunded" not in st.flags:
                    st.flags.append("underfunded")

    return Snapshot(
        since=since,
        until=until,
        account=account,
        account_kpis=acct,
        ads=sorted(ad_stats.values(), key=lambda s: -s.totals.spend),
        tags=tags,
        trends=trends,
        outliers=outliers,
        fatigue=fatigue,
        underfunded=underfunded,
    )
