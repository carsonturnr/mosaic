"""Seed a Supabase workspace with the synthetic account.

    uv run python -m mosaic.seed --owner-email you@example.com [--seed 42] [--n-ads 24]

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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-email", required=True)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--n-ads", type=int, default=24)
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--workspace-name", default=WORKSPACE_NAME)
    args = parser.parse_args()

    settings = Settings.from_env()
    store = SupabaseStore(settings.supabase_url, settings.supabase_service_role_key)
    owner_id = ensure_owner(store.client, args.owner_email)
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
