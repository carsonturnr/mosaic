"""The one wrapper every model call goes through (docs/ARCHITECTURE.md §15).

Handles: schema validation (pydantic), one retry on validation failure with the
error fed back, transient-error backoff, a content-addressed cache, and tracing
(Langfuse when configured, otherwise a no-op). Providers are small adapters.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


@dataclass(frozen=True)
class MediaPart:
    path: Path
    mime_type: str


@dataclass(frozen=True)
class LLMRequest:
    model: str
    system: str
    prompt: str
    media: tuple[MediaPart, ...] = ()
    json_schema: dict[str, Any] | None = None
    temperature: float = 0.0


@dataclass(frozen=True)
class LLMResponse:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


class Provider(Protocol):
    def generate(self, req: LLMRequest) -> LLMResponse: ...


class TransientError(RuntimeError):
    """Raise from a provider for rate limits / 5xx so the wrapper backs off."""


class LLMOutputError(RuntimeError):
    def __init__(self, message: str, raw: str) -> None:
        super().__init__(message)
        self.raw = raw


class Cache(Protocol):
    def get(self, key: str) -> str | None: ...

    def set(self, key: str, value: str) -> None: ...


class DiskCache:
    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    def get(self, key: str) -> str | None:
        p = self.root / f"{key}.json"
        return p.read_text() if p.exists() else None

    def set(self, key: str, value: str) -> None:
        (self.root / f"{key}.json").write_text(value)


class MemoryCache:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.data.get(key)

    def set(self, key: str, value: str) -> None:
        self.data[key] = value


class Tracer(Protocol):
    def record(self, event: dict[str, Any]) -> None: ...


class NullTracer:
    def record(self, event: dict[str, Any]) -> None:
        return None


class ListTracer:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def record(self, event: dict[str, Any]) -> None:
        self.events.append(event)


class LangfuseTracer:
    """Sends one generation per call. Never sends media bytes or secrets."""

    def __init__(self) -> None:
        from langfuse import Langfuse

        self._lf = Langfuse()

    def record(self, event: dict[str, Any]) -> None:
        self._lf.create_event(
            name=event["name"],
            input={"prompt": event.get("prompt", "")[:4000], "media": event.get("media", [])},
            output=event.get("output", "")[:4000],
            metadata={k: v for k, v in event.items() if k not in {"prompt", "output"}},
        )


@dataclass
class LLM:
    provider: Provider
    cache: Cache | None = None
    tracer: Tracer = field(default_factory=NullTracer)
    sleep: Callable[[float], None] = time.sleep
    max_transient_retries: int = 4

    def structured(
        self,
        name: str,
        req: LLMRequest,
        schema: type[T],
        *,
        workspace_id: str | None = None,
    ) -> T:
        req = LLMRequest(
            model=req.model,
            system=req.system,
            prompt=req.prompt,
            media=req.media,
            json_schema=req.json_schema or schema.model_json_schema(),
            temperature=req.temperature,
        )
        key = cache_key(req, schema)
        if self.cache and (hit := self.cache.get(key)) is not None:
            self.tracer.record({"name": name, "cached": True, "workspace_id": workspace_id})
            return schema.model_validate_json(hit)

        attempt_req = req
        last_raw = ""
        for attempt in range(2):  # original + one validation retry
            started = time.monotonic()
            resp = self._call(attempt_req)
            last_raw = resp.text
            self.tracer.record(
                {
                    "name": name,
                    "model": req.model,
                    "workspace_id": workspace_id,
                    "attempt": attempt,
                    "latency_s": round(time.monotonic() - started, 3),
                    "input_tokens": resp.input_tokens,
                    "output_tokens": resp.output_tokens,
                    "cost_usd": resp.cost_usd,
                    "prompt": req.prompt,
                    "media": [m.path.name for m in req.media],
                    "output": resp.text,
                    "cached": False,
                }
            )
            try:
                parsed = schema.model_validate_json(_strip_fences(resp.text))
            except ValidationError as exc:
                attempt_req = LLMRequest(
                    model=req.model,
                    system=req.system,
                    prompt=(
                        f"{req.prompt}\n\nYour previous answer failed validation:\n"
                        f"{_short(str(exc))}\nReturn only JSON that matches the schema."
                    ),
                    media=req.media,
                    json_schema=req.json_schema,
                    temperature=req.temperature,
                )
                continue
            if self.cache:
                self.cache.set(key, parsed.model_dump_json())
            return parsed
        raise LLMOutputError(f"{name}: output failed schema validation twice", last_raw)

    def _call(self, req: LLMRequest) -> LLMResponse:
        delay = 2.0
        for attempt in range(self.max_transient_retries + 1):
            try:
                return self.provider.generate(req)
            except TransientError:
                if attempt == self.max_transient_retries:
                    raise
                self.sleep(delay)
                delay = min(delay * 2, 60)
        raise AssertionError("unreachable")


def cache_key(req: LLMRequest, schema: type[BaseModel]) -> str:
    h = hashlib.sha256()
    h.update(
        json.dumps(
            {
                "model": req.model,
                "system": req.system,
                "prompt": req.prompt,
                "schema": schema.model_json_schema(),
                "temperature": req.temperature,
            },
            sort_keys=True,
        ).encode()
    )
    for m in req.media:
        h.update(m.mime_type.encode())
        h.update(_file_hash(m.path).encode())
    return h.hexdigest()


def _file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        if t.rstrip().endswith("```"):
            t = t.rstrip()[:-3]
    return t.strip()


def _short(s: str, n: int = 1500) -> str:
    return s if len(s) <= n else s[:n] + "…"
