"""Environment-backed settings. Loads the repo-root .env when present."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _find_dotenv(start: Path | None = None) -> Path | None:
    """Nearest .env walking up from `start` (default: this file). None in deployed
    images (Modal), where configuration comes from injected secrets instead."""
    for parent in (start or Path(__file__)).resolve().parents:
        candidate = parent / ".env"
        if candidate.is_file():
            return candidate
    return None


if (_dotenv := _find_dotenv()) is not None:
    load_dotenv(_dotenv)


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is not set (see .env.example)")
    return value


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    meta_app_id: str
    meta_app_secret: str | None
    meta_access_token: str | None
    meta_graph_version: str
    meta_sandbox_ad_account_id: str | None
    gemini_api_key: str | None = None
    anthropic_api_key: str | None = None

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            supabase_url=_require("SUPABASE_URL"),
            supabase_service_role_key=_require("SUPABASE_SERVICE_ROLE_KEY"),
            meta_app_id=os.environ.get("META_APP_ID", "4146949778771922"),
            meta_app_secret=os.environ.get("META_APP_SECRET") or None,
            meta_access_token=os.environ.get("META_ACCESS_TOKEN") or None,
            meta_graph_version=os.environ.get("META_GRAPH_VERSION", "v26.0"),
            meta_sandbox_ad_account_id=os.environ.get("META_SANDBOX_AD_ACCOUNT_ID") or None,
            gemini_api_key=os.environ.get("GEMINI_API_KEY") or None,
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY") or None,
        )
