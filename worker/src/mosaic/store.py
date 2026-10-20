"""Thin persistence interface over Supabase (PostgREST), plus an in-memory fake for tests.

The worker always uses the service role, so RLS does not apply here.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Protocol

Row = dict[str, Any]


class Store(Protocol):
    def upsert(self, table: str, rows: list[Row], on_conflict: str) -> list[Row]:
        """Insert or update rows keyed by `on_conflict` columns; returns rows with ids."""
        ...

    def select(self, table: str, columns: str = "*", **eq: Any) -> list[Row]: ...

    def insert(self, table: str, row: Row) -> Row: ...

    def update(self, table: str, values: Row, **eq: Any) -> None: ...

    def delete(self, table: str, **eq: Any) -> None: ...

    def rpc(self, fn: str, params: Row) -> Any: ...


class SupabaseStore:
    def __init__(self, url: str, service_role_key: str) -> None:
        from supabase import create_client

        self._client = create_client(url, service_role_key)

    @property
    def client(self) -> Any:
        return self._client

    def upsert(self, table: str, rows: list[Row], on_conflict: str) -> list[Row]:
        out: list[Row] = []
        for chunk in _chunks(rows, 500):
            res = (
                self._client.table(table)
                .upsert(chunk, on_conflict=on_conflict, returning="representation")
                .execute()
            )
            out.extend(res.data)
        return out

    def select(self, table: str, columns: str = "*", **eq: Any) -> list[Row]:
        q = self._client.table(table).select(columns)
        for k, v in eq.items():
            q = q.in_(k, list(v)) if isinstance(v, list | tuple | set) else q.eq(k, v)
        return q.execute().data

    def insert(self, table: str, row: Row) -> Row:
        return self._client.table(table).insert(row).execute().data[0]

    def update(self, table: str, values: Row, **eq: Any) -> None:
        q = self._client.table(table).update(values)
        for k, v in eq.items():
            q = q.eq(k, v)
        q.execute()

    def delete(self, table: str, **eq: Any) -> None:
        q = self._client.table(table).delete()
        for k, v in eq.items():
            q = q.in_(k, list(v)) if isinstance(v, list | tuple | set) else q.eq(k, v)
        q.execute()

    def rpc(self, fn: str, params: Row) -> Any:
        return self._client.rpc(fn, params).execute().data


class MemoryStore:
    """In-memory Store with the same upsert semantics, for tests."""

    def __init__(self) -> None:
        self.tables: dict[str, list[Row]] = {}
        self.secrets: dict[str, tuple[str, str]] = {}  # id -> (name, secret)
        self._next_id = 1

    def _gen_id(self) -> str:
        self._next_id += 1
        return f"00000000-0000-0000-0000-{self._next_id:012d}"

    def upsert(self, table: str, rows: list[Row], on_conflict: str) -> list[Row]:
        keys = on_conflict.split(",")
        existing = self.tables.setdefault(table, [])
        out: list[Row] = []
        for row in rows:
            match = next((r for r in existing if all(r.get(k) == row.get(k) for k in keys)), None)
            if match is None:
                match = {"id": self._gen_id()} if "id" not in row else {}
                match.update(row)
                existing.append(match)
            else:
                match.update(row)
            out.append(dict(match))
        return out

    def select(self, table: str, columns: str = "*", **eq: Any) -> list[Row]:
        return [dict(r) for r in self.tables.get(table, []) if _matches(r, eq)]

    def insert(self, table: str, row: Row) -> Row:
        new = {"id": self._gen_id(), **row}
        self.tables.setdefault(table, []).append(new)
        return dict(new)

    def update(self, table: str, values: Row, **eq: Any) -> None:
        for r in self.tables.get(table, []):
            if _matches(r, eq):
                r.update(values)

    def delete(self, table: str, **eq: Any) -> None:
        self.tables[table] = [r for r in self.tables.get(table, []) if not _matches(r, eq)]

    def rpc(self, fn: str, params: Row) -> Any:
        if fn == "vault_store_secret":
            for sid, (name, _) in self.secrets.items():
                if name == params["p_name"]:
                    self.secrets[sid] = (name, params["p_secret"])
                    return sid
            sid = self._gen_id()
            self.secrets[sid] = (params["p_name"], params["p_secret"])
            return sid
        if fn == "vault_read_secret":
            return self.secrets[params["p_id"]][1]
        raise NotImplementedError(fn)


def _matches(row: Row, eq: dict[str, Any]) -> bool:
    for k, v in eq.items():
        if isinstance(v, list | tuple | set):
            if row.get(k) not in v:
                return False
        elif row.get(k) != v:
            return False
    return True


def _chunks(rows: list[Row], size: int) -> Iterable[list[Row]]:
    for i in range(0, len(rows), size):
        yield rows[i : i + size]
