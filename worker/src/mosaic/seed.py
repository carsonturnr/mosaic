"""Seed a Supabase workspace with the synthetic account.

    uv run python -m mosaic.seed --owner-email you@example.com [--seed 42] [--n-ads 24]
    uv run python -m mosaic.seed --owner-email you@example.com --demo
    uv run python -m mosaic.seed --owner-email you@example.com --local media/brand tags.json

Creates the owner (if missing), a workspace, a sandbox_synthetic data source, syncs
structure + 90 days of metrics, and writes the ground-truth tags as creative_tags
(model='synthetic') so analytics can run before the perception pipeline exists.
"""

from __future__ import annotations

import argparse
from datetime import date
from typing import Any

from mosaic.config import Settings
from mosaic.datasources.synthetic import SandboxSyntheticSource
from mosaic.store import Store, SupabaseStore
from mosaic.sync import run_job, sync_metrics, sync_structure

WORKSPACE_NAME = "Mosaic Dev (synthetic)"
DEMO_NAME = "Driftwell (demo brand)"
DEMO_DAYS = 90
DEMO_GUIDELINES = " ".join(
    [
        "Driftwell is a fictional brand used for this demo: a sugar-free electrolyte drink mix",
        "in single-serve sticks (citrus, berry, cucumber mint), sold by monthly subscription.",
        "Audience: busy adults who hit an afternoon slump.",
        "Voice: plain, warm, a little dry; no hype.",
        "Avoid medical claims (no 'cures', 'treats' or 'boosts immunity') and never call it an",
        "energy drink; it has no caffeine.",
    ]
)


def ensure_owner(client: Any, email: str) -> str:
    page = client.auth.admin.list_users(page=1, per_page=200)
    for user in page:
        if (user.email or "").lower() == email.lower():
            return user.id
    created = client.auth.admin.create_user({"email": email, "email_confirm": True})
    return created.user.id


def ensure_workspace(store: Store, owner_id: str, name: str) -> str:
    rows = store.select("workspaces", "id", owner_id=owner_id, name=name)
    if rows:
        return rows[0]["id"]
    return store.insert("workspaces", {"owner_id": owner_id, "name": name})["id"]


def ensure_data_source(store: Store, workspace_id: str, ad_account_id: str | None) -> str:
    rows = store.select("data_sources", "id", workspace_id=workspace_id, kind="sandbox_synthetic")
    if rows:
        return rows[0]["id"]
    return store.insert(
        "data_sources",
        {
            "workspace_id": workspace_id,
            "kind": "sandbox_synthetic",
            "meta_ad_account_id": ad_account_id,
        },
    )["id"]


def write_ground_truth_tags(
    store: Store, workspace_id: str, tags: dict[str, dict[str, str]]
) -> int:
    creatives = store.select("creatives", "id,external_id", workspace_id=workspace_id)
    by_ext = {c["external_id"]: c["id"] for c in creatives}
    creative_ids = [by_ext[e] for e in tags if e in by_ext]
    if creative_ids:
        store.delete("creative_tags", creative_id=creative_ids, model="synthetic")
    rows = [
        {
            "creative_id": by_ext[ext],
            "dimension_key": key,
            "value": value,
            "confidence": 1.0,
            "source": "ai",
            "model": "synthetic",
        }
        for ext, dims in tags.items()
        if ext in by_ext
        for key, value in dims.items()
    ]
    for i in range(0, len(rows), 500):
        for row in rows[i : i + 500]:
            store.insert("creative_tags", row)
    # Synthetic creatives have no media; perception has nothing to do.
    for cid in creative_ids:
        store.update("creatives", {"perception_status": "done"}, id=cid)
    return len(rows)


def seed(
    store: Store,
    owner_id: str,
    *,
    seed: int = 42,
    n_ads: int = 24,
    start_date: date = date(2026, 7, 21),
    days: int = 90,
    ad_account_id: str | None = None,
    workspace_name: str = WORKSPACE_NAME,
) -> dict[str, Any]:
    source = SandboxSyntheticSource(seed=seed, n_ads=n_ads, start_date=start_date, days=days)
    ws_id = ensure_workspace(store, owner_id, workspace_name)
    ds_id = ensure_data_source(store, ws_id, ad_account_id)
    structure = run_job(
        store, ds_id, "seed_structure", lambda: sync_structure(source, ws_id, store)
    )
    until = source.account.end_date
    metrics = run_job(
        store, ds_id, "seed_metrics", lambda: sync_metrics(source, ws_id, store, start_date, until)
    )
    n_tags = write_ground_truth_tags(store, ws_id, source.ground_truth_tags())
    from mosaic.analytics.run import analyze_workspace

    analysis = run_job(store, ds_id, "analyze", lambda: analyze_workspace(store, ws_id))
    return {
        "workspace_id": ws_id,
        "data_source_id": ds_id,
        "structure": structure["stats"],
        "metrics": metrics["stats"],
        "tags": n_tags,
        "analysis": analysis["stats"],
    }


