from datetime import date
from pathlib import Path

import httpx
import pytest
import respx

from mosaic.datasources import DataSource
from mosaic.datasources.meta import (
    GRAPH,
    MetaAPIError,
    MetaClient,
    MetaLiveSource,
    parse_creative,
    parse_insight_row,
)
from mosaic.models import CreativeType

ACT = "act_123"
BASE = f"{GRAPH}/v26.0"


def _client(**kw: object) -> MetaClient:
    return MetaClient("tok", app_secret="sec", sleep=lambda _s: None, **kw)  # type: ignore[arg-type]


def test_conforms_to_protocol() -> None:
    assert isinstance(MetaLiveSource(_client(), ACT), DataSource)


@respx.mock
def test_pagination_and_appsecret_proof() -> None:
    page2 = f"{BASE}/{ACT}/campaigns?after=xyz"
    route = respx.get(f"{BASE}/{ACT}/campaigns")
    route.side_effect = [
        httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "c1",
                        "name": "One",
                        "status": "ACTIVE",
                        "created_time": "2026-07-01T00:00:00+0000",
                    }
                ],
                "paging": {"next": page2},
            },
        ),
        httpx.Response(200, json={"data": [{"id": "c2", "name": "Two"}]}),
    ]
    src = MetaLiveSource(_client(), ACT)
    camps = src.list_campaigns()
    assert [c.external_id for c in camps] == ["c1", "c2"]
    assert camps[0].created_time is not None and camps[0].created_time.year == 2026
    assert route.call_count == 2
    first, second = (c.request for c in route.calls)
    assert "appsecret_proof=" in str(first.url) and "access_token=tok" in str(first.url)
    assert "after=xyz" in str(second.url)


@respx.mock
def test_retries_on_throttle_then_succeeds() -> None:
    route = respx.get(f"{BASE}/{ACT}/ads")
    route.side_effect = [
        httpx.Response(400, json={"error": {"code": 17, "message": "User request limit reached"}}),
        httpx.Response(429, json={"error": {"code": 4, "message": "Application request limit"}}),
        httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "a1",
                        "name": "Ad",
                        "adset_id": "s1",
                        "status": "ACTIVE",
                        "creative": {"id": "cr1"},
                    },
                    {"id": "a2", "name": "No creative", "adset_id": "s1"},
                ]
            },
        ),
    ]
    ads = MetaLiveSource(_client(), ACT).list_ads()
    assert route.call_count == 3
    assert [a.external_id for a in ads] == ["a1"]
    assert ads[0].creative_external_id == "cr1"


@respx.mock
def test_non_retryable_error_raises() -> None:
    respx.get(f"{BASE}/{ACT}/adsets").mock(
        return_value=httpx.Response(
            400, json={"error": {"code": 100, "message": "Invalid parameter"}}
        )
    )
    with pytest.raises(MetaAPIError) as exc:
        MetaLiveSource(_client(), ACT).list_ad_sets()
    assert exc.value.code == 100


def test_parse_video_creative_from_object_story_spec() -> None:
    r = {
        "id": "cr1",
        "thumbnail_url": "https://t/x.jpg",
        "object_story_spec": {
            "page_id": "p",
            "video_data": {
                "video_id": "v9",
                "message": "Primary text",
                "title": "Headline",
                "call_to_action": {"type": "SHOP_NOW"},
                "image_url": "https://t/poster.jpg",
            },
        },
    }
    c = parse_creative(r, lambda _r, _k: "https://cdn/video.mp4")
    assert c.type is CreativeType.VIDEO
    assert (
        c.primary_text == "Primary text" and c.headline == "Headline" and c.cta_type == "SHOP_NOW"
    )
    assert c.media_url == "https://cdn/video.mp4" and c.thumbnail_url == "https://t/x.jpg"


def test_parse_image_and_carousel_creatives() -> None:
    img = parse_creative(
        {
            "id": "i",
            "image_url": "https://i/x.png",
            "body": "B",
            "title": "T",
            "call_to_action_type": "LEARN_MORE",
        }
    )
    assert img.type is CreativeType.IMAGE and img.cta_type == "LEARN_MORE"
    car = parse_creative(
        {
            "id": "c",
            "object_story_spec": {
                "link_data": {"message": "M", "child_attachments": [{"link": "x"}, {"link": "y"}]}
            },
        }
    )
    assert car.type is CreativeType.CAROUSEL and car.primary_text == "M"
    feed = parse_creative(
        {
            "id": "f",
            "asset_feed_spec": {
                "videos": [{"video_id": "v"}],
                "bodies": [{"text": "FB"}],
                "titles": [{"text": "FT"}],
                "call_to_action_types": ["SHOP_NOW"],
            },
        }
    )
    assert feed.type is CreativeType.VIDEO and feed.primary_text == "FB" and feed.headline == "FT"


