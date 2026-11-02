"""Learn a brand from its website: a draft of the brand-memory guidelines that briefs follow.

The owner reviews and saves the draft; nothing is written automatically. The page is
fetched server-side, so only public http(s) hosts are allowed.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx
from pydantic import BaseModel, Field

from mosaic.llm import LLM, LLMRequest

MODEL = "gemini-3.5-flash"
MAX_BYTES = 2_000_000
MAX_CHARS = 20_000
MAX_REDIRECTS = 3


class BrandProfile(BaseModel):
    product: str = Field(description="What the brand sells, in one plain sentence.")
    audience: str = Field(description="Who it is for, in one sentence.")
    value_props: list[str] = Field(description="3-5 reasons to buy, in the brand's own terms.")
    tone: list[str] = Field(
        description="3-5 words describing the voice, e.g. warm, science-backed."
    )
    claims_to_avoid: list[str] = Field(
        description="Claims an ad should not make: medical or absolute promises the site "
        "doesn't make, or things it explicitly says it is not. Empty if none are evident."
    )

    def guidelines(self) -> str:
        lines = [
            f"Product: {self.product}",
            f"Audience: {self.audience}",
            f"Voice: {', '.join(self.tone)}",
            "Why people buy:",
            *[f"- {v}" for v in self.value_props],
        ]
        if self.claims_to_avoid:
            lines += ["Avoid claiming:", *[f"- {c}" for c in self.claims_to_avoid]]
        return "\n".join(lines)


class BrandURLError(ValueError):
    pass


SYSTEM = (
    "You read a brand's website and describe it for a creative strategist writing ad briefs. "
    "Use only what the page says; do not invent facts, prices or claims."
)


def learn_brand(
    llm: LLM, url: str, workspace_id: str, http: httpx.Client | None = None
) -> BrandProfile:
    text = fetch_site_text(url, http)
    req = LLMRequest(model=MODEL, system=SYSTEM, prompt=f"Website: {url}\n\n{text}")
    return llm.structured("brand_profile", req, BrandProfile, workspace_id=workspace_id)


def fetch_site_text(url: str, http: httpx.Client | None = None) -> str:
    """The page's title, description and visible text, capped for the prompt."""
    client = http or httpx.Client(timeout=15, headers={"User-Agent": "Mosaic/1.0 (+brand profile)"})
    for _ in range(MAX_REDIRECTS + 1):
        _check_public(url)
        try:
            resp = client.get(url, follow_redirects=False)
        except httpx.HTTPError as exc:
            raise BrandURLError("couldn't reach that site; check the link and try again") from exc
        if resp.is_redirect and "location" in resp.headers:
            url = urljoin(url, resp.headers["location"])
            continue
        if resp.status_code >= 400:
            raise BrandURLError(f"the site answered {resp.status_code}")
        if "html" not in resp.headers.get("content-type", "html"):
            raise BrandURLError("that link isn't a web page")
        parser = _TextParser()
        parser.feed(resp.content[:MAX_BYTES].decode(resp.encoding or "utf-8", errors="replace"))
        text = parser.text()
        if len(text) < 40:
            raise BrandURLError("couldn't read any text on that page")
        return text[:MAX_CHARS]
    raise BrandURLError("too many redirects")


def _check_public(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise BrandURLError("use a full http(s) link, like https://yourbrand.com")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443)
    except socket.gaierror as exc:
        raise BrandURLError("couldn't find that site") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise BrandURLError("that address isn't a public website")


class _TextParser(HTMLParser):
    SKIP = frozenset({"script", "style", "noscript", "svg", "template"})

    def __init__(self) -> None:
        super().__init__()
        self._skip = 0
        self._in_title = False
        self.title = ""
        self.description = ""
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.SKIP:
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        elif tag == "meta":
            a = dict(attrs)
            if (a.get("name") or a.get("property") or "").lower() in (
                "description",
                "og:description",
            ):
                self.description = self.description or (a.get("content") or "")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        elif not self._skip and data.strip():
            self.parts.append(data.strip())

    def text(self) -> str:
        body = re.sub(r"\s+", " ", " ".join(self.parts))
        head = [f"Title: {self.title.strip()}"] if self.title.strip() else []
        if self.description:
            head.append(f"Description: {self.description.strip()}")
        return "\n".join([*head, body]).strip()