def seed_demo(
    store: Store, storage: Any, owner_id: str, *, embedder: Any | None = None
) -> dict[str, Any]:
    """A public, read-only demo workspace for a fictional brand, ending today."""
    import tempfile
    from datetime import timedelta
    from pathlib import Path

    from mosaic.analytics.run import analyze_workspace
    from mosaic.datasources.demo import DemoSource

    rows = store.select("workspaces", "id", owner_id=owner_id, name=DEMO_NAME)
    ws_id = (
        rows[0]["id"]
        if rows
        else store.insert("workspaces", {"owner_id": owner_id, "name": DEMO_NAME, "is_demo": True})[
            "id"
        ]
    )
    store.update("workspaces", {"is_demo": True}, id=ws_id)
    ds_rows = store.select("data_sources", "id,created_at", workspace_id=ws_id, kind="demo")
    ds = (
        ds_rows[0]
        if ds_rows
        else store.insert("data_sources", {"workspace_id": ws_id, "kind": "demo"})
    )
    start = demo_start(ds.get("created_at"))
    with tempfile.TemporaryDirectory() as tmp:
        source = DemoSource(start_date=start, days=DEMO_DAYS, media_dir=Path(tmp))
        structure = run_job(
            store, ds["id"], "seed_structure", lambda: sync_structure(source, ws_id, store)
        )
        metrics = run_job(
            store,
            ds["id"],
            "seed_metrics",
            lambda: sync_metrics(
                source, ws_id, store, start, start + timedelta(days=DEMO_DAYS - 1)
            ),
        )
        n_tags = write_ground_truth_tags(store, ws_id, source.ground_truth_tags())
        cards = 0
        for c in store.select("creatives", "id,external_id,type", workspace_id=ws_id):
            media = source.card(source.get_creative(c["external_id"]))
            path = f"{ws_id}/{c['id']}/card.png"
            storage.upload(path, media.path, "image/png")
            values = {"thumbnail_path": path}
            if c["type"] != "video":
                values["storage_path"] = path  # the card is the static ad itself
            store.update("creatives", values, id=c["id"])
            cards += 1
    store.upsert(
        "brand_memory",
        [{"workspace_id": ws_id, "guidelines": DEMO_GUIDELINES, "learnings": ""}],
        on_conflict="workspace_id",
    )
    if embedder is not None:
        from mosaic.perception.embed import embed_scripts

        run_job(store, ds["id"], "embed", lambda: embed_scripts(store, embedder, ws_id))
    analysis = run_job(store, ds["id"], "analyze", lambda: analyze_workspace(store, ws_id))
    return {
        "workspace_id": ws_id,
        "data_source_id": ds["id"],
        "start": start.isoformat(),
        "structure": structure["stats"],
        "metrics": metrics["stats"],
        "tags": n_tags,
        "cards": cards,
        "analysis": analysis["stats"],
    }


