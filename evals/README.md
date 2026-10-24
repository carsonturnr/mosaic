# evals

- `labeled/` — hand-labeled ads for tagging accuracy (~100 target).
- `answer_key.json` — planted patterns written by the synthetic generator (see docs/ARCHITECTURE.md §11).
- `runners/` — eval runners; results are written to the `eval_runs` table.

See docs/ARCHITECTURE.md §12 for the eval matrix.

## Running

```bash
cd worker
uv run python -m mosaic.evals --check     # planted problems vs baseline.json (also runs in CI)
uv run python -m mosaic.evals --record    # write eval_runs for the dashboard (needs Supabase env)
```

- `baseline.json`: last accepted planted-problem scores; CI fails if any drops.
- Tagging F1 (`mosaic.evals.tagging`) scores AI tags against hand labels in `labels/`, which stay out of git while they reference real brands.
