"""MetaLiveSource — Marketing API (Graph API v26.0) implementation of DataSource.

Field names were verified against the live sandbox on Oct 21, 2026 (see
tests/test_meta_live.py). Hook-rate inputs come from `actions` (`video_view` = 3-second
video views); thruplays and quartiles have their own fields. The sandbox never delivers,
so the insight *value* mapping is covered by recorded-response tests only.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from collections.abc import Callable
from datetime import date, datetime
from pathlib import Path
from typing import Any

import httpx

from mosaic.models import Ad, AdDailyMetric, AdSet, Campaign, Creative, CreativeType, MediaFile

GRAPH = "https://graph.facebook.com"

# Error codes that mean "slow down" rather than "you're wrong".
RETRYABLE_CODES = {1, 2, 4, 17, 32, 613, 80000, 80004}

CAMPAIGN_FIELDS = "id,name,objective,status,effective_status,created_time"
ADSET_FIELDS = (
    "id,name,status,effective_status,campaign_id,optimization_goal,"
    "daily_budget,lifetime_budget,created_time"
)
AD_FIELDS = "id,name,status,effective_status,created_time,adset_id,campaign_id,creative{id}"
CREATIVE_FIELDS = (
    "id,name,object_type,thumbnail_url,image_url,image_hash,video_id,body,title,"
    "call_to_action_type,object_story_spec,asset_feed_spec"
)
INSIGHT_FIELDS = (
    "ad_id,date_start,spend,impressions,reach,clicks,inline_link_clicks,"
    "actions,action_values,video_thruplay_watched_actions,"
    "video_p25_watched_actions,video_p50_watched_actions,"
    "video_p75_watched_actions,video_p100_watched_actions"
)
PURCHASE_ACTIONS = ("omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase")


class MetaAPIError(RuntimeError):
    def __init__(self, code: int | None, message: str, subcode: int | None = None) -> None:
        super().__init__(f"Meta API error {code}/{subcode}: {message}")
        self.code = code
        self.subcode = subcode


class MetaClient:
    def __init__(
        self,
        access_token: str,
        *,
        app_secret: str | None = None,
        version: str = "v26.0",
        http: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        max_retries: int = 5,
    ) -> None:
        self._token = access_token
        self._version = version
        self._http = http or httpx.Client(timeout=60)
        self._sleep = sleep
        self._max_retries = max_retries
        self._proof = (
            hmac.new(app_secret.encode(), access_token.encode(), hashlib.sha256).hexdigest()
            if app_secret
            else None
        )

    def _auth(self) -> dict[str, str]:
        params = {"access_token": self._token}
        if self._proof:
            params["appsecret_proof"] = self._proof
        return params

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if path.startswith("http"):
            # paging.next carries its own query (cursor, fields, ...); keep it.
            parsed = httpx.URL(path)
            url = str(parsed.copy_with(query=None))
            query: dict[str, Any] = {**dict(parsed.params), **(params or {}), **self._auth()}
        else:
            url = f"{GRAPH}/{self._version}/{path.lstrip('/')}"
            query = {**(params or {}), **self._auth()}
        delay = 1.0
        for attempt in range(self._max_retries + 1):
            resp = self._http.get(url, params=query)
            body = resp.json() if resp.content else {}
            err = body.get("error") if isinstance(body, dict) else None
            if resp.status_code < 400 and not err:
                return body
            code = (err or {}).get("code")
            if (resp.status_code == 429 or code in RETRYABLE_CODES) and attempt < self._max_retries:
                self._sleep(delay)
                delay = min(delay * 2, 60)
                continue
            raise MetaAPIError(
                code, (err or {}).get("message", resp.text[:200]), (err or {}).get("error_subcode")
            )
        raise AssertionError("unreachable")

    def get_all(self, path: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Follow `paging.next` until exhausted."""
        out: list[dict[str, Any]] = []
        body = self.get(path, {"limit": 100, **(params or {})})
        while True:
            out.extend(body.get("data", []))
            nxt = (body.get("paging") or {}).get("next")
            if not nxt:
                return out
            body = self.get(nxt)

    def download(self, url: str, dest: Path) -> tuple[str, int, str]:
        """Stream a media URL to disk; returns (content_type, size, sha256)."""
        h = hashlib.sha256()
        size = 0
        with self._http.stream("GET", url, follow_redirects=True) as resp:
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "application/octet-stream")
            with dest.open("wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
                    h.update(chunk)
                    size += len(chunk)
        return content_type.split(";")[0], size, h.hexdigest()


class MetaLiveSource:
    def __init__(
        self, client: MetaClient, ad_account_id: str, *, media_dir: Path | None = None
    ) -> None:
        self.client = client
        self.account = ad_account_id if ad_account_id.startswith("act_") else f"act_{ad_account_id}"
        self.media_dir = media_dir

    # -- structure ------------------------------------------------------------

    def list_campaigns(self) -> list[Campaign]:
        rows = self.client.get_all(f"{self.account}/campaigns", {"fields": CAMPAIGN_FIELDS})
        return [
            Campaign(
                external_id=r["id"],
                name=r.get("name", ""),
                objective=r.get("objective"),
                status=r.get("effective_status") or r.get("status"),
                created_time=_dt(r.get("created_time")),
                raw=r,
            )
            for r in rows
        ]

    def list_ad_sets(self) -> list[AdSet]:
        rows = self.client.get_all(f"{self.account}/adsets", {"fields": ADSET_FIELDS})
        return [
            AdSet(
                external_id=r["id"],
                campaign_external_id=r["campaign_id"],
                name=r.get("name", ""),
                status=r.get("effective_status") or r.get("status"),
                optimization_goal=r.get("optimization_goal"),
                daily_budget_cents=_int(r.get("daily_budget")),
                raw=r,
            )
            for r in rows
        ]

    def list_ads(self) -> list[Ad]:
        rows = self.client.get_all(f"{self.account}/ads", {"fields": AD_FIELDS})
        return [
            Ad(
                external_id=r["id"],
                ad_set_external_id=r["adset_id"],
                creative_external_id=(r.get("creative") or {}).get("id", ""),
                name=r.get("name", ""),
                status=r.get("effective_status") or r.get("status"),
                created_time=_dt(r.get("created_time")),
                raw=r,
            )
            for r in rows
            if r.get("creative")
        ]

    def get_creative(self, creative_external_id: str) -> Creative:
        r = self.client.get(creative_external_id, {"fields": CREATIVE_FIELDS})
        return parse_creative(r, self._resolve_media_url)

    def _resolve_media_url(self, r: dict[str, Any], kind: CreativeType) -> str | None:
        if kind is CreativeType.VIDEO:
            video_id = r.get("video_id") or _spec(r).get("video_data", {}).get("video_id")
            if not video_id:
                return None
            v = self.client.get(str(video_id), {"fields": "source"})
            return v.get("source")
        if r.get("image_url"):
            return r["image_url"]
        image_hash = r.get("image_hash") or _spec(r).get("link_data", {}).get("image_hash")
        if image_hash:
            imgs = self.client.get(
                f"{self.account}/adimages", {"hashes": f'["{image_hash}"]', "fields": "url"}
            )
            data = imgs.get("data") or []
            if data:
                return data[0].get("url")
        return r.get("thumbnail_url")

    def download_media(self, creative: Creative) -> MediaFile:
        if self.media_dir is None:
            raise RuntimeError("MetaLiveSource(media_dir=...) is required to download media")
        if not creative.media_url:
            raise ValueError(f"creative {creative.external_id} has no media_url")
        self.media_dir.mkdir(parents=True, exist_ok=True)
        ext = "mp4" if creative.type is CreativeType.VIDEO else "jpg"
        dest = self.media_dir / f"{creative.external_id}.{ext}"
        content_type, size, digest = self.client.download(creative.media_url, dest)
        return MediaFile(
            creative_external_id=creative.external_id,
            path=dest,
            content_type=content_type,
            content_hash=digest,
            size_bytes=size,
        )

    # -- metrics --------------------------------------------------------------

    def get_daily_metrics(self, ad_ids: list[str], since: date, until: date) -> list[AdDailyMetric]:
        out: list[AdDailyMetric] = []
        for i in range(0, len(ad_ids), 50):
            chunk = ad_ids[i : i + 50]
            rows = self.client.get_all(
                f"{self.account}/insights",
                {
                    "level": "ad",
                    "time_increment": 1,
                    "time_range": _time_range(since, until),
                    "fields": INSIGHT_FIELDS,
                    "filtering": '[{"field":"ad.id","operator":"IN","value":['
                    + ",".join(f'"{a}"' for a in chunk)
                    + "]}]",
                },
            )
            out.extend(parse_insight_row(r) for r in rows)
        return out


# -- mappers (pure, unit-tested) --------------------------------------------------


def parse_creative(
    r: dict[str, Any],
    resolve_media_url: Callable[[dict[str, Any], CreativeType], str | None] | None = None,
) -> Creative:
    spec = _spec(r)
    link = spec.get("link_data") or {}
    video = spec.get("video_data") or {}
    feed = r.get("asset_feed_spec") or {}

    if r.get("video_id") or video or feed.get("videos"):
        kind = CreativeType.VIDEO
    elif link.get("child_attachments"):
        kind = CreativeType.CAROUSEL
    else:
        kind = CreativeType.IMAGE

    primary_text = r.get("body") or link.get("message") or video.get("message")
    if not primary_text and feed.get("bodies"):
        primary_text = feed["bodies"][0].get("text")
    headline = r.get("title") or link.get("name") or video.get("title")
    if not headline and feed.get("titles"):
        headline = feed["titles"][0].get("text")
    cta = (
        r.get("call_to_action_type")
        or (link.get("call_to_action") or {}).get("type")
        or (video.get("call_to_action") or {}).get("type")
    )
    if not cta and feed.get("call_to_action_types"):
        cta = feed["call_to_action_types"][0]

    media_url = resolve_media_url(r, kind) if resolve_media_url else None
    return Creative(
        external_id=r["id"],
        type=kind,
        primary_text=primary_text,
        headline=headline,
        cta_type=cta,
        media_url=media_url,
        thumbnail_url=r.get("thumbnail_url") or video.get("image_url"),
        raw=r,
    )


def parse_insight_row(r: dict[str, Any]) -> AdDailyMetric:
    actions = _action_map(r.get("actions"))
    values = _action_map(r.get("action_values"))
    purchases = _first(actions, PURCHASE_ACTIONS)
    purchase_value = _first(values, PURCHASE_ACTIONS)
    return AdDailyMetric(
        ad_external_id=r["ad_id"],
        date=date.fromisoformat(r["date_start"]),
        spend=float(r.get("spend") or 0),
        impressions=int(r.get("impressions") or 0),
        reach=_int(r.get("reach")),
        clicks=_int(r.get("clicks")),
        link_clicks=_int(r.get("inline_link_clicks")),
        purchases=purchases,
        purchase_value=purchase_value,
        video_3s_views=_int(actions.get("video_view")),
        video_thruplays=_video(r, "video_thruplay_watched_actions"),
        video_p25=_video(r, "video_p25_watched_actions"),
        video_p50=_video(r, "video_p50_watched_actions"),
        video_p75=_video(r, "video_p75_watched_actions"),
        video_p100=_video(r, "video_p100_watched_actions"),
    )


def _time_range(since: date, until: date) -> str:
    return f'{{"since":"{since.isoformat()}","until":"{until.isoformat()}"}}'


def _spec(r: dict[str, Any]) -> dict[str, Any]:
    return r.get("object_story_spec") or {}


def _action_map(items: list[dict[str, Any]] | None) -> dict[str, float]:
    return {i["action_type"]: float(i.get("value") or 0) for i in items or []}


def _first(m: dict[str, float], keys: tuple[str, ...]) -> float | None:
    for k in keys:
        if k in m:
            return m[k]
    return None


def _video(r: dict[str, Any], field: str) -> int | None:
    items = r.get(field)
    if not items:
        return None
    return int(float(items[0].get("value") or 0))


def _int(v: Any) -> int | None:
    return None if v is None or v == "" else int(float(v))


def _dt(v: str | None) -> datetime | None:
    if not v:
        return None
    return datetime.fromisoformat(v.replace("+0000", "+00:00"))