@respx.mock
def test_get_creative_resolves_video_source_and_image_hash() -> None:
    respx.get(f"{BASE}/cr1").mock(
        return_value=httpx.Response(200, json={"id": "cr1", "video_id": "v1", "body": "x"})
    )
    respx.get(f"{BASE}/v1").mock(
        return_value=httpx.Response(200, json={"id": "v1", "source": "https://cdn/v1.mp4"})
    )
    respx.get(f"{BASE}/cr2").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "cr2",
                "object_story_spec": {"link_data": {"image_hash": "abc", "message": "m"}},
            },
        )
    )
    respx.get(f"{BASE}/{ACT}/adimages").mock(
        return_value=httpx.Response(
            200, json={"data": [{"hash": "abc", "url": "https://cdn/abc.jpg"}]}
        )
    )
    src = MetaLiveSource(_client(), ACT)
    assert src.get_creative("cr1").media_url == "https://cdn/v1.mp4"
    assert src.get_creative("cr2").media_url == "https://cdn/abc.jpg"


def test_parse_insight_row_maps_actions() -> None:
    r = {
        "ad_id": "a1",
        "date_start": "2026-08-01",
        "date_stop": "2026-08-01",
        "spend": "12.34",
        "impressions": "1000",
        "reach": "800",
        "clicks": "20",
        "inline_link_clicks": "17",
        "actions": [
            {"action_type": "video_view", "value": "300"},
            {"action_type": "omni_purchase", "value": "2"},
            {"action_type": "link_click", "value": "17"},
        ],
        "action_values": [{"action_type": "omni_purchase", "value": "99.5"}],
        "video_thruplay_watched_actions": [{"action_type": "video_view", "value": "150"}],
        "video_p25_watched_actions": [{"action_type": "video_view", "value": "250"}],
        "video_p100_watched_actions": [{"action_type": "video_view", "value": "40"}],
    }
    m = parse_insight_row(r)
    assert m.ad_external_id == "a1" and m.date == date(2026, 8, 1)
    assert m.spend == 12.34 and m.impressions == 1000 and m.link_clicks == 17
    assert m.purchases == 2 and m.purchase_value == 99.5
    assert m.video_3s_views == 300 and m.video_thruplays == 150
    assert m.video_p25 == 250 and m.video_p50 is None and m.video_p100 == 40


def test_parse_insight_row_static_ad_has_no_video_fields() -> None:
    m = parse_insight_row(
        {"ad_id": "a", "date_start": "2026-08-02", "spend": "1", "impressions": "10"}
    )
    assert m.video_3s_views is None and m.purchases is None and m.clicks is None


@respx.mock
def test_get_daily_metrics_chunks_ad_ids_and_filters() -> None:
    route = respx.get(f"{BASE}/{ACT}/insights").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {"ad_id": "a1", "date_start": "2026-08-01", "spend": "1", "impressions": "5"}
                ]
            },
        )
    )
    ids = [f"a{i}" for i in range(120)]
    rows = MetaLiveSource(_client(), ACT).get_daily_metrics(ids, date(2026, 8, 1), date(2026, 8, 2))
    assert route.call_count == 3 and len(rows) == 3
    q = str(route.calls[0].request.url)
    assert (
        "time_increment=1" in q
        and "level=ad" in q
        and '"ad.id"' in httpx.URL(q).params["filtering"]
    )


@respx.mock
def test_download_media_hashes_file(tmp_path: Path) -> None:
    respx.get("https://cdn/v.mp4").mock(
        return_value=httpx.Response(200, content=b"abc", headers={"content-type": "video/mp4"})
    )
    src = MetaLiveSource(_client(), ACT, media_dir=tmp_path)
    creative = parse_creative({"id": "cr", "video_id": "v"}, lambda _r, _k: "https://cdn/v.mp4")
    media = src.download_media(creative)
    assert media.path.read_bytes() == b"abc" and media.size_bytes == 3
    assert media.content_type == "video/mp4" and len(media.content_hash) == 64
