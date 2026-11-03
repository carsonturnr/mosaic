"""Disconnecting Meta and deleting a workspace (what /data-deletion promises).

Every workspace table cascades from `workspaces`, so deleting the row removes the
database side. Two things live outside it: the Meta token in Vault and the media
files in Storage, so those are removed first.
"""

from __future__ import annotations

from mosaic.media import Storage
from mosaic.store import Store
from mosaic.vault import delete_token


def disconnect_meta(store: Store, workspace_id: str) -> int:
    """Delete the stored Meta token and the Meta data source; syncing stops."""
    sources = store.select(
        "data_sources",
        "id,token_secret_id",
        workspace_id=workspace_id,
        kind=["meta_live", "meta_sandbox"],
    )
    for ds in sources:
        if ds.get("token_secret_id"):
            delete_token(store, ds["token_secret_id"])
        store.delete("data_sources", id=ds["id"])
    return len(sources)


def media_paths(store: Store, workspace_id: str) -> list[str]:
    """Every Storage object the workspace owns. Only paths under its own prefix count,
    so a thumbnail that is an outside URL is never passed to Storage."""
    creatives = store.select(
        "creatives", "id,storage_path,thumbnail_path", workspace_id=workspace_id
    )
    paths = {p for c in creatives for p in (c.get("storage_path"), c.get("thumbnail_path")) if p}
    ids = [c["id"] for c in creatives]
    for i in range(0, len(ids), 100):
        scenes = store.select("scenes", "keyframe_path", creative_id=ids[i : i + 100])
        paths |= {s["keyframe_path"] for s in scenes if s.get("keyframe_path")}
    return sorted(p for p in paths if p.startswith(f"{workspace_id}/"))


def delete_workspace(store: Store, storage: Storage, workspace_id: str) -> dict[str, int]:
    disconnected = disconnect_meta(store, workspace_id)
    paths = media_paths(store, workspace_id)
    if paths:
        storage.remove(paths)
    store.delete("workspaces", id=workspace_id)
    return {"meta_sources": disconnected, "files": len(paths)}
