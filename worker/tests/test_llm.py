from pathlib import Path

import pytest
from pydantic import BaseModel

from mosaic.llm import (
    LLM,
    ListTracer,
    LLMOutputError,
    LLMRequest,
    LLMResponse,
    MediaPart,
    MemoryCache,
    TransientError,
)


class Out(BaseModel):
    answer: int


class Scripted:
    def __init__(self, *outputs: object) -> None:
        self.outputs = list(outputs)
        self.requests: list[LLMRequest] = []

    def generate(self, req: LLMRequest) -> LLMResponse:
        self.requests.append(req)
        nxt = self.outputs.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return LLMResponse(text=str(nxt), input_tokens=10, output_tokens=5, cost_usd=0.001)


REQ = LLMRequest(model="m", system="s", prompt="p")


def test_validates_and_traces() -> None:
    tracer = ListTracer()
    out = LLM(Scripted('{"answer": 4}'), tracer=tracer).structured("t", REQ, Out, workspace_id="ws")
    assert out.answer == 4
    (ev,) = tracer.events
    assert ev["workspace_id"] == "ws" and ev["cost_usd"] == 0.001 and not ev["cached"]


def test_strips_code_fences() -> None:
    assert LLM(Scripted('```json\n{"answer": 1}\n```')).structured("t", REQ, Out).answer == 1


def test_retries_once_with_validation_error_then_fails() -> None:
    p = Scripted('{"answer": "x"}', '{"answer": 2}')
    assert LLM(p).structured("t", REQ, Out).answer == 2
    assert "failed validation" in p.requests[1].prompt
    with pytest.raises(LLMOutputError):
        LLM(Scripted("nope", "still nope")).structured("t", REQ, Out)


def test_backs_off_on_transient_errors() -> None:
    sleeps: list[float] = []
    p = Scripted(TransientError("429"), TransientError("503"), '{"answer": 3}')
    assert LLM(p, sleep=sleeps.append).structured("t", REQ, Out).answer == 3
    assert sleeps == [2.0, 4.0]


def test_cache_keys_on_media_content(tmp_path: Path) -> None:
    f = tmp_path / "a.png"
    f.write_bytes(b"one")
    cache = MemoryCache()
    req = LLMRequest(model="m", system="s", prompt="p", media=(MediaPart(f, "image/png"),))
    p = Scripted('{"answer": 1}', '{"answer": 2}')
    llm = LLM(p, cache=cache)
    assert llm.structured("t", req, Out).answer == 1
    assert llm.structured("t", req, Out).answer == 1  # cached, provider not called
    assert len(p.requests) == 1
    f.write_bytes(b"two")  # changed media → new key
    assert llm.structured("t", req, Out).answer == 2


def test_gemini_provider_uploads_each_file_once_across_retries(tmp_path: Path) -> None:
    from types import SimpleNamespace as NS

    from mosaic.providers import GeminiProvider

    uploads: list[str] = []

    class Files:
        def upload(self, file: str, config: dict) -> NS:  # type: ignore[type-arg]
            uploads.append(file)
            return NS(name="f1", state=NS(name="ACTIVE"))

    calls = {"n": 0}

    class Models:
        def generate_content(self, **kw: object) -> NS:
            calls["n"] += 1
            return NS(text='{"answer": 1}', usage_metadata=None)

    p = GeminiProvider("k", client=NS(files=Files(), models=Models()))
    f = tmp_path / "v.mp4"
    f.write_bytes(b"x")
    req = LLMRequest(model="m", system="s", prompt="p", media=(MediaPart(f, "video/mp4"),))
    p.generate(req)
    p.generate(req)
    assert uploads == [str(f)] and calls["n"] == 2


def test_daily_quota_is_not_retried() -> None:
    from mosaic.llm import QuotaExhausted
    from mosaic.providers import _retry_delay_s

    assert _retry_delay_s("... 'retryDelay': '46330s' ...") == 46330
    assert _retry_delay_s("no delay here") == 0
    sleeps: list[float] = []
    p = Scripted(QuotaExhausted("daily cap"), '{"answer": 1}')
    with pytest.raises(QuotaExhausted):
        LLM(p, sleep=sleeps.append).structured("t", REQ, Out)
    assert sleeps == [] and len(p.requests) == 1
