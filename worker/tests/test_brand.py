import json
import socket
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from mosaic import api, brand
from mosaic.llm import LLM, LLMRequest, LLMResponse
from mosaic.store import MemoryStore
from tests.test_jobs_and_api import SETTINGS

PAGE = """<html><head><title>Driftwell | Electrolytes</title>
<meta name="description" content="Zero-sugar hydration for busy days.">
<script>var tracking = 1;</script><style>p{}</style></head>
<body><h1>Hydration that keeps up with you</h1>
<p>Three electrolytes, no sugar, real fruit.</p></body></html>"""

PROFILE = {
    "product": "Zero-sugar electrolyte drink mix.",
    "audience": "Busy adults who forget to drink water.",
    "value_props": ["No sugar", "Real fruit"],
    "tone": ["warm", "plain"],
    "claims_to_avoid": ["cures dehydration"],
}


class Fake:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    def generate(self, req: LLMRequest) -> LLMResponse:
        self.prompts.append(req.prompt)
        return LLMResponse(text=json.dumps(PROFILE))


@pytest.fixture(autouse=True)
def public_dns(monkeypatch: Any) -> None:
    def fake(host: str, port: int, *a: Any, **k: Any) -> list[Any]:
        ip = {"driftwell.com": "93.184.216.34", "www.driftwell.com": "93.184.216.34"}.get(
            host, "127.0.0.1"
        )
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]

    monkeypatch.setattr(brand.socket, "getaddrinfo", fake)


@respx.mock
def test_reads_title_description_and_body_but_not_scripts() -> None:
    respx.get("https://driftwell.com/").mock(return_value=httpx.Response(200, html=PAGE))
    text = brand.fetch_site_text("https://driftwell.com/")
    assert text.startswith("Title: Driftwell | Electrolytes\nDescription: Zero-sugar hydration")
    assert "Three electrolytes" in text and "tracking" not in text and "p{}" not in text


@respx.mock
def test_follows_redirects_but_checks_every_hop() -> None:
    respx.get("https://driftwell.com/").mock(
        return_value=httpx.Response(301, headers={"location": "https://www.driftwell.com/"})
    )
    respx.get("https://www.driftwell.com/").mock(return_value=httpx.Response(200, html=PAGE))
    assert "Three electrolytes" in brand.fetch_site_text("https://driftwell.com/")

    respx.get("https://driftwell.com/sneaky").mock(
        return_value=httpx.Response(302, headers={"location": "http://internal.local/admin"})
    )
    with pytest.raises(brand.BrandURLError, match="public"):
        brand.fetch_site_text("https://driftwell.com/sneaky")


@pytest.mark.parametrize(
    "url", ["ftp://driftwell.com", "http://localhost:8000", "file:///etc/passwd"]
)
def test_rejects_non_public_urls(url: str) -> None:
    with pytest.raises(brand.BrandURLError):
        brand.fetch_site_text(url)


@respx.mock
def test_endpoint_returns_a_draft_and_writes_nothing(monkeypatch: Any) -> None:
    monkeypatch.setenv("WORKER_API_KEY", "k1")
    respx.get("https://driftwell.com").mock(return_value=httpx.Response(200, html=PAGE))
    store = MemoryStore()
    store.insert("workspaces", {"id": "ws", "owner_id": "u1", "name": "W"})
    fake = Fake()
    api.deps.store_factory = lambda: store
    api.deps.settings_factory = lambda: SETTINGS
    api.deps.verify_jwt = lambda tok: {"user-jwt": "u1"}.get(tok)
    api.deps.llm_factory = lambda _s: LLM(fake)
    c = TestClient(api.app)
    r = c.post(
        "/workspaces/ws/brand/learn",
        json={"url": "driftwell.com"},
        headers={"Authorization": "Bearer user-jwt"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["guidelines"].startswith("Product: Zero-sugar electrolyte drink mix.")
    assert "Avoid claiming:\n- cures dehydration" in r.json()["guidelines"]
    assert "Three electrolytes" in fake.prompts[0]
    assert "brand_memory" not in store.tables
    bad = c.post(
        "/workspaces/ws/brand/learn",
        json={"url": "http://localhost"},
        headers={"Authorization": "Bearer user-jwt"},
    )
    assert bad.status_code == 400


@respx.mock
def test_unreachable_site_is_a_clear_error() -> None:
    respx.get("https://driftwell.com/").mock(side_effect=httpx.ConnectTimeout("slow"))
    with pytest.raises(brand.BrandURLError, match="couldn't reach"):
        brand.fetch_site_text("https://driftwell.com/")


@respx.mock
def test_blocked_sites_suggest_pasting_and_pasted_text_works(monkeypatch: Any) -> None:
    respx.get("https://driftwell.com/").mock(return_value=httpx.Response(429))
    with pytest.raises(brand.BrandURLError, match="paste its text"):
        brand.fetch_site_text("https://driftwell.com/")

    monkeypatch.setenv("WORKER_API_KEY", "k1")
    store = MemoryStore()
    store.insert("workspaces", {"id": "ws", "owner_id": "u1", "name": "W"})
    fake = Fake()
    api.deps.store_factory = lambda: store
    api.deps.verify_jwt = lambda tok: {"user-jwt": "u1"}.get(tok)
    api.deps.llm_factory = lambda _s: LLM(fake)
    c = TestClient(api.app)
    h = {"Authorization": "Bearer user-jwt"}
    r = c.post(
        "/workspaces/ws/brand/learn",
        json={"text": "Driftwell makes zero-sugar electrolytes."},
        headers=h,
    )
    assert r.status_code == 200 and "Pasted" not in fake.prompts[0]
    assert "zero-sugar electrolytes" in fake.prompts[0]
    assert c.post("/workspaces/ws/brand/learn", json={"text": "hi"}, headers=h).status_code == 400
