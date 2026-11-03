"""Put Mosaic's own test ads into the Meta sandbox account, and point a workspace at it.

    uv run python -m mosaic.sandbox upload ../media/mosaic
    uv run python -m mosaic.sandbox workspace --owner-email you@example.com

`upload` reads the folder's manifest.json (from scripts/make_mosaic_ads.py) and creates
one paused ad per entry in the sandbox ad set, skipping ads that already exist by name.
`workspace` creates the "Mosaic" workspace with a `meta_sandbox` data source and runs the
first sync and perception, so the ads are tagged and get synthetic results.
Uses the system user token (META_ACCESS_TOKEN); sandbox ads never deliver.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from mosaic.config import Settings
from mosaic.datasources.meta import MetaClient

SANDBOX_ADSET = "120330001596476119"
SANDBOX_PAGE = "1413908748461370"
WORKSPACE_NAME = "Mosaic"
AD_PREFIX = "Mosaic · "


def client(settings: Settings) -> MetaClient:
    if not settings.meta_access_token:
        raise SystemExit("META_ACCESS_TOKEN (the system user token) is not set")
    return MetaClient(
        settings.meta_access_token,
        app_secret=settings.meta_app_secret,
        version=settings.meta_graph_version,
    )


def upload_image(meta: MetaClient, account: str, path: Path) -> str:
    with path.open("rb") as f:
        body = meta.post(f"{account}/adimages", {}, files={path.name: (path.name, f)})
    return str(next(iter(body["images"].values()))["hash"])


def upload_video(meta: MetaClient, account: str, path: Path, wait_s: int = 300) -> str:
    with path.open("rb") as f:
        body = meta.post(
            f"{account}/advideos", {"name": path.stem}, files={"source": (path.name, f)}
        )
    video_id = str(body["id"])
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        status = (meta.get(video_id, {"fields": "status"}).get("status") or {}).get("video_status")
        if status == "ready":
            return video_id
        if status == "error":
            raise RuntimeError(f"Meta could not process {path.name}")
        time.sleep(5)
    raise RuntimeError(f"{path.name} was still processing after {wait_s}s")


def story_spec(entry: dict[str, Any], media: dict[str, str]) -> dict[str, Any]:
    cta = {"type": entry["cta"], "value": {"link": entry["link"]}}
    if entry["type"] == "video":
        return {
            "page_id": SANDBOX_PAGE,
            "video_data": {
                "video_id": media["video_id"],
                "image_hash": media["image_hash"],
                "message": entry["primary_text"],
                "title": entry["headline"],
                "call_to_action": cta,
            },
        }
    return {
        "page_id": SANDBOX_PAGE,
        "link_data": {
            "image_hash": media["image_hash"],
            "link": entry["link"],
            "message": entry["primary_text"],
            "name": entry["headline"],
            "call_to_action": cta,
        },
    }


def upload(settings: Settings, folder: Path, adset: str = SANDBOX_ADSET) -> list[str]:
    """Create a paused ad per manifest entry; returns the new ad ids."""
    account = settings.meta_sandbox_ad_account_id
    if not account:
        raise SystemExit("META_SANDBOX_AD_ACCOUNT_ID is not set")
    meta = client(settings)
    manifest = json.loads((folder / "manifest.json").read_text())
    existing = {a["name"] for a in meta.get_all(f"{account}/ads", {"fields": "name"})}
    created: list[str] = []
    for entry in manifest:
        name = AD_PREFIX + entry["key"]
        if name in existing:
            print(f"skip {entry['key']}: already in the sandbox")
            continue
        if entry["type"] == "video":
            media = {
                "video_id": upload_video(meta, account, folder / entry["file"]),
                "image_hash": upload_image(meta, account, folder / entry["thumb"]),
            }
        else:
            media = {"image_hash": upload_image(meta, account, folder / entry["file"])}
        creative = meta.post(
            f"{account}/adcreatives",
            {"name": name, "object_story_spec": json.dumps(story_spec(entry, media))},
        )
        ad = meta.post(
            f"{account}/ads",
            {
                "name": name,
                "adset_id": adset,
                "creative": json.dumps({"creative_id": creative["id"]}),
                "status": "PAUSED",
            },
        )
        created.append(str(ad["id"]))
        print(f"{entry['key']}: ad {ad['id']}")
    return created


def ensure_workspace(settings: Settings, owner_email: str) -> dict[str, Any]:
    """The Mosaic workspace and its meta_sandbox source; then sync, tag and analyze."""
    from mosaic import jobs
    from mosaic.media import SupabaseStorage
    from mosaic.seed import ensure_owner
    from mosaic.store import SupabaseStore
    from mosaic.vault import store_token

    store = SupabaseStore(settings.supabase_url, settings.supabase_service_role_key)
    owner = ensure_owner(store.client, owner_email)
    rows = store.select("workspaces", "id", owner_id=owner, name=WORKSPACE_NAME)
    ws = (
        rows[0]["id"]
        if rows
        else store.insert("workspaces", {"owner_id": owner, "name": WORKSPACE_NAME})["id"]
    )
    sources = store.select("data_sources", "*", workspace_id=ws, kind="meta_sandbox")
    ds = (
        sources[0]
        if sources
        else store.insert(
            "data_sources",
            {
                "workspace_id": ws,
                "kind": "meta_sandbox",
                "meta_ad_account_id": settings.meta_sandbox_ad_account_id,
            },
        )
    )
    if not ds.get("token_secret_id") and settings.meta_access_token:
        # Scheduled jobs on Modal read the token from Vault, like a live account's.
        secret = store_token(store, ws, settings.meta_access_token)
        store.update("data_sources", {"token_secret_id": secret}, id=ds["id"])
    ds = store.select("data_sources", "*", id=ds["id"])[0]  # with created_at
    structure = jobs.structure(store, settings, ds)
    perceive = jobs.perceive(store, settings, ds, SupabaseStorage(store.client))
    return {
        "workspace_id": ws,
        "data_source_id": ds["id"],
        "structure": structure.get("stats"),
        "perceive": perceive.get("stats") or perceive.get("error"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    up = sub.add_parser("upload", help="create paused sandbox ads from a manifest folder")
    up.add_argument("folder", type=Path)
    up.add_argument("--adset", default=SANDBOX_ADSET)
    ws = sub.add_parser("workspace", help="create the Mosaic workspace and run the first sync")
    ws.add_argument("--owner-email", required=True)
    args = parser.parse_args()
    settings = Settings.from_env()
    if args.cmd == "upload":
        print(f"{len(upload(settings, args.folder, args.adset))} ads created")
    else:
        print(json.dumps(ensure_workspace(settings, args.owner_email), indent=2, default=str))


if __name__ == "__main__":
    main()
