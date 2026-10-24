"""Typed, read-only tools over the analysis snapshots. Ads are referred to by their
external id (the "ad ref"), which is what reports cite."""

from __future__ import annotations

from typing import Any

from mosaic.analytics.compute import METRICS, AdStats, Snapshot

WINDOWS = ["7", "30", "90", "all"]
DIMENSIONS = [
    "hook_type",
    "angle",
    "format",
    "creative_type",
    "offer",
    "proof_type",
    "persona",
    "cta",
    "length_bucket",
]
METRIC_HELP = "roas, cpa, ctr, hook_rate, hold_rate or cvr"


def _r(v: float | None, n: int = 6) -> float | None:
    return None if v is None else round(float(v), n)


class SnapshotTools:
    def __init__(
        self, snapshots: dict[str, Snapshot], creative_of_ad: dict[str, str] | None = None
    ) -> None:
        self.snaps = snapshots
        self.creative_of_ad = creative_of_ad or {}

    # ---- helpers
    def snap(self, window: str) -> Snapshot:
        if window not in self.snaps:
            raise ValueError(f"no analysis for window {window!r}; available: {sorted(self.snaps)}")
        return self.snaps[window]

    def ref(self, st: AdStats) -> str:
        return st.external_id

    def find_ad(self, snap: Snapshot, ref: str) -> AdStats | None:
        return next((a for a in snap.ads if a.external_id == ref or a.ad_id == ref), None)

    def ad_summary(self, st: AdStats) -> dict[str, Any]:
        return {
            "ad": self.ref(st),
            "name": st.name,
            "type": st.creative_type,
            "format": st.format,
            "hook_type": st.hook_type,
            "spend": st.totals.spend,
            "spend_share": _r(st.spend_share),
            "impressions": st.totals.impressions,
            "purchases": st.totals.purchases,
            "roas": _r(st.kpis["roas"].value),
            "cpa": _r(st.kpis["cpa"].value),
            "ctr": _r(st.kpis["ctr"].value),
            "hook_rate": _r(st.kpis["hook_rate"].value),
            "low_data": st.low_data,
            "flags": st.flags,
        }

    # ---- tools
    def get_account_overview(self, window: str) -> dict[str, Any]:
        s = self.snap(window)
        return {
            "window": window,
            "since": str(s.since),
            "until": str(s.until),
            "spend": s.account.spend,
            "impressions": s.account.impressions,
            "purchases": s.account.purchases,
            **{k: _r(v) for k, v in s.account_kpis.items()},
            "ads_with_delivery": len(s.ads),
            "signals": {
                "fatigue": len({f.ad_id for f in s.fatigue}),
                "underfunded": len({u.ad_id for u in s.underfunded}),
                "outliers": len(s.outliers),
            },
            "diversity": s.concepts.diversity if s.concepts else None,
        }

    def get_tag_performance(self, dimension: str, metric: str, window: str) -> dict[str, Any]:
        s = self.snap(window)
        if metric not in METRICS:
            raise ValueError(f"metric must be {METRIC_HELP}")
        rows = s.tags.get(dimension)
        if rows is None:
            raise ValueError(f"no tags for dimension {dimension!r}; available: {sorted(s.tags)}")
        refs = {a.ad_id: a.external_id for a in s.ads}
        return {
            "dimension": dimension,
            "metric": metric,
            "window": window,
            "note": "value is the shrunk estimate; low/high is the 90% interval; verdict compares with ads carrying this dimension",
            "values": [
                {
                    "value": r.value,
                    "n_ads": r.n_ads,
                    "spend": r.totals.spend,
                    "spend_share": _r(r.spend_share),
                    "impressions": r.totals.impressions,
                    "purchases": r.totals.purchases,
                    "estimate": _r(r.kpis[metric].value),
                    "low": _r(r.kpis[metric].low),
                    "high": _r(r.kpis[metric].high),
                    "verdict": r.verdict[metric],
                    "ads": [refs.get(i, i) for i in r.ad_ids],
                }
                for r in rows
            ],
        }

    def get_signals(self, window: str) -> dict[str, Any]:
        s = self.snap(window)
        refs = {a.ad_id: a.external_id for a in s.ads}
        return {
            "window": window,
            "fatigue": [
                {
                    "ad": refs.get(f.ad_id, f.ad_id),
                    "metric": f.metric,
                    "early": _r(f.early),
                    "late": _r(f.late),
                    "change": _r(f.change, 4),
                }
                for f in s.fatigue
            ],
            "underfunded_winners": [
                {
                    "ad": refs.get(u.ad_id, u.ad_id),
                    "metric": u.metric,
                    "low": _r(u.low),
                    "same_type_average": _r(u.account),
                    "spend_share": _r(u.spend_share),
                }
                for u in s.underfunded
            ],
            "outliers": [
                {
                    "ad": refs.get(o.ad_id, o.ad_id),
                    "metric": o.metric,
                    "z": o.z,
                    "direction": o.direction,
                    "peer_group": o.peer_group.split(" · ")[0],
                    "value": _r(o.value),
                }
                for o in s.outliers
            ],
        }

    def get_concepts(self, window: str) -> dict[str, Any]:
        s = self.snap(window)
        if not s.concepts:
            return {"window": window, "concepts": [], "diversity": None}
        ads_of: dict[str, list[str]] = {}
        for st in s.ads:
            cid = self.creative_of_ad.get(st.ad_id)
            if cid:
                ads_of.setdefault(cid, []).append(st.external_id)
        return {
            "window": window,
            "diversity": s.concepts.diversity,
            "n_creatives": s.concepts.n_creatives,
            "concepts": [
                {
                    "label": c.label,
                    "spend": c.spend,
                    "spend_share": _r(c.spend_share),
                    "ads": sorted(a for cid in c.creative_ids for a in ads_of.get(cid, [])),
                }
                for c in s.concepts.clusters
            ],
        }

    def get_ad_detail(self, ad: str, window: str) -> dict[str, Any]:
        s = self.snap(window)
        st = self.find_ad(s, ad)
        if st is None:
            raise ValueError(f"ad {ad!r} has no delivery in window {window}")
        return {
            **self.ad_summary(st),
            "window": window,
            "kpis": {
                m: {"estimate": _r(e.value), "low": _r(e.low), "high": _r(e.high), "raw": _r(e.raw)}
                for m, e in st.kpis.items()
            },
            "totals": st.totals.model_dump(),
        }

    def search_ads(
        self,
        window: str,
        sort_by: str = "spend",
        dimension: str | None = None,
        value: str | None = None,
        limit: int = 10,
    ) -> dict[str, Any]:
        s = self.snap(window)
        ads = list(s.ads)
        if dimension and value:
            tagged = {
                aid for r in s.tags.get(dimension, []) if r.value == value for aid in r.ad_ids
            }
            ads = [a for a in ads if a.ad_id in tagged]
        if sort_by != "spend" and sort_by not in METRICS:
            raise ValueError(f"sort_by must be spend or {METRIC_HELP}")

        def key(a: AdStats) -> tuple[bool, float]:
            if sort_by == "spend":
                return (False, -a.totals.spend)
            v = a.kpis[sort_by].value
            if v is None:
                return (True, 0.0)  # ads without the metric go last
            return (False, v if sort_by == "cpa" else -v)

        return {
            "window": window,
            "ads": [self.ad_summary(a) for a in sorted(ads, key=key)[: max(1, min(limit, 50))]],
        }


