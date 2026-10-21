# Contributing

Mosaic is a solo project under active development with a fixed scope and schedule, so large unsolicited features are unlikely to be merged. Bug reports, small fixes and improvements to tests and docs are welcome.

## Ground rules

- Open an issue before starting anything bigger than a small fix.
- Keep pull requests focused. One change per PR.
- Everything must pass CI: `ruff check`, `ruff format --check` and `pytest` in `worker/`; `npm run lint` and `npm run build` in `web/`.
- TypeScript is strict with no `any`. Python is fully typed, with pydantic models for every external payload and every model output.
- Never commit secrets or tokens. `.env` files are git-ignored on purpose.

## Setup

See the Development section of the [README](README.md).

## Scope

The MVP feature list and the out-of-scope backlog are in [docs/MOSAIC_MVP.md](docs/MOSAIC_MVP.md). Ideas outside that list are welcome as issues tagged `v1.1`.
