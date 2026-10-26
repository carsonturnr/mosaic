from datetime import date
from typing import Any

import httpx
import respx
from fastapi.testclient import TestClient

from mosaic import api, jobs
from mosaic.config import Settings
from mosaic.datasources.meta import GRAPH
from mosaic.store import MemoryStore
from mosaic.vault import read_token, store_token

SETTINGS = Settings(
    supabase_url="http://x",
    supabase_service_role_key="k",
    meta_app_id="app",
    meta_app_secret="secret",
    meta_access_token=None,
    meta_graph_version="v26.0",
    meta_sandbox_ad_account_id=None,
)


def _store_with_synthetic_source() -> tuple[MemoryStore, dict[str, Any]]:
    store = MemoryStore()
    ds = store.insert(
        "data_sources", {"workspace_id": "ws", "kind": "sandbox_synthetic", "token_secret_id": None}
    )
    return store, ds


def test_vault_round_trip_in_memory() -> None:
    store = MemoryStore()
    sid = store_token(store, "ws", "tok1")
    assert read_token(store, sid) == "tok1"
    assert store_token(store, "ws", "tok2") == sid  # same name updates in place
    assert read_token(store, sid) == "tok2"


def test_backfill_then_refresh_records_runs(monkeypatch: Any) -> None:
    monkeypatch.setattr(jobs, "_today", lambda: date(2026, 10, 18))
    store, ds = _store_with_synthetic_source()
    runs = jobs.backfill(store, SETTINGS, ds, days=10)
    assert [r["job"] for r in runs] == ["structure", "backfill", "analyze"]
    assert runs[0]["stats"]["ads"] == 24 and runs[1]["stats"]["rows"] > 0
    jobs.refresh(store, SETTINGS, "ws")
    assert [r["job"] for r in store.tables["sync_runs"]] == [
        "structure",
        "backfill",
        "analyze",
        "structure",
        "today_kpis",
        "analyze",
    ]
    snaps = {r["window_key"]: r for r in store.tables["analysis_snapshots"]}
    assert set(snaps) == {"7", "30", "90", "all"}
    assert snaps["all"]["payload"]["ads"]
    assert all(r["status"] == "done" for r in store.tables["sync_runs"])


def test_for_all_sources_isolates_failures() -> None:
    store, _ = _store_with_synthetic_source()
    store.insert(
        "data_sources", {"workspace_id": "ws2", "kind": "meta_live", "token_secret_id": None}
    )
    results = jobs.for_all_sources(store, SETTINGS, "structure")
    assert [r["status"] for r in results] == ["done", "failed"]
    assert "no token" in results[1]["error"]


def _client(store: MemoryStore) -> TestClient:
    api.deps.store_factory = lambda: store
    api.deps.settings_factory = lambda: SETTINGS
    api.deps.verify_jwt = lambda tok: {"user-jwt": "u1", "other-jwt": "u2"}.get(tok)
    return TestClient(api.app)


def test_api_requires_key(monkeypatch: Any) -> None:
    monkeypatch.setenv("WORKER_API_KEY", "k1")
    store, _ = _store_with_synthetic_source()
    c = _client(store)
    assert c.get("/health").status_code == 200
    assert c.post("/workspaces/ws/refresh").status_code == 401
    bad = c.post("/workspaces/ws/refresh", headers={"Authorization": "Bearer nope"})
    assert bad.status_code == 401
    r = c.post("/workspaces/ws/refresh", headers={"Authorization": "Bearer k1"})
    assert r.status_code == 200
    assert [x["job"] for x in r.json()["runs"]] == ["structure", "today_kpis", "analyze"]


def test_api_accepts_owner_jwt_and_rejects_other_users(monkeypatch: Any) -> None:
    monkeypatch.setenv("WORKER_API_KEY", "k1")
    store, _ = _store_with_synthetic_source()
    store.insert("workspaces", {"id": "ws", "owner_id": "u1", "name": "W"})
    c = _client(store)
    ok = c.post("/workspaces/ws/refresh", headers={"Authorization": "Bearer user-jwt"})
    assert ok.status_code == 200
    other = c.post("/workspaces/ws/refresh", headers={"Authorization": "Bearer other-jwt"})
    assert other.status_code == 404
    bad = c.post("/workspaces/ws/refresh", headers={"Authorization": "Bearer garbage"})
    assert bad.status_code == 401