def _schema(props: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": props,
        "required": required,
        "additionalProperties": False,
    }


_W = {"type": "string", "enum": WINDOWS, "description": "Analysis window in days, or all"}
_M = {"type": "string", "enum": list(METRICS)}

TOOL_DEFS: list[dict[str, Any]] = [
    {
        "name": "get_account_overview",
        "description": "Account totals, KPIs, signal counts and concept diversity for a window.",
        "input_schema": _schema({"window": _W}, ["window"]),
    },
    {
        "name": "get_tag_performance",
        "description": "Rank the values of one tag dimension (hook_type, angle, format, creative_type for static vs video, offer, proof_type, persona, cta, length_bucket) by one metric, with shrunk estimates, 90% intervals, verdicts and the ads in each value.",
        "input_schema": _schema(
            {"dimension": {"type": "string", "enum": DIMENSIONS}, "metric": _M, "window": _W},
            ["dimension", "metric", "window"],
        ),
    },
    {
        "name": "get_signals",
        "description": "Fading ads (early vs late decline), underfunded winners and outliers vs peers.",
        "input_schema": _schema({"window": _W}, ["window"]),
    },
    {
        "name": "get_concepts",
        "description": "Concept clusters (near-duplicates grouped) with spend share, and the diversity score.",
        "input_schema": _schema({"window": _W}, ["window"]),
    },
    {
        "name": "get_ad_detail",
        "description": "Every KPI (estimate, interval, raw) and total for one ad.",
        "input_schema": _schema(
            {"ad": {"type": "string", "description": "Ad ref"}, "window": _W}, ["ad", "window"]
        ),
    },
    {
        "name": "search_ads",
        "description": "List ads, optionally filtered to one tag value, sorted by spend or a metric.",
        "input_schema": _schema(
            {
                "window": _W,
                "sort_by": {"type": "string", "enum": ["spend", *METRICS]},
                "dimension": {"type": ["string", "null"], "enum": [*DIMENSIONS, None]},
                "value": {"type": ["string", "null"]},
                "limit": {"type": "integer"},
            },
            ["window", "sort_by", "dimension", "value", "limit"],
        ),
    },
]


def run_tool(tools: SnapshotTools, name: str, args: dict[str, Any]) -> dict[str, Any]:
    fn = getattr(tools, name, None)
    if fn is None or name.startswith("_") or name not in {t["name"] for t in TOOL_DEFS}:
        raise ValueError(f"unknown tool {name!r}")
    return fn(**args)
