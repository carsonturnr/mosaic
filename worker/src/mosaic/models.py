"""Typed payloads returned by every DataSource.

These mirror the external system's shape (keyed by external_id), not DB rows.
The sync layer maps them onto Postgres.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field


class CreativeType(StrEnum):
    VIDEO = "video"
    IMAGE = "image"
    CAROUSEL = "carousel"


class _Payload(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Campaign(_Payload):
    external_id: str
    name: str
    objective: str | None = None
    status: str | None = None
    created_time: datetime | None = None
    raw: dict[str, object] = Field(default_factory=dict)


class AdSet(_Payload):
    external_id: str
    campaign_external_id: str
    name: str
    status: str | None = None
    optimization_goal: str | None = None
    daily_budget_cents: int | None = None
    raw: dict[str, object] = Field(default_factory=dict)


class Ad(_Payload):
    external_id: str
    ad_set_external_id: str
    creative_external_id: str
    name: str
    status: str | None = None
    created_time: datetime | None = None
    raw: dict[str, object] = Field(default_factory=dict)


class Creative(_Payload):
    external_id: str
    type: CreativeType
    primary_text: str | None = None
    headline: str | None = None
    cta_type: str | None = None
    media_url: str | None = None
    thumbnail_url: str | None = None
    duration_s: float | None = None
    width: int | None = None
    height: int | None = None
    raw: dict[str, object] = Field(default_factory=dict)


class MediaFile(_Payload):
    creative_external_id: str
    path: Path
    content_type: str
    content_hash: str
    size_bytes: int


class AdDailyMetric(_Payload):
    ad_external_id: str
    date: date
    spend: float = 0.0
    impressions: int = 0
    reach: int | None = None
    clicks: int | None = None
    link_clicks: int | None = None
    purchases: float | None = None
    purchase_value: float | None = None
    video_3s_views: int | None = None
    video_thruplays: int | None = None
    video_p25: int | None = None
    video_p50: int | None = None
    video_p75: int | None = None
    video_p100: int | None = None