@respx.mock
def test_meta_connect_exchanges_token_stores_it_and_backfills(monkeypatch: Any) -> None:
    monkeypatch.setenv("WORKER_API_KEY", "k1")
    monkeypatch.setattr(jobs, "_today", lambda: date(2026, 10, 18))
    respx.get(f"{GRAPH}/v26.0/oauth/access_token").mock(
        return_value=httpx.Response(200, json={"access_token": "LONG", "expires_in": 5184000})
    )
    for edge in ("campaigns", "adsets", "ads"):
        respx.get(f"{GRAPH}/v26.0/act_99/{edge}").mock(
            return_value=httpx.Response(200, json={"data": []})
        )
    store = MemoryStore()
    c = _client(store)
    r = c.post(
        "/workspaces/ws/meta/connect",
        json={"user_access_token": "SHORT", "ad_account_id": "99"},
        headers={"Authorization": "Bearer k1"},
    )
    assert r.status_code == 200, r.text
    ds = store.tables["data_sources"][0]
    assert ds["kind"] == "meta_live" and ds["meta_ad_account_id"] == "act_99"
    assert read_token(store, ds["token_secret_id"]) == "LONG"
    # TestClient runs background tasks before returning
    assert [x["job"] for x in store.tables["sync_runs"]] == ["structure", "backfill", "analyze"]
    # reconnecting updates the same data source and rotates the secret in place
    c.post(
        "/workspaces/ws/meta/connect",
        json={"user_access_token": "SHORT2", "ad_account_id": "act_99"},
        headers={"Authorization": "Bearer k1"},
    )
    assert len(store.tables["data_sources"]) == 1
    assert read_token(store, ds["token_secret_id"]) == "LONG"


def test_dotenv_lookup_walks_up_and_tolerates_absence(tmp_path: Any) -> None:
    """Modal puts the package at /root/mosaic with no .env; a fixed parents[3]
    lookup raised IndexError there and crashed every deployed function."""
    from pathlib import Path

    from mosaic.config import _find_dotenv

    # shallow path like the Modal image: must return None, not raise
    assert _find_dotenv(Path("/mosaic/config.py")) is None
    deep = tmp_path / "a" / "b" / "mosaic" / "config.py"
    deep.parent.mkdir(parents=True)
    assert _find_dotenv(deep) is None
    (tmp_path / "a" / ".env").write_text("X=1\n")
    assert _find_dotenv(deep) == tmp_path / "a" / ".env"


def test_structure_sync_triggers_perception_only_for_new_creatives() -> None:
    import modal_app

    assert modal_app.needs_perception([{"status": "done", "stats": {"new_creatives": 2}}])
    assert not modal_app.needs_perception([{"status": "done", "stats": {"new_creatives": 0}}])
    assert not modal_app.needs_perception([{"status": "failed", "error": "x"}])
    assert not modal_app.needs_perception([])


def test_strategist_endpoint_needs_a_key(monkeypatch: Any) -> None:
    monkeypatch.setenv("WORKER_API_KEY", "k1")
    store, _ = _store_with_synthetic_source()
    c = _client(store)
    r = c.post("/workspaces/ws/reports/strategist", headers={"Authorization": "Bearer k1"})
    assert r.status_code == 503 and "ANTHROPIC_API_KEY" in r.text


def test_agent_endpoints_queue_a_job_and_spawn_on_modal(monkeypatch: Any) -> None:
    from dataclasses import replace

    monkeypatch.setenv("WORKER_API_KEY", "k1")
    monkeypatch.setenv("MODAL_TASK_ID", "ta-test")
    store, _ = _store_with_synthetic_source()
    c = _client(store)
    api.deps.settings_factory = lambda: replace(SETTINGS, anthropic_api_key="sk-test")
    spawned: list[str] = []
    api.deps.spawn = spawned.append
    r = c.post(
        "/workspaces/ws/reports/briefs",
        json={"request": " UGC only "},
        headers={"Authorization": "Bearer k1"},
    )
    assert r.status_code == 202 and r.json()["status"] == "queued"
    job = store.tables["agent_jobs"][0]
    assert spawned == [job["id"]] and job["kind"] == "brief" and job["request"] == "UGC only"


def test_run_agent_job_records_done_and_failed() -> None:
    from types import SimpleNamespace as NS

    from mosaic.seed import seed

    store = MemoryStore()
    ws = seed(store, "owner", seed=42)["workspace_id"]
    report = {"summary": "s", "working": [], "double_down": [], "cut": [], "missing_concepts": []}
    calls = [report]
    fake = lambda **kw: NS(  # noqa: E731
        content=[NS(type="tool_use", id="t", name="submit_report", input=calls.pop(0))],
        stop_reason="tool_use",
        usage=NS(input_tokens=1, output_tokens=1),
    )
    job = store.insert("agent_jobs", {"workspace_id": ws, "kind": "strategist", "status": "queued"})
    done = jobs.run_agent_job(store, SETTINGS, job["id"], create=fake)
    assert done["status"] == "done" and done["report_id"] and done["finished_at"]
    bad = store.insert(
        "agent_jobs", {"workspace_id": "no-analysis", "kind": "brief", "status": "queued"}
    )
    failed = jobs.run_agent_job(store, SETTINGS, bad["id"], create=fake)
    assert failed["status"] == "failed" and "no analysis" in failed["error"]


def test_perception_only_runs_on_live_meta_sources() -> None:
    import pytest

    assert jobs.has_real_media({"kind": "meta_live"})
    for kind in ("sandbox_synthetic", "demo"):
        assert not jobs.has_real_media({"kind": kind})
        with pytest.raises(ValueError):
            jobs.perceive(
                MemoryStore(),
                SETTINGS,
                {"id": "d", "workspace_id": "w", "kind": kind},
                storage=None,
            )
