"""Report schema shared by the agents, the grounding validator and the web app."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Window = Literal["7", "30", "90", "all"]
CitableMetric = Literal[
    "roas",
    "cpa",
    "ctr",
    "hook_rate",
    "hold_rate",
    "cvr",
    "spend",
    "impressions",
    "purchases",
    "spend_share",
    "diversity",
]


class MetricCite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity: str = Field(
        description='"ad:<ad ref>", "tag:<dimension>=<value>", "concepts" or "account"'
    )
    metric: CitableMetric
    value: float = Field(
        description="Exactly as returned by a tool; rates as fractions (0.0178), not percents"
    )
    window: Window


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claim: str = Field(description="One or two plain sentences a media buyer can act on")
    ad_ids: list[str] = Field(
        description="Ad refs the claim is about (may be empty for tag-level claims)"
    )
    metrics: list[MetricCite] = Field(description="Every number the claim states, as a citation")


class StrategistReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(description="Two or three sentences on the state of the account")
    working: list[Claim]
    double_down: list[Claim]
    cut: list[Claim]
    missing_concepts: list[Claim]

    def claims(self) -> list[tuple[str, Claim]]:
        return [
            (s, c)
            for s in ("working", "double_down", "cut", "missing_concepts")
            for c in getattr(self, s)
        ]
