"""Model provider adapters for mosaic.llm."""

from __future__ import annotations

import re
import time
from typing import Any

from mosaic.llm import LLMRequest, LLMResponse, QuotaExhausted, TransientError

# USD per 1M tokens (input, output). Update when pricing changes.
GEMINI_PRICES: dict[str, tuple[float, float]] = {
    "gemini-3.5-flash": (1.50, 9.00),
    "gemini-3.5-flash-lite": (0.30, 2.50),
}


class GeminiProvider:
    """Gemini via google-genai. Video/images are uploaded through the Files API."""

    REQUEST_TIMEOUT_MS = 180_000

    def __init__(self, api_key: str, client: Any | None = None) -> None:
        if client is None:
            from google import genai
            from google.genai import types

            # A bounded timeout and no SDK-level retries: mosaic.llm owns the backoff,
            # so a stalled request fails fast instead of hanging a batch for hours.
            client = genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(
                    timeout=self.REQUEST_TIMEOUT_MS,
                    retry_options=types.HttpRetryOptions(attempts=1),
                ),
            )
        self._client = client
        # (path, mtime, size) -> uploaded file, so retries don't re-upload large videos.
        # Gemini keeps uploads for 48 hours; a process never lives that long.
        self._uploads: dict[tuple[str, float, int], Any] = {}

    def generate(self, req: LLMRequest) -> LLMResponse:
        from google.genai import errors, types

        parts: list[Any] = []
        for m in req.media:
            parts.append(self._upload(m.path, m.mime_type))
        parts.append(req.prompt)
        config = types.GenerateContentConfig(
            system_instruction=req.system,
            temperature=req.temperature,
            response_mime_type="application/json",
            response_json_schema=req.json_schema,
        )
        try:
            resp = self._client.models.generate_content(
                model=req.model, contents=parts, config=config
            )
        except errors.APIError as exc:
            code = getattr(exc, "code", None)
            if code == 429 and _retry_delay_s(str(exc)) > 120:
                raise QuotaExhausted(str(exc)) from exc
            if code in (429, 500, 502, 503, 504):
                raise TransientError(str(exc)) from exc
            raise
        except Exception as exc:
            if "timeout" in type(exc).__name__.lower() or "timed out" in str(exc).lower():
                raise TransientError(f"request timed out: {exc}") from exc
            raise
        usage = getattr(resp, "usage_metadata", None)
        tin = int(getattr(usage, "prompt_token_count", 0) or 0)
        tout = int(getattr(usage, "candidates_token_count", 0) or 0)
        pin, pout = GEMINI_PRICES.get(req.model, (0.0, 0.0))
        return LLMResponse(
            text=resp.text or "",
            input_tokens=tin,
            output_tokens=tout,
            cost_usd=round(tin / 1e6 * pin + tout / 1e6 * pout, 6),
        )

    def _upload(self, path: Any, mime_type: str) -> Any:
        st = path.stat()
        key = (str(path), st.st_mtime, st.st_size)
        if key not in self._uploads:
            uploaded = self._client.files.upload(file=str(path), config={"mime_type": mime_type})
            self._uploads[key] = self._wait_active(uploaded)
        return self._uploads[key]

    def _wait_active(self, f: Any, timeout_s: float = 300) -> Any:
        deadline = time.monotonic() + timeout_s
        while getattr(getattr(f, "state", None), "name", "ACTIVE") == "PROCESSING":
            if time.monotonic() > deadline:
                raise TransientError("Gemini file processing timed out")
            time.sleep(2)
            f = self._client.files.get(name=f.name)
        return f


EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIM = 1024  # matches creative_embeddings.embedding vector(1024)


class GeminiEmbedder:
    """Text embeddings, L2-normalized (truncated Gemini embeddings are not unit length)."""

    model = EMBEDDING_MODEL

    def __init__(self, api_key: str, client: Any | None = None) -> None:
        if client is None:
            from google import genai

            client = genai.Client(api_key=api_key)
        self._client = client

    def embed(self, texts: list[str]) -> list[list[float]]:
        from google.genai import types

        out: list[list[float]] = []
        for i in range(0, len(texts), 100):
            resp = self._client.models.embed_content(
                model=self.model,
                contents=texts[i : i + 100],
                config=types.EmbedContentConfig(
                    output_dimensionality=EMBEDDING_DIM, task_type="SEMANTIC_SIMILARITY"
                ),
            )
            for e in resp.embeddings:
                v = list(e.values)
                norm = sum(x * x for x in v) ** 0.5 or 1.0
                out.append([x / norm for x in v])
        return out


def _retry_delay_s(message: str) -> float:
    """Gemini puts a RetryInfo delay like '46330s' in quota errors; 0 if absent."""
    m = re.search(r"retryDelay'?\"?:\s*'?\"?(\d+(?:\.\d+)?)s", message)
    return float(m.group(1)) if m else 0.0
