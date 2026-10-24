"""Model provider adapters for mosaic.llm."""

from __future__ import annotations

import time
from typing import Any

from mosaic.llm import LLMRequest, LLMResponse, TransientError

# USD per 1M tokens (input, output). Update when pricing changes.
GEMINI_PRICES: dict[str, tuple[float, float]] = {
    "gemini-2.5-flash": (0.30, 2.50),
}


class GeminiProvider:
    """Gemini via google-genai. Video/images are uploaded through the Files API."""

    def __init__(self, api_key: str, client: Any | None = None) -> None:
        if client is None:
            from google import genai

            client = genai.Client(api_key=api_key)
        self._client = client

    def generate(self, req: LLMRequest) -> LLMResponse:
        from google.genai import errors, types

        parts: list[Any] = []
        for m in req.media:
            uploaded = self._client.files.upload(
                file=str(m.path), config={"mime_type": m.mime_type}
            )
            uploaded = self._wait_active(uploaded)
            parts.append(uploaded)
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
            if getattr(exc, "code", None) in (429, 500, 502, 503, 504):
                raise TransientError(str(exc)) from exc
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
