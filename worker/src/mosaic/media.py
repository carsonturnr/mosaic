"""Media ingestion: pull a creative's file from its DataSource into Supabase Storage.

Storage layout (bucket `creatives`):
    {workspace_id}/{creative_id}/original.<ext>
    {workspace_id}/{creative_id}/scene_<idx>.jpg

Perception is skipped when the content hash is unchanged (docs/ARCHITECTURE.md §8).
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from mosaic.datasources.base import DataSource
from mosaic.models import Creative, CreativeType
from mosaic.store import Row, Store

BUCKET = "creatives"

_EXT = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}


class Storage(Protocol):
    def upload(self, path: str, file: Path, content_type: str) -> None: ...

    def download(self, path: str, dest: Path) -> Path: ...


class SupabaseStorage:
    def __init__(self, client: Any, bucket: str = BUCKET) -> None:
        self._bucket = client.storage.from_(bucket)

    def upload(self, path: str, file: Path, content_type: str) -> None:
        with file.open("rb") as f:
            self._bucket.upload(path, f, {"content-type": content_type, "upsert": "true"})

    def download(self, path: str, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self._bucket.download(path))
        return dest


class MemoryStorage:
    def __init__(self) -> None:
        self.files: dict[str, tuple[bytes, str]] = {}

    def upload(self, path: str, file: Path, content_type: str) -> None:
        self.files[path] = (file.read_bytes(), content_type)

    def download(self, path: str, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self.files[path][0])
        return dest


@dataclass(frozen=True)
class Probe:
    duration_s: float | None
    width: int | None
    height: int | None


def probe(path: Path) -> Probe:
    """ffprobe wrapper; returns Nones if ffprobe is missing or the file is not media."""
    try:
        out = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=60,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return Probe(None, None, None)
    data = json.loads(out or "{}")
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    dur = data.get("format", {}).get("duration") or video.get("duration")
    return Probe(
        duration_s=round(float(dur), 3) if dur else None,
        width=int(video["width"]) if video.get("width") else None,
        height=int(video["height"]) if video.get("height") else None,
    )


@dataclass(frozen=True)
class IngestResult:
    creative_id: str
    storage_path: str
    content_hash: str
    changed: bool
    local_path: Path


def ingest_creative(
    source: DataSource,
    store: Store,
    storage: Storage,
    creative_row: Row,
    work_dir: Path,
) -> IngestResult:
    """Download the creative's media, upload it to storage, update the row.

    Marks `perception_status='pending'` only when the content hash changed, so an
    unchanged creative is never re-tagged.
    """
    creative = Creative(
        external_id=creative_row["external_id"],
        type=CreativeType(creative_row["type"]),
        media_url=(creative_row.get("raw") or {}).get("media_url"),
    )
    media = source.download_media(creative)
    ext = _EXT.get(media.content_type) or media.path.suffix.lstrip(".") or "bin"
    storage_path = f"{creative_row['workspace_id']}/{creative_row['id']}/original.{ext}"
    changed = media.content_hash != creative_row.get("content_hash")

    if changed:
        storage.upload(storage_path, media.path, media.content_type)
        info = probe(media.path)
        values: Row = {
            "storage_path": storage_path,
            "content_hash": media.content_hash,
            "perception_status": "pending",
        }
        if info.duration_s is not None and creative.type is CreativeType.VIDEO:
            values["duration_s"] = info.duration_s
        if info.width and info.height:
            values["width"], values["height"] = info.width, info.height
        store.update("creatives", values, id=creative_row["id"])

    return IngestResult(
        creative_id=creative_row["id"],
        storage_path=storage_path,
        content_hash=media.content_hash,
        changed=changed,
        local_path=media.path,
    )


def ingest_pending(
    source: DataSource, store: Store, storage: Storage, workspace_id: str, work_dir: Path
) -> list[IngestResult]:
    """Ingest every creative in the workspace that has no stored media yet."""
    rows = store.select("creatives", "*", workspace_id=workspace_id)
    results: list[IngestResult] = []
    for row in rows:
        if row.get("storage_path"):
            continue
        results.append(ingest_creative(source, store, storage, row, work_dir))
    return results
