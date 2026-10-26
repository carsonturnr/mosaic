"""Worker HTTP API (FastAPI). Deployed on Modal; the web app calls it for actions.

Auth: `Authorization: Bearer <WORKER_API_KEY>`. Workspace-level authorization is the
web app's job (it only ever calls with its own workspace ids after RLS reads).
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from mosaic import jobs
from mosaic.config import Settings
from mosaic.datasources.meta import GRAPH, MetaAPIError, MetaClient
from mosaic.store import Store, SupabaseStore
from mosaic.vault import store_token


class Deps:
    """Resolved lazily so tests can swap the store and settings."""

    store_factory: Callable[[], Store]
    settings_factory: Callable[[], Settings]
    verify_jwt: Callable[[str], str | None]
    spawn: Callable[[str], None]

    def __init__(self) -> None:
        self.settings_factory = Settings.from_env
        self.store_factory = self._default_store
        self.verify_jwt = lambda token: verify_supabase_jwt(token)
        self.spawn = lambda job_id: _spawn_modal(job_id)

    def _default_store(self) -> Store:
        s = self.settings_factory()
        return SupabaseStore(s.supabase_url, s.supabase_service_role_key)


deps = Deps()
app = FastAPI(title="Mosaic worker")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@dataclass(frozen=True)
class Principal:
    kind: Literal["service", "user"]
    user_id: str | None = None


def verify_supabase_jwt(token: str) -> str | None:
    """Return the user id for a Supabase session JWT, or None if invalid."""
    settings = deps.settings_factory()
    from supabase import create_client

    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    try:
        res = client.auth.get_user(token)
    except Exception:
        return None
    return res.user.id if res and res.user else None


def authenticate(authorization: Annotated[str | None, Header()] = None) -> Principal:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token")
    token = authorization.removeprefix("Bearer ")
    expected = os.environ.get("WORKER_API_KEY")
    if expected and token == expected:
        return Principal(kind="service")
    user_id = deps.verify_jwt(token)
    if user_id:
        return Principal(kind="user", user_id=user_id)
    raise HTTPException(401, "invalid token")


Auth = Annotated[Principal, Depends(authenticate)]


def require_workspace(store: Store, principal: Principal, workspace_id: str) -> None:
    if principal.kind == "service":
        return
    rows = store.select("workspaces", "id", id=workspace_id, owner_id=principal.user_id)
    if not rows:
        raise HTTPException(404, "workspace not found")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/workspaces/{workspace_id}/refresh")
def refresh(workspace_id: str, principal: Auth) -> dict[str, Any]:
    store, settings = deps.store_factory(), deps.settings_factory()
    require_workspace(store, principal, workspace_id)
    runs = jobs.refresh(store, settings, workspace_id)
    return {
        "runs": [{"job": r["job"], "status": r["status"], "stats": r.get("stats")} for r in runs]
    }


@app.post("/workspaces/{workspace_id}/analyze")
def analyze(workspace_id: str, principal: Auth) -> dict[str, Any]:
    store = deps.store_factory()
    require_workspace(store, principal, workspace_id)
    from mosaic.analytics.run import analyze_workspace

    return analyze_workspace(store, workspace_id).model_dump()


class AgentJobRequest(BaseModel):
    request: str | None = None


def _spawn_modal(job_id: str) -> None:
    import modal

    modal.Function.from_name("mosaic", "agent_job").spawn(job_id)


def queue_agent_job(
    workspace_id: str,
    kind: str,
    principal: Principal,
    background: BackgroundTasks,
    request: str | None = None,
) -> dict[str, Any]:
    store, settings = deps.store_factory(), deps.settings_factory()
    require_workspace(store, principal, workspace_id)
    if not settings.anthropic_api_key:
        raise HTTPException(503, "Reports need ANTHROPIC_API_KEY on the worker")
    job = store.insert(
        "agent_jobs",
        {"workspace_id": workspace_id, "kind": kind, "request": (request or "").strip() or None},
    )
    if os.environ.get("MODAL_TASK_ID"):
        # On Modal the job runs in its own function: agent runs outlast one web request.
        deps.spawn(job["id"])
    else:
        background.add_task(jobs.run_agent_job, store, settings, job["id"])
    return {"job_id": job["id"], "status": "queued"}


@app.post("/workspaces/{workspace_id}/reports/strategist", status_code=202)
def strategist_report(
    workspace_id: str, principal: Auth, background: BackgroundTasks
) -> dict[str, Any]:
    return queue_agent_job(workspace_id, "strategist", principal, background)


@app.post("/workspaces/{workspace_id}/reports/briefs", status_code=202)
def briefs_report(
    workspace_id: str,
    principal: Auth,
    background: BackgroundTasks,
    body: AgentJobRequest | None = None,
) -> dict[str, Any]:
    return queue_agent_job(
        workspace_id, "brief", principal, background, body.request if body else None
    )


class MetaAdAccount(BaseModel):
    id: str
    name: str
    account_status: int | None = None
    currency: str | None = None


class MetaAdAccountsRequest(BaseModel):
    user_access_token: str


@app.post("/meta/adaccounts")
def meta_ad_accounts(body: MetaAdAccountsRequest, _principal: Auth) -> list[MetaAdAccount]:
    settings = deps.settings_factory()
    client = MetaClient(
        body.user_access_token,
        app_secret=settings.meta_app_secret,
        version=settings.meta_graph_version,
    )
    try:
        rows = client.get_all("me/adaccounts", {"fields": "id,name,account_status,currency"})
    except MetaAPIError as exc:
        raise HTTPException(400, str(exc)) from exc
    return [MetaAdAccount.model_validate(r) for r in rows]


class MetaConnectRequest(BaseModel):
    user_access_token: str  # short-lived token from the JS SDK login
    ad_account_id: str


class MetaConnectResponse(BaseModel):
    data_source_id: str
    backfill_started: bool


@app.post("/workspaces/{workspace_id}/meta/connect")
def meta_connect(
    workspace_id: str, body: MetaConnectRequest, background: BackgroundTasks, principal: Auth
) -> MetaConnectResponse:
    store, settings = deps.store_factory(), deps.settings_factory()
    require_workspace(store, principal, workspace_id)
    if not settings.meta_app_secret:
        raise HTTPException(500, "META_APP_SECRET is not configured")

    long_lived = exchange_long_lived_token(settings, body.user_access_token)
    secret_id = store_token(store, workspace_id, long_lived)

    acct = body.ad_account_id
    account = acct if acct.startswith("act_") else f"act_{acct}"
    existing = store.select("data_sources", "id", workspace_id=workspace_id, kind="meta_live")
    if existing:
        ds_id = existing[0]["id"]
        store.update(
            "data_sources",
            {"meta_ad_account_id": account, "token_secret_id": secret_id},
            id=ds_id,
        )
    else:
        ds_id = store.insert(
            "data_sources",
            {
                "workspace_id": workspace_id,
                "kind": "meta_live",
                "meta_ad_account_id": account,
                "token_secret_id": secret_id,
            },
        )["id"]

    ds = store.select("data_sources", "*", id=ds_id)[0]
    background.add_task(jobs.backfill, store, settings, ds)
    return MetaConnectResponse(data_source_id=ds_id, backfill_started=True)


def exchange_long_lived_token(settings: Settings, short_lived: str) -> str:
    """Short-lived user token (hours) -> long-lived (about 60 days)."""
    client = MetaClient(short_lived, version=settings.meta_graph_version)
    try:
        body = client.get(
            "oauth/access_token",
            {
                "grant_type": "fb_exchange_token",
                "client_id": settings.meta_app_id,
                "client_secret": settings.meta_app_secret,
                "fb_exchange_token": short_lived,
            },
        )
    except MetaAPIError as exc:
        raise HTTPException(400, f"token exchange failed: {exc}") from exc
    token = body.get("access_token")
    if not token:
        raise HTTPException(400, "token exchange returned no access_token")
    return str(token)


__all__ = ["GRAPH", "app", "deps"]
