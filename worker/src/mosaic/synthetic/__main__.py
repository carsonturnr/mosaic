"""Write the answer key for a synthetic account.

uv run python -m mosaic.synthetic --out ../evals/answer_key.json --seed 42
"""

from __future__ import annotations

import argparse
from pathlib import Path

from mosaic.synthetic.generator import SyntheticAccount


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--n-ads", type=int, default=24)
    parser.add_argument("--days", type=int, default=90)
    args = parser.parse_args()

    account = SyntheticAccount(seed=args.seed, n_ads=args.n_ads, days=args.days)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(account.answer_key().model_dump_json(indent=2) + "\n")
    print(f"wrote {args.out} ({len(account.patterns)} planted patterns, {args.n_ads} ads)")


if __name__ == "__main__":
    main()