def seed_local(
    store: Store,
    storage: Any,
    owner_id: str,
    folder: Any,
    perception: dict[str, Any],
    *,
    name: str,
    guidelines: str = "",
    embedder: Any | None = None,
) -> dict[str, Any]:
    """A private workspace of real ad files, their stored tags, and synthetic performance.

    Never a demo: the files may be another brand's ads, so the workspace stays owner-only.
    """
    import tempfile
    from datetime import timedelta
    from pathlib import Path

    from mosaic.analytics.run import analyze_workspace
    from mosaic.datasources.local import LocalSource
    from mosaic.media import ingest_pending
    from mosaic.perception.pipeline import save_perception
    from mosaic.perception.scenes import detect_scenes

    ws_id = ensure_workspace(store, owner_id, name)
    store.update("workspaces", {"is_demo": False}, id=ws_id)
    ds_rows = store.select("data_sources", "id,created_at", workspace_id=ws_id, kind="local")
    ds = (
        ds_rows[0]
        if ds_rows
        else store.insert("data_sources", {"workspace_id": ws_id, "kind": "local"})
    )
    start = demo_start(ds.get("created_at"))
    source = LocalSource(Path(folder), perception, start_date=start, days=DEMO_DAYS)
    structure = run_job(
        store, ds["id"], "seed_structure", lambda: sync_structure(source, ws_id, store)
    )
    metrics = run_job(
        store,
        ds["id"],
        "seed_metrics",
        lambda: sync_metrics(source, ws_id, store, start, start + timedelta(days=DEMO_DAYS - 1)),
    )
    with tempfile.TemporaryDirectory() as tmp:
        ingested = ingest_pending(source, store, storage, ws_id, Path(tmp))
        imported = 0
        for c in store.select("creatives", "*", workspace_id=ws_id):
            result, model = source.perception(c["external_id"])
            local = source.download_media(source.get_creative(c["external_id"])).path
            duration = c.get("duration_s")
            scenes = (
                detect_scenes(local, duration_s=float(duration) if duration else None)
                if c["type"] == "video"
                else []
            )
            store.delete("creative_tags", creative_id=c["id"], source="ai")
            save_perception(
                store,
                storage,
                c,
                local,
                scenes,
                result,
                model,
                c.get("duration_s"),
                Path(tmp) / c["id"],
            )
            imported += 1
    if guidelines:
        store.upsert(
            "brand_memory",
            [{"workspace_id": ws_id, "guidelines": guidelines, "learnings": ""}],
            on_conflict="workspace_id",
        )
    if embedder is not None:
        from mosaic.perception.embed import embed_scripts

        run_job(store, ds["id"], "embed", lambda: embed_scripts(store, embedder, ws_id))
    analysis = run_job(store, ds["id"], "analyze", lambda: analyze_workspace(store, ws_id))
    return {
        "workspace_id": ws_id,
        "data_source_id": ds["id"],
        "start": start.isoformat(),
        "structure": structure["stats"],
        "metrics": metrics["stats"],
        "uploaded": len(ingested),
        "perception_imported": imported,
        "winning_hook": source.account.winning_hook,
        "analysis": analysis["stats"],
    }


def demo_start(created_at: Any) -> date:
    """The 90 days end the day the data source was created (stable across re-runs)."""
    from datetime import UTC, datetime, timedelta

    if created_at:
        created = (
            created_at
            if isinstance(created_at, datetime)
            else datetime.fromisoformat(str(created_at))
        )
        end = created.date()
    else:
        end = datetime.now(UTC).date()
    return end - timedelta(days=DEMO_DAYS - 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-email", required=True)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--n-ads", type=int, default=24)
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--workspace-name", default=WORKSPACE_NAME)
    parser.add_argument(
        "--demo", action="store_true", help="seed the public Driftwell demo workspace"
    )
    parser.add_argument(
        "--local",
        nargs=2,
        metavar=("FOLDER", "PERCEPTION_JSON"),
        help="seed a private workspace from ad files and their stored tagging results",
    )
    parser.add_argument("--guidelines", default="", help="brand guidelines for --local")
    args = parser.parse_args()

    settings = Settings.from_env()
    store = SupabaseStore(settings.supabase_url, settings.supabase_service_role_key)
    owner_id = ensure_owner(store.client, args.owner_email)
    if args.local:
        import json
        from pathlib import Path

        from mosaic.media import SupabaseStorage
        from mosaic.providers import GeminiEmbedder

        folder, results = Path(args.local[0]), json.loads(Path(args.local[1]).read_text())
        embedder = GeminiEmbedder(settings.gemini_api_key) if settings.gemini_api_key else None
        name = args.workspace_name if args.workspace_name != WORKSPACE_NAME else folder.name
        for k, v in seed_local(
            store,
            SupabaseStorage(store.client),
            owner_id,
            folder,
            results,
            name=name,
            guidelines=args.guidelines,
            embedder=embedder,
        ).items():
            print(f"{k}: {v}")
        return
    if args.demo:
        from mosaic.media import SupabaseStorage
        from mosaic.providers import GeminiEmbedder

        embedder = GeminiEmbedder(settings.gemini_api_key) if settings.gemini_api_key else None
        for k, v in seed_demo(
            store, SupabaseStorage(store.client), owner_id, embedder=embedder
        ).items():
            print(f"{k}: {v}")
        return
    result = seed(
        store,
        owner_id,
        seed=args.seed,
        n_ads=args.n_ads,
        days=args.days,
        ad_account_id=settings.meta_sandbox_ad_account_id,
        workspace_name=args.workspace_name,
    )
    for k, v in result.items():
        print(f"{k}: {v}")


if __name__ == "__main__":
    main()
