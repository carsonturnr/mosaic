"""Meta tokens live in Supabase Vault; the DB only stores the secret id."""

from __future__ import annotations

from mosaic.store import Store


def token_secret_name(workspace_id: str) -> str:
    return f"meta_token_{workspace_id}"


def store_token(store: Store, workspace_id: str, token: str) -> str:
    params = {"p_name": token_secret_name(workspace_id), "p_secret": token}
    return str(store.rpc("vault_store_secret", params))


def read_token(store: Store, secret_id: str) -> str:
    token = store.rpc("vault_read_secret", {"p_id": secret_id})
    if not token:
        raise RuntimeError(f"vault secret {secret_id} not found")
    return str(token)
