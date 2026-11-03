# scripts

One-off tools:

- `make_mosaic_ads.py`: renders Mosaic's own test ads (videos with a voiceover, and statics) plus a `manifest.json`, for `python -m mosaic.sandbox upload` to put into the Meta sandbox account. Needs macOS `say` and ffmpeg.

Seeding lives in the worker package: `python -m mosaic.seed` (synthetic, demo and local workspaces) and `python -m mosaic.sandbox` (the sandbox test brand).
