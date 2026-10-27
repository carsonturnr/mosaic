"""Run evals, compare with the baseline, optionally record to eval_runs.

uv run python -m mosaic.evals                      # planted problems, print
uv run python -m mosaic.evals --check              # exit 1 if any metric dropped vs baseline
uv run python -m mosaic.evals --record             # also write eval_runs (needs Supabase env)
uv run python -m mosaic.evals --tagging            # tagging accuracy vs hand labels, with misses
uv run python -m mosaic.evals --update-baseline    # accept current numbers as the baseline
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from mosaic.evals import planted, tagging

BASELINE = Path(__file__).resolve().parents[3].parent / "evals" / "baseline.json"
TOLERANCE = 1e-9


def git_sha() -> str | None:
    sha = os.environ.get("GITHUB_SHA") or os.environ.get("MOSAIC_GIT_SHA")
    if sha:
        return sha
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def grounding_metrics() -> dict[str, float] | None:
    """Share of saved reports whose citations all matched the data (needs Supabase env)."""
    from mosaic.config import Settings
    from mosaic.store import SupabaseStore

    s = Settings.from_env()
    rows = SupabaseStore(s.supabase_url, s.supabase_service_role_key).select(
        "reports", "grounding_passed,input_snapshot"
    )
    if not rows:
        return None
    numbers = sum(
        ((r.get("input_snapshot") or {}).get("grounding") or {}).get("checked_numbers", 0)
        for r in rows
    )
    return {
        "reports": float(len(rows)),
        "grounding_pass_rate": round(sum(bool(r["grounding_passed"]) for r in rows) / len(rows), 4),
        "numbers_checked": float(numbers),
    }


def tagging_result() -> tagging.TaggingResult | None:
    from mosaic.config import Settings
    from mosaic.store import SupabaseStore

    s = Settings.from_env()
    return tagging.from_store(SupabaseStore(s.supabase_url, s.supabase_service_role_key))


def regressions(current: dict[str, float], baseline: dict[str, float]) -> list[str]:
    return [
        f"{k}: {baseline[k]} -> {current.get(k)}"
        for k in baseline
        if current.get(k) is None or current[k] < baseline[k] - TOLERANCE
    ]


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--record", action="store_true")
    ap.add_argument("--update-baseline", action="store_true")
    ap.add_argument("--tagging", action="store_true", help="score AI tags against hand labels")
    args = ap.parse_args()

    if args.tagging:
        t = tagging_result()
        if t is None:
            print("no hand labels yet")
            return
        for sc in t.scores:
            print(
                f"{sc.field:<11} n={sc.n:<3} accuracy={sc.accuracy:.0%}  macro F1={sc.macro_f1:.2f}"
            )
        for d in t.disagreements:
            print(f"  {d.creative_ref}  {d.field}: labeled {d.label!r}, model said {d.predicted!r}")
        return

    result = planted.run()
    print(json.dumps(result.metrics, indent=2))
    for r in result.seeds:
        if not (
            r.winning_hook
            and r.fatigue_recall == 1
            and r.hidden_winner
            and r.static_vs_video
            and r.near_duplicates == 1
        ):
            print(f"  seed {r.seed}: {r.model_dump()}")

    if args.update_baseline:
        BASELINE.write_text(json.dumps({"planted": result.metrics}, indent=2) + "\n")
        print(f"baseline written to {BASELINE}")

    if args.record:
        from mosaic.config import Settings
        from mosaic.store import SupabaseStore

        s = Settings.from_env()
        store = SupabaseStore(s.supabase_url, s.supabase_service_role_key)
        sha = git_sha()
        store.insert(
            "eval_runs",
            {
                "suite": "planted",
                "git_sha": sha,
                "metrics": {**result.metrics, "seeds": len(result.seeds)},
            },
        )
        t = tagging_result()
        if t:
            store.insert("eval_runs", {"suite": "tagging", "git_sha": sha, "metrics": t.metrics})
        g = grounding_metrics()
        if g:
            store.insert("eval_runs", {"suite": "grounding", "git_sha": sha, "metrics": g})
        print("recorded to eval_runs")

    if args.check:
        base = json.loads(BASELINE.read_text())["planted"] if BASELINE.exists() else {}
        bad = regressions(result.metrics, base)
        if bad:
            print("REGRESSION vs baseline:\n  " + "\n  ".join(bad))
            sys.exit(1)
        print("no regressions vs baseline")


if __name__ == "__main__":
    main()
